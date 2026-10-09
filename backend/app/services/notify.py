"""Fon vazifalari (BackgroundTasks). Har biri o'z DB seansini ochadi,
chunki so'rov seansi javob qaytgandan keyin yopiladi."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Assignment, GroupStudent, ManagerBranch, Submission, Invoice, StudentDiscount, Test,
    Attendance, AttendanceStatus, Group, Lesson, LinkStatus, ParentLink, PhoneChangeRequest,
    Role, User, UserStatus,
)
from app.services.sms import send_sms
from app.services import billing
from app.services.inbox import deliver
from app.services.telegram import send_message  # noqa: F401 — boshqa modullar uchun

ROLE_NAMES = {
    Role.superadmin: "superadmin", Role.general_manager: "umumiy menejer", Role.regional_manager: "hududiy menejer",
    Role.admin: "filial admini", Role.mentor: "mentor", Role.student: "o'quvchi", Role.parent: "ota-ona",
}


async def _active(session, *conditions) -> list[User]:
    return list(await session.scalars(select(User).where(User.status == UserStatus.active, *conditions)))


async def _managers_for_branch(session, branch_id: int | None) -> list[User]:
    """Filialning hududiy menejerlari; ular bo'lmasa — umumiy menejerlar; ular ham bo'lmasa — superadmin."""
    if branch_id:
        regional = list(await session.scalars(
            select(User).join(ManagerBranch, ManagerBranch.manager_id == User.id)
            .where(ManagerBranch.branch_id == branch_id, User.status == UserStatus.active)
        ))
        if regional:
            return regional
    return (await _active(session, User.role == Role.general_manager)) or await _active(session, User.role == Role.superadmin)


async def _admins(session, branch_id: int | None = None) -> list[User]:
    """Filial adminlari (ular yo'q bo'lsa — filial menejerlari)."""
    if branch_id:
        admins = await _active(session, User.role == Role.admin, User.branch_id == branch_id)
        return admins or await _managers_for_branch(session, branch_id)
    return await _active(session, User.role.in_([Role.admin, Role.superadmin, Role.general_manager]))


async def new_user_registered(user_id: int) -> None:
    """Yangi so'rov faqat tanlangan filial adminlariga (admin yo'q bo'lsa — menejerlarga) boradi."""
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None:
            return
        if user.requested_role == "admin":
            # Admin bo'lishni so'raganlar — filialning hududiy menejeriga (yo'q bo'lsa — umumiy menejer, superadmin)
            recipients = await _managers_for_branch(session, user.branch_id)
        else:
            recipients = await _active(session, User.role == Role.admin, User.branch_id == user.branch_id) if user.branch_id else []
            if not recipients:
                recipients = await _managers_for_branch(session, user.branch_id)
        recipients = [r for r in recipients if r.telegram_id != user.telegram_id or r.role == Role.superadmin]
        branch = f"\nFilial: {user.branch_name}" if user.branch_name else ""
        wants = "Admin" if user.requested_role == "admin" else "Mentor"
        text = (f"🆕 Yangi so'rov — <b>{wants}</b>:\n<b>{user.full_name}</b>\n{user.phone}{branch}\n\n"
                f"Web App → So'rovlar bo'limida ko'rib chiqing.")
        for person in recipients:
            await deliver(person, text, kind="account", link="/")


async def admin_needs_approval(user_id: int, approver_id: int) -> None:
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        by = await session.get(User, approver_id)
        recipients = await _managers_for_branch(session, user.branch_id)
        text = (f"🛡 Admin tayinlash uchun tasdiqlash kerak:\n<b>{user.full_name}</b> — {user.branch_name or 'filialsiz'}\n"
                f"Taklif qildi: {by.full_name if by else 'admin'}\n\nWeb App → Boshqaruv → Tasdiqlash.")
        for person in recipients:
            await deliver(person, text, kind="account", link="/manage/approvals")
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        await deliver(user, "⏳ Filial admini sizni admin sifatida taklif qildi. Menejer tasdiqlashini kuting.", kind="account")


async def role_assigned(user_id: int) -> None:
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user and user.role:
            await deliver(
                user, f"✅ Profilingiz tasdiqlandi. Rolingiz: <b>{ROLE_NAMES[user.role]}</b>.\nWeb App ni qayta oching.",
                kind="account", link="/",
            )


