"""Fon vazifalari (BackgroundTasks). Har biri o'z DB seansini ochadi,
chunki so'rov seansi javob qaytgandan keyin yopiladi."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Assignment, GroupStudent, Submission, Invoice, StudentDiscount,
    Attendance, AttendanceStatus, Group, Lesson, LinkStatus, ParentLink, PhoneChangeRequest,
    Role, User, UserStatus,
)
from app.services.sms import send_sms
from app.services import billing
from app.services.telegram import send_message

ROLE_NAMES = {
    Role.superadmin: "superadmin", Role.admin: "admin", Role.mentor: "mentor",
    Role.student: "o'quvchi", Role.parent: "ota-ona",
}


async def _admins(session) -> list[User]:
    res = await session.scalars(
        select(User).where(User.role.in_([Role.admin, Role.superadmin]), User.status == UserStatus.active)
    )
    return list(res)


async def new_user_registered(user_id: int) -> None:
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None:
            return
        text = (f"🆕 Yangi foydalanuvchi ro'yxatdan o'tdi:\n<b>{user.full_name}</b>\n{user.phone}\n\n"
                f"Web App → So'rovlar bo'limida rol bering.")
        for admin in await _admins(session):
            await send_message(admin.telegram_id, text)


async def role_assigned(user_id: int) -> None:
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user and user.role:
            await send_message(
                user.telegram_id,
                f"✅ Profilingiz tasdiqlandi. Rolingiz: <b>{ROLE_NAMES[user.role]}</b>.\nWeb App ni qayta oching.",
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
        await send_message(
            parent.telegram_id,
            f"👨‍👩‍👦 {who} sizni <b>{student.full_name}</b> ning ota-onasi sifatida bog'ladi.\n"
            f"Web App → Farzandlarim bo'limida tasdiqlang yoki rad eting.",
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
                await send_message(parent.telegram_id, "⚠️ " + text)
            rec.parents_notified = True
        await session.commit()


async def phone_changed(user_id: int, old_phone: str, new_phone: str) -> None:
    text = "EduConnect: profilingiz telefon raqami o'zgartirildi. Agar bu siz bo'lmasangiz, adminga murojaat qiling."
    await send_sms(old_phone, text)
    await send_sms(new_phone, text)
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user:
            await send_message(user.telegram_id, "📱 Telefon raqamingiz muvaffaqiyatli o'zgartirildi.")


async def phone_change_needs_admin(request_id: int) -> None:
    async with SessionLocal() as session:
        req = await session.get(PhoneChangeRequest, request_id)
        user = await session.get(User, req.user_id) if req else None
        if not user:
            return
        text = (f"📱 <b>{user.full_name}</b> raqamini o'zgartirmoqchi, lekin eski raqamga kirish imkoni yo'q.\n"
                f"Eski: {req.old_phone}\nYangi: {req.new_phone}\n\nShaxsini tekshirib, Web App da tasdiqlang.")
        for admin in await _admins(session):
            await send_message(admin.telegram_id, text)


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
            await send_message(person.telegram_id, text)


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
        await send_message(person.telegram_id, ("🔒 " if stage == 3 else "💳 ") + text)


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
            await send_message(person.telegram_id, text)



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
        await send_message(st.telegram_id, text)


async def homework_graded(submission_id: int) -> None:
    async with SessionLocal() as session:
        sub = await session.get(Submission, submission_id)
        if sub is None or sub.final_score is None:
            return
        a = await session.get(Assignment, sub.assignment_id)
        student = await session.get(User, sub.student_id)
    await send_message(student.telegram_id, f"✅ «{a.title}» vazifangiz baholandi: {sub.final_score}/100.")


async def homework_due_soon(assignment_id: int) -> None:
    """Muddatga 1 kun qolganda — hali topshirmagan o'quvchilarga (faqat Telegram)."""
    async with SessionLocal() as session:
        a = await session.get(Assignment, assignment_id)
        done = set(await session.scalars(select(Submission.student_id).where(Submission.assignment_id == a.id)))
        students = [s for s in await _group_students(session, a.group_id) if s.id not in done]
    for st in students:
        await send_message(st.telegram_id, f"⏰ «{a.title}» vazifasini topshirish muddati: {_when(a.due_at)}. Unutmang!")


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
            await send_message(person.telegram_id, text)
