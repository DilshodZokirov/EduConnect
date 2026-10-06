"""Oylik to'lovlar.

To'lov istalgan vaqtda, bir necha oy oldindan ham qilinadi. Har oy uchun:
- oy boshlanishidan 3 kun oldin — yumshoq eslatma (faqat Telegram);
- 1-sanadan — jiddiyroq eslatma: 10-sanagacha to'lanmasa bot yopiladi (SMS + Telegram);
- 11-sanadan — to'lov qilinguncha o'quvchi va ota-ona ilovasi qulflanadi.
Xabarlar ota-onaga boradi; ustoz o'quvchini "o'zi vasiy" qilgan bo'lsa — o'quvchining o'ziga.

Qoidalar:
- Oylik narx har doim bir xil (oyda 12, 13 yoki 14 dars bo'lishidan qat'i nazar).
- Oy o'rtasida qo'shilgan o'quvchi: narx × qolgan darslar ÷ shu oydagi jami darslar (500 so'mgacha yaxlitlanadi).
- Oxirgi muddat — 10-sana; undan keyin qo'shilganlar uchun qo'shilgan kundan 3 kun.
"""
import calendar
import re
from datetime import date, datetime, timedelta  # noqa: F401
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import (
    Discount, DiscountGroup, Group, GroupStudent, Invoice, InvoiceDiscount, LinkStatus, ParentLink, Role,
    StudentDiscount, User,
)

WEEKDAYS = {"Du": 0, "Se": 1, "Ch": 2, "Pa": 3, "Ju": 4, "Sh": 5, "Ya": 6}


def today() -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


def month_start(d: date) -> date:
    return d.replace(day=1)


def schedule_weekdays(schedule: str | None) -> set[int]:
    """'Du, Ch, Ju 14:00–16:00' -> {0, 2, 4}"""
    if not schedule:
        return set()
    return {WEEKDAYS[t] for t in re.findall(r"\b(Du|Se|Ch|Pa|Ju|Sh|Ya)\b", schedule)}


def lesson_dates(weekdays: set[int], period: date) -> list[date]:
    days = calendar.monthrange(period.year, period.month)[1]
    return [period.replace(day=d) for d in range(1, days + 1) if period.replace(day=d).weekday() in weekdays]