async def parent_link_created(link_id: int) -> None:
    async with SessionLocal() as session:
        link = await session.get(ParentLink, link_id)
        if link is None:
            return
        parent = await session.get(User, link.parent_id)
        student = await session.get(User, link.student_id)
        mentor = await session.get(User, link.created_by) if link.created_by else None
        who = mentor.full_name if mentor else "Mentor"
        await deliver(
            parent,
            f"👨‍👩‍👦 {who} sizni <b>{student.full_name}</b> ning ota-onasi sifatida bog'ladi.\n"
            f"Web App → Farzandlarim bo'limida tasdiqlang yoki rad eting.",
            kind="account", link="/",
        )


async def absent_students(lesson_id: int) -> None:
    """Darsga kelmagan o'quvchilarning tasdiqlangan ota-onalariga SMS + Telegram."""
    async with SessionLocal() as session:
        lesson = await session.get(Lesson, lesson_id)
        if lesson is None:
            return
        group = await session.get(Group, lesson.group_id)
        records = await session.scalars(
            select(Attendance).where(
                Attendance.lesson_id == lesson_id,
                Attendance.status == AttendanceStatus.absent,
                Attendance.parents_notified.is_(False),
            )
        )
        for rec in list(records):
            student = await session.get(User, rec.student_id)
            parents = await session.scalars(
                select(User).join(ParentLink, ParentLink.parent_id == User.id).where(
                    ParentLink.student_id == rec.student_id, ParentLink.status == LinkStatus.confirmed
                )
            )
            text = (f"Hurmatli ota-ona! Farzandingiz {student.full_name} "
                    f"{lesson.lesson_date:%d.%m.%Y} kuni {group.name} guruhidagi darsga kelmadi. EduConnect")
            for parent in parents:
                await send_sms(parent.phone, text)
                await deliver(parent, "⚠️ " + text, kind="attendance", link=f"/child/{student.id}/attendance")
            rec.parents_notified = True
        await session.commit()


async def phone_changed(user_id: int, old_phone: str, new_phone: str) -> None:
    text = "EduConnect: profilingiz telefon raqami o'zgartirildi. Agar bu siz bo'lmasangiz, adminga murojaat qiling."
    await send_sms(old_phone, text)
    await send_sms(new_phone, text)
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user:
            await deliver(user, "📱 Telefon raqamingiz muvaffaqiyatli o'zgartirildi.", kind="account", link="/profile")


async def phone_change_needs_admin(request_id: int) -> None:
    async with SessionLocal() as session:
        req = await session.get(PhoneChangeRequest, request_id)
        user = await session.get(User, req.user_id) if req else None
        if not user:
            return
        text = (f"📱 <b>{user.full_name}</b> raqamini o'zgartirmoqchi, lekin eski raqamga kirish imkoni yo'q.\n"
                f"Eski: {req.old_phone}\nYangi: {req.new_phone}\n\nShaxsini tekshirib, Web App da tasdiqlang.")
        for admin in await _admins(session, user.branch_id):
            await deliver(admin, text, kind="account", link="/")


MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]


def money(x: int) -> str:
    return f"{x:,}".replace(",", " ")


async def payment_received(invoice_id: int, amount: int) -> None:
    async with SessionLocal() as session:
        inv = await session.get(Invoice, invoice_id)
        student = await session.get(User, inv.student_id)
        group = await session.get(Group, inv.group_id)
        left = inv.amount - inv.paid_amount
        unlocked = left <= 0 and inv.due_date < billing.today() and not await billing.overdue_debts(session, [student.id])
        text = (f"✅ To'lov qabul qilindi: {money(amount)} so'm\n{student.full_name}, «{group.name}», "
                f"{MONTHS[inv.period.month - 1]} oyi.\n"
                + (f"Qoldiq: {money(left)} so'm" if left > 0 else "Bu oy uchun to'lov to'liq amalga oshirildi.")
                + ("\n🔓 Ilova qayta ochildi." if unlocked else ""))
        for person in await billing.payers(session, student):
            await deliver(person, text, kind="payment", link=_pay_link(person, student))


def _pay_link(person: User, student: User) -> str:
    """To'lov xabaridan qaysi sahifaga o'tiladi: ota-onaga — farzand to'lovlari, o'zi vasiy o'quvchiga — bosh sahifa."""
    return "/" if person.id == student.id else f"/child/{student.id}/payments"


def day_month(d) -> str:
    return f"{d.day}-{MONTHS[d.month - 1]}"


# (bosqich, kimga): "parent" — ota-onaga, "self" — o'zi vasiy o'quvchiga
REMINDER_TEXTS = {
    (1, "parent"): ("Assalomu alaykum! Farzandingiz {child}ning «{group}» kursi bo'yicha {month} oyi to'lovini "
                    "eslatib o'tamiz: {left} so'm. To'lovni {due}gacha o'quv markaz administratoriga qilishingiz mumkin."),
    (1, "self"): ("Assalomu alaykum, {child}! «{group}» kursi bo'yicha {month} oyi to'lovini eslatib o'tamiz: "
                  "{left} so'm. To'lovni {due}gacha o'quv markaz administratoriga qilishingiz mumkin."),
    (2, "parent"): ("Hurmatli ota-ona! Farzandingiz {child}ning «{group}» kursi bo'yicha {month} oyi to'lovi hali "
                    "qilinmagan: {left} so'm. Iltimos, to'lovni {due}gacha amalga oshiring. Aks holda materiallar "
                    "farzandingizga yetib bormaydi va to'lov qilinguncha siz ham, farzandingiz ham botdan foydalana olmaysiz."),
    (2, "self"): ("Hurmatli {child}! «{group}» kursi bo'yicha {month} oyi to'lovi hali qilinmagan: {left} so'm. "
                  "Iltimos, to'lovni {due}gacha amalga oshiring. Aks holda to'lov qilinguncha materiallar va botdan "
                  "foydalana olmaysiz."),
    (3, "parent"): ("Hurmatli ota-ona! Farzandingiz {child}ning «{group}» kursi bo'yicha {month} oyi to'lov muddati "
                    "({due}) o'tdi, shu sababli bot vaqtincha yopildi. Qarzdorlik: {left} so'm. To'lov qabul "
                    "qilinishi bilan bot avtomatik ochiladi."),
    (3, "self"): ("Hurmatli {child}! «{group}» kursi bo'yicha {month} oyi to'lov muddati ({due}) o'tdi, shu sababli "
                  "bot vaqtincha yopildi. Qarzdorlik: {left} so'm. To'lov qabul qilinishi bilan bot avtomatik ochiladi."),
}


async def payment_reminder(invoice_id: int, stage: int) -> None:
    """1 — yumshoq (faqat Telegram), 2 va 3 — SMS + Telegram. Farzandga (vasiy emas) yuborilmaydi."""
    async with SessionLocal() as session:
        inv = await session.get(Invoice, invoice_id)
        student = await session.get(User, inv.student_id)
        group = await session.get(Group, inv.group_id)
        recipients = await billing.payers(session, student)
    if not recipients:
        return  # ota-ona bog'lanmagan — admin To'lovlar bo'limida buni ko'radi
    audience = "self" if student.self_guardian else "parent"
    text = REMINDER_TEXTS[(stage, audience)].format(
        child=student.full_name, group=group.name, month=MONTHS[inv.period.month - 1],
        left=money(inv.amount - inv.paid_amount), due=day_month(inv.due_date),
    ) + " EduConnect"
    for person in recipients:
        if stage >= 2:
            await send_sms(person.phone, text)
        await deliver(person, ("🔒 " if stage == 3 else "💳 ") + text, kind="payment", link=_pay_link(person, student))


async def discount_given(student_discount_id: int) -> None:
    """Chegirma berilganda — to'lovchiga (ota-ona yoki o'zi vasiy o'quvchi) xabar."""
    async with SessionLocal() as session:
        sd = await session.get(StudentDiscount, student_discount_id)
        if sd is None:
            return
        student = await session.get(User, sd.student_id)
        d = sd.discount
        size = f"{d.value}%" if d.kind == "percent" else f"{money(d.value)} so'm"
        period = (f"{MONTHS[sd.start_period.month - 1]} oyidan {MONTHS[sd.end_period.month - 1]} oyigacha"
                  if sd.end_period else f"{MONTHS[sd.start_period.month - 1]} oyidan boshlab")
        whom = "Sizga" if student.self_guardian else f"Farzandingiz {student.full_name}ga"
        text = f"🎁 {whom} «{d.name}» chegirmasi berildi: {size}, {period}."
        for person in await billing.payers(session, student):
            await deliver(person, text, kind="payment", link=_pay_link(person, student))