def round_500(x: float) -> int:
    return int((x + 250) // 500 * 500)


def calculate(price: int, schedule: str | None, period: date, joined: date | None) -> tuple[int, int | None, int | None]:
    """(summa, hisoblangan darslar, jami darslar). joined=None yoki oy boshidan oldin — to'liq oy."""
    dates = lesson_dates(schedule_weekdays(schedule), period)
    total = len(dates)
    if not joined or joined <= period or total == 0:
        return price, None, (total or None)
    remaining = sum(1 for d in dates if d >= joined)
    if remaining >= total:
        return price, None, total
    return round_500(price * remaining / total), remaining, total


def standard_due(period: date) -> date:
    return period.replace(day=min(settings.payment_due_day, calendar.monthrange(period.year, period.month)[1]))


def next_month(period: date) -> date:
    return (period.replace(day=28) + timedelta(days=4)).replace(day=1)


def due_date_for(period: date, joined: date | None) -> date:
    due = standard_due(period)
    if joined and joined > due - timedelta(days=settings.late_join_due_days):
        return joined + timedelta(days=settings.late_join_due_days)
    return due


async def ensure_invoice(session: AsyncSession, group: Group, student_id: int, period: date,
                         joined: date | None) -> Invoice | None:
    """Shu oy uchun to'lov bo'lmasa yaratadi (bor bo'lsa — tegmaydi). Narx belgilanmagan guruh uchun yaratilmaydi."""
    if not group.price:
        return None
    existing = await session.scalar(select(Invoice).where(
        Invoice.student_id == student_id, Invoice.group_id == group.id, Invoice.period == period,
    ))
    if existing:
        return existing
    joined_in_period = joined if joined and month_start(joined) == period else None
    amount, count, total = calculate(group.price, group.schedule, period, joined_in_period)
    invoice = Invoice(
        student_id=student_id, group_id=group.id, period=period, base_amount=amount, amount=amount, paid_amount=0,
        due_date=due_date_for(period, joined_in_period), lessons_count=count, lessons_total=total, discounts=[],
    )
    session.add(invoice)
    await apply_discounts(session, invoice)
    return invoice


async def active_discounts(session: AsyncSession, student_id: int, group_id: int, period: date) -> list[StudentDiscount]:
    """Shu oyda shu guruh uchun amal qiladigan barcha chegirmalar (hammasi qo'shiladi)."""
    rows = await session.scalars(
        select(StudentDiscount).join(Discount, Discount.id == StudentDiscount.discount_id).where(
            StudentDiscount.student_id == student_id,
            StudentDiscount.start_period <= period,
            (StudentDiscount.end_period.is_(None)) | (StudentDiscount.end_period >= period),
            (Discount.all_groups.is_(True)) | Discount.id.in_(
                select(DiscountGroup.discount_id).where(DiscountGroup.group_id == group_id)
            ),
        ).order_by(StudentDiscount.id)
    )
    return list(rows)


async def apply_discounts(session: AsyncSession, inv: Invoice) -> None:
    """Chegirmalarni (qayta) hisoblaydi. Foizlar va aniq summalar qo'shiladi; jami summadan oshmaydi.
    To'langan qismdan kam bo'lib qolmaydi."""
    if inv.base_amount is None:
        inv.base_amount = inv.amount
    base = inv.base_amount
    lines: list[InvoiceDiscount] = []
    left = base
    for sd in await active_discounts(session, inv.student_id, inv.group_id, inv.period):
        d = sd.discount
        raw = base * d.value / 100 if d.kind == "percent" else d.value
        cut = min(left, round_500(raw))
        if cut <= 0:
            continue
        left -= cut
        lines.append(InvoiceDiscount(student_discount_id=sd.id, name=d.name, kind=d.kind, value=d.value, amount=cut))
    inv.discounts = lines
    inv.amount = max(left, inv.paid_amount)


async def recalc_unpaid(session: AsyncSession, student_id: int, from_period: date) -> int:
    """Chegirma berilgan/to'xtatilganda: shu oydan boshlab to'liq to'lanmagan to'lovlarni qayta hisoblaydi."""
    invoices = list(await session.scalars(select(Invoice).where(
        Invoice.student_id == student_id, Invoice.period >= from_period, Invoice.paid_amount < Invoice.amount,
    )))
    for inv in invoices:
        await apply_discounts(session, inv)
    return len(invoices)


async def generate_month(session: AsyncSession, period: date) -> int:
    """Barcha faol, narxi bor guruhlardagi o'quvchilar uchun oylik to'lovlarni yaratadi. Qayta chaqirish xavfsiz."""
    rows = await session.execute(
        select(Group, GroupStudent.student_id, GroupStudent.joined_at)
        .join(GroupStudent, GroupStudent.group_id == Group.id)
        .where(Group.is_active.is_(True), Group.price.is_not(None), Group.price > 0)
    )
    created = 0
    tz = ZoneInfo(settings.timezone)
    for group, student_id, joined_at in rows:
        joined = joined_at.astimezone(tz).date() if joined_at else None
        if joined and month_start(joined) > period:
            continue  # bu oydan keyin qo'shilgan
        before = len(session.new)
        await ensure_invoice(session, group, student_id, period, joined)
        created += len(session.new) - before
    await session.commit()
    return created


def invoice_status(inv: Invoice) -> str:
    if inv.paid_amount >= inv.amount:
        return "paid"
    return "partial" if inv.paid_amount > 0 else "unpaid"


async def learner_student_ids(session: AsyncSession, user: User) -> list[int]:
    """Qulf tekshiruvi uchun: o'quvchining o'zi yoki ota-onaning tasdiqlangan farzandlari."""
    if user.role == Role.student:
        return [user.id]
    if user.role == Role.parent:
        return list(await session.scalars(
            select(ParentLink.student_id).where(ParentLink.parent_id == user.id, ParentLink.status == LinkStatus.confirmed)
        ))
    return []


async def overdue_debts(session: AsyncSession, student_ids: list[int]):
    """Muddati o'tgan va to'liq to'lanmagan to'lovlar: [(Invoice, User, guruh nomi)]."""
    if not student_ids:
        return []
    rows = await session.execute(
        select(Invoice, User, Group.name).join(User, User.id == Invoice.student_id)
        .join(Group, Group.id == Invoice.group_id)
        .where(Invoice.student_id.in_(student_ids), Invoice.paid_amount < Invoice.amount, Invoice.due_date < today())
        .order_by(Invoice.due_date)
    )
    return list(rows)


def reminder_stage_for(inv: Invoice, today_: date) -> int:
    """Bugun qaysi eslatma kerak: 0 — hech qaysi, 1 — yumshoq, 2 — jiddiy, 3 — qulflandi."""
    if today_ > inv.due_date:
        return 3
    regular = inv.due_date == standard_due(inv.period)  # odatiy oy (muhlatsiz, oy boshidan)
    if regular:
        if today_ >= inv.period:
            return 2
        return 1 if today_ >= inv.period - timedelta(days=3) else 0
    # Oy o'rtasida qo'shilgan yoki muhlat berilgan: avval yumshoq, oxirgi kundan bir kun oldin jiddiy
    return 2 if today_ >= inv.due_date - timedelta(days=1) else 1


async def payers(session: AsyncSession, student: User) -> list[User]:
    """To'lov xabarlarini oluvchilar: "o'zi vasiy" bo'lsa — o'quvchi, aks holda tasdiqlangan ota-onalar."""
    if student.self_guardian:
        return [student]
    return list(await session.scalars(
        select(User).join(ParentLink, ParentLink.parent_id == User.id)
        .where(ParentLink.student_id == student.id, ParentLink.status == LinkStatus.confirmed)
    ))


async def students_with_payer(session: AsyncSession, student_ids: list[int]) -> set[int]:
    if not student_ids:
        return set()
    guardians = set(await session.scalars(
        select(User.id).where(User.id.in_(student_ids), User.self_guardian.is_(True))
    ))
    with_parents = set(await session.scalars(
        select(ParentLink.student_id).where(ParentLink.student_id.in_(student_ids), ParentLink.status == LinkStatus.confirmed)
    ))
    return guardians | with_parents


async def prepay(session: AsyncSession, group: Group, student_id: int, months: int) -> list[Invoice]:
    """Joriy oydan boshlab to'lanmagan birinchi `months` ta oyni topadi (kerak bo'lsa yaratadi)."""
    joined_at = await session.scalar(
        select(GroupStudent.joined_at).where(GroupStudent.group_id == group.id, GroupStudent.student_id == student_id)
    )
    joined = joined_at.astimezone(ZoneInfo(settings.timezone)).date() if joined_at else None
    period, result = month_start(today()), []
    for _ in range(36):  # 3 yildan uzoqqa qaramaymiz
        inv = await ensure_invoice(session, group, student_id, period, joined)
        if inv is None:
            break
        if inv.paid_amount < inv.amount:
            result.append(inv)
            if len(result) == months:
                break
        period = next_month(period)
    await session.flush()
    return result