def _when(dt) -> str:
    from zoneinfo import ZoneInfo  # noqa: PLC0415
    from app.config import settings  # noqa: PLC0415
    local = dt.astimezone(ZoneInfo(settings.timezone))
    return f"{local.day}-{MONTHS[local.month - 1]}, {local:%H:%M}"


async def _group_students(session, group_id: int) -> list[User]:
    return list(await session.scalars(
        select(User).join(GroupStudent, GroupStudent.student_id == User.id).where(GroupStudent.group_id == group_id)
    ))


async def homework_assigned(assignment_id: int) -> None:
    async with SessionLocal() as session:
        a = await session.get(Assignment, assignment_id)
        if a is None:
            return
        students = await _group_students(session, a.group_id)
    text = f"📝 Yangi uy vazifasi: «{a.title}»\nTopshirish muddati: {_when(a.due_at)}.\nEduConnect ilovasida «Vazifalar» bo'limini oching."
    for st in students:
        await deliver(st, text, kind="homework", link=f"/homework/{a.id}")


async def homework_graded(submission_id: int) -> None:
    async with SessionLocal() as session:
        sub = await session.get(Submission, submission_id)
        if sub is None or sub.final_score is None:
            return
        a = await session.get(Assignment, sub.assignment_id)
        student = await session.get(User, sub.student_id)
    await deliver(student, f"✅ «{a.title}» vazifangiz baholandi: {sub.final_score}/100.", kind="homework", link=f"/homework/{a.id}")


async def homework_due_soon(assignment_id: int) -> None:
    """Muddatga 1 kun qolganda — hali topshirmagan o'quvchilarga (faqat Telegram)."""
    async with SessionLocal() as session:
        a = await session.get(Assignment, assignment_id)
        done = set(await session.scalars(select(Submission.student_id).where(Submission.assignment_id == a.id)))
        students = [s for s in await _group_students(session, a.group_id) if s.id not in done]
    for st in students:
        await deliver(st, f"⏰ «{a.title}» vazifasini topshirish muddati: {_when(a.due_at)}. Unutmang!",
                      kind="reminder", link=f"/homework/{a.id}")


async def homework_missed(assignment_id: int) -> None:
    """Muddat o'tdi, topshirilmadi — ota-onaga yumshoq xabar (o'zi vasiy bo'lsa — o'ziga). Faqat Telegram."""
    async with SessionLocal() as session:
        a = await session.get(Assignment, assignment_id)
        done = set(await session.scalars(select(Submission.student_id).where(Submission.assignment_id == a.id)))
        students = [s for s in await _group_students(session, a.group_id) if s.id not in done]
        targets = [(st, await billing.payers(session, st)) for st in students]
    for st, people in targets:
        text = (f"📝 «{a.title}» uy vazifasini topshirish muddati ({_when(a.due_at)}) o'tdi, lekin vazifa hali topshirilmagan."
                if st.self_guardian else
                f"Hurmatli ota-ona! Farzandingiz {st.full_name} «{a.title}» uy vazifasini muddatida ({_when(a.due_at)}) "
                f"topshirmadi. Vazifani hali ham topshirish mumkin.")
        for person in people:
            link = f"/homework/{a.id}" if person.id == st.id else f"/child/{st.id}/homework"
            await deliver(person, text, kind="homework", link=link)



async def test_opened(test_id: int) -> None:
    async with SessionLocal() as session:
        t = await session.get(Test, test_id)
        if t is None:
            return
        students = await _group_students(session, t.group_id)
    text = (f"🧪 Yangi test ochildi: «{t.title}»\n{len(t.questions)} ta savol, {t.time_limit_min} daqiqa.\n"
            f"Topshirish muddati: {_when(t.closes_at)}.")
    for st in students:
        await deliver(st, text, kind="test", link="/tests")


async def test_retake_granted(test_id: int, student_id: int) -> None:
    async with SessionLocal() as session:
        t = await session.get(Test, test_id)
        student = await session.get(User, student_id)
    await deliver(student, f"🔁 Mentor sizga «{t.title}» testini qayta topshirishga ruxsat berdi. Muddat: {_when(t.closes_at)}.",
                  kind="test", link="/tests")



async def student_joined(group_id: int, student_id: int) -> None:
    """O'qituvchiga: havola orqali yangi o'quvchi qo'shildi."""
    async with SessionLocal() as session:
        group = await session.get(Group, group_id)
        student = await session.get(User, student_id)
        mentor = await session.get(User, group.mentor_id) if group and group.mentor_id else None
    if mentor:
        await deliver(mentor,
                      f"👋 «{group.name}» guruhiga havola orqali yangi o'quvchi qo'shildi: <b>{student.full_name}</b>.\n"
                      f"Adashib qo'shilgan bo'lsa — O'quvchilar bo'limidan chiqarib yuborishingiz mumkin.",
                      kind="account", link=f"/g/{group.id}/students")


async def parent_requested(link_id: int) -> None:
    """O'qituvchiga: ota-ona "bu mening farzandim" deb so'radi — tasdiqlash kerak."""
    async with SessionLocal() as session:
        link = await session.get(ParentLink, link_id)
        if link is None:
            return
        parent = await session.get(User, link.parent_id)
        student = await session.get(User, link.student_id)
        row = (await session.execute(
            select(User, Group.id).join(Group, Group.mentor_id == User.id).join(GroupStudent, GroupStudent.group_id == Group.id)
            .where(GroupStudent.student_id == student.id).limit(1))).first()
    if row:
        mentor, group_id = row
        await deliver(mentor,
                      f"👨‍👩‍👧 <b>{parent.full_name}</b> ({parent.phone}) o'zini <b>{student.full_name}</b>ning "
                      f"ota-onasi deb ko'rsatdi.\nWeb App → O'quvchilar → Ota-ona so'rovlari bo'limida tasdiqlang.",
                      kind="account", link=f"/g/{group_id}/students")


async def parent_request_decided(link_id: int) -> None:
    async with SessionLocal() as session:
        link = await session.get(ParentLink, link_id)
        parent = await session.get(User, link.parent_id)
        student = await session.get(User, link.student_id)
    text = (f"✅ O'qituvchi tasdiqladi: endi <b>{student.full_name}</b>ning o'qishini kuzatishingiz mumkin."
            if link.status == LinkStatus.confirmed else
            f"O'qituvchi {student.first_name} bilan bog'lanish so'rovingizni tasdiqlamadi. Savollar bo'lsa, o'qituvchiga murojaat qiling.")
    await deliver(parent, text, kind="account", link="/")



PLACE_ICON = {1: "🥇", 2: "🥈", 3: "🥉"}


async def rating_award(award_id: int) -> None:
    """Oy yakunida 1–3-o'rin: o'quvchiga va to'lovchiga (ota-ona / o'zi vasiy) tabrik."""
    from app.models import RatingAward  # noqa: PLC0415
    async with SessionLocal() as session:
        aw = await session.get(RatingAward, award_id)
        if aw is None:
            return
        student = await session.get(User, aw.student_id)
        group = await session.get(Group, aw.group_id)
        payers = await billing.payers(session, student)
    month = MONTHS[aw.period_start.month - 1]
    icon = PLACE_ICON.get(aw.place, "🏅")
    await deliver(student,
                  f"{icon} Tabriklaymiz! Siz «{group.name}» guruhida {month} oyi reytingida {aw.place}-o'rinni egalladingiz "
                  f"({aw.points:g} ball). Shunday davom eting!", kind="rating", link="/rating")
    for p in payers:
        if p.id != student.id:
            await deliver(p,
                          f"{icon} Farzandingiz {student.full_name} «{group.name}» guruhida {month} oyi reytingida "
                          f"{aw.place}-o'rinni egalladi ({aw.points:g} ball). Tabriklaymiz!",
                          kind="rating", link=f"/child/{student.id}/rating")
