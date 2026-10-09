"""Admin: oylik to'lovlar, to'lovni qabul qilish, summani tuzatish."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import AdminUser
from app.models import Group, GroupStudent, Invoice, Payment, User
from app.schemas import (
    InvoiceDiscountOut, InvoiceOut, InvoiceUpdateIn, PaymentIn, PaymentOut, PrepayIn, UserShort,
)
from app.scope import branch_ids, in_scope
from app.services import billing, notify

router = APIRouter(prefix="/admin/invoices", tags=["To'lovlar"])


def to_out(inv: Invoice, student: User, group_name: str, payer_missing: bool = False) -> InvoiceOut:
    st = billing.invoice_status(inv)
    return InvoiceOut(
        id=inv.id, student=UserShort.model_validate(student), group_id=inv.group_id, group_name=group_name,
        period=inv.period, base_amount=inv.base_amount, amount=inv.amount, paid_amount=inv.paid_amount,
        due_date=inv.due_date, status=st,
        discounts=[InvoiceDiscountOut.model_validate(d) for d in inv.discounts],
        overdue=st != "paid" and inv.due_date < billing.today(),
        lessons_count=inv.lessons_count, lessons_total=inv.lessons_total, note=inv.note, payer_missing=payer_missing,
    )


async def _invoice(session: AsyncSession, invoice_id: int) -> tuple[Invoice, User, str]:
    row = (await session.execute(
        select(Invoice, User, Group.name).join(User, User.id == Invoice.student_id)
        .join(Group, Group.id == Invoice.group_id).where(Invoice.id == invoice_id)
    )).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "To'lov topilmadi")
    return row


async def _scoped_invoice(session: AsyncSession, admin: User, invoice_id: int):
    inv, student, group_name = await _invoice(session, invoice_id)
    branch = await session.scalar(select(Group.branch_id).where(Group.id == inv.group_id))
    if not in_scope(await branch_ids(session, admin), branch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "To'lov topilmadi")
    return inv, student, group_name


@router.get("", response_model=list[InvoiceOut])
async def list_invoices(
    period: date | None = Query(default=None, description="Oyning istalgan sanasi, masalan 2026-10-01"),
    status_: str | None = Query(default=None, alias="status", pattern=r"^(unpaid|partial|paid|debt)$"),
    group_id: int | None = None,
    admin: User = AdminUser, session: AsyncSession = Depends(get_session),
):
    """Oy bo'yicha to'lovlar. status=debt — to'lanmagan va qisman to'langanlar."""
    month = billing.month_start(period or billing.today())
    stmt = (select(Invoice, User, Group.name).join(User, User.id == Invoice.student_id)
            .join(Group, Group.id == Invoice.group_id).where(Invoice.period == month)
            .order_by(Group.name, User.last_name, User.first_name))
    if group_id:
        stmt = stmt.where(Invoice.group_id == group_id)
    scope = await branch_ids(session, admin)
    if scope is not None:
        stmt = stmt.where(Group.branch_id.in_(scope or {-1}))
    rows = list(await session.execute(stmt))
    with_payer = await billing.students_with_payer(session, list({u.id for _, u, _ in rows}))
    result = [to_out(i, u, g, payer_missing=u.id not in with_payer) for i, u, g in rows]
    if status_ == "debt":
        result = [r for r in result if r.status != "paid"]
    elif status_:
        result = [r for r in result if r.status == status_]
    return result


@router.post("/generate", status_code=200)
async def generate(period: date | None = None, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    """Oy to'lovlarini yaratish (ishchi buni har kuni o'zi qiladi; qo'lda chaqirish ham xavfsiz)."""
    created = await billing.generate_month(session, billing.month_start(period or billing.today()))
    return {"created": created}


@router.post("/prepay", response_model=list[InvoiceOut])
async def prepay(data: PrepayIn, bg: BackgroundTasks, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    """Bir necha oy uchun oldindan to'lov: joriy oydan boshlab to'lanmagan oylar to'liq yopiladi."""
    group = await session.get(Group, data.group_id)
    member = await session.scalar(select(GroupStudent.student_id).where(
        GroupStudent.group_id == data.group_id, GroupStudent.student_id == data.student_id))
    if group is None or member is None or not in_scope(await branch_ids(session, admin), group.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "O'quvchi bu guruhda emas")
    if not group.price:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Guruhga oylik narx qo'yilmagan")
    invoices = await billing.prepay(session, group, data.student_id, data.months)
    student = await session.get(User, data.student_id)
    paid = []
    for inv in invoices:
        amount = inv.amount - inv.paid_amount
        session.add(Payment(invoice_id=inv.id, amount=amount, method=data.method, note=data.note, created_by=admin.id))
        inv.paid_amount = inv.amount
        paid.append((inv.id, amount))
    await session.commit()
    for invoice_id, amount in paid:
        bg.add_task(notify.payment_received, invoice_id, amount)
    return [to_out(inv, student, group.name) for inv in invoices]


@router.post("/{invoice_id}/payments", response_model=InvoiceOut)
async def add_payment(invoice_id: int, data: PaymentIn, bg: BackgroundTasks,
                      admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    inv, student, group_name = await _scoped_invoice(session, admin, invoice_id)
    remaining = inv.amount - inv.paid_amount
    if remaining <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu oy uchun to'lov to'liq qilingan")
    if data.amount > remaining:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Qoldiqdan ko'p: qoldiq {remaining:,} so'm".replace(",", " "))
    session.add(Payment(invoice_id=inv.id, amount=data.amount, method=data.method, note=data.note, created_by=admin.id))
    inv.paid_amount += data.amount
    await session.commit()
    bg.add_task(notify.payment_received, inv.id, data.amount)
    return to_out(inv, student, group_name)


@router.get("/{invoice_id}/payments", response_model=list[PaymentOut])
async def list_payments(invoice_id: int, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    await _scoped_invoice(session, admin, invoice_id)
    return list(await session.scalars(select(Payment).where(Payment.invoice_id == invoice_id).order_by(Payment.created_at)))


@router.patch("/{invoice_id}", response_model=InvoiceOut)
async def update_invoice(invoice_id: int, data: InvoiceUpdateIn, admin: User = AdminUser,
                         session: AsyncSession = Depends(get_session)):
    """Summani o'zgartirish (chegirma, bekor qilingan dars) yoki muhlat berish (yangi oxirgi muddat).
    Sababi izohga yoziladi va ota-onaga ham ko'rinadi."""
    inv, student, group_name = await _scoped_invoice(session, admin, invoice_id)
    if data.amount is None and data.due_date is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Summa yoki muddatdan birini o'zgartiring")
    if data.amount is not None:
        if data.amount < inv.paid_amount:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Summa allaqachon to'langan miqdordan kam bo'lishi mumkin emas")
        # Admin yakuniy summani kiritadi; chegirmalar saqlanadi, asosiy summa shunga moslanadi
        inv.base_amount = data.amount + sum(d.amount for d in inv.discounts)
        inv.amount = data.amount
    if data.due_date is not None:
        if data.due_date < billing.today():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Muhlat bugundan oldin bo'lishi mumkin emas")
        inv.due_date = data.due_date
        inv.reminder_stage = 1  # yangi muddat bo'yicha eslatmalar qaytadan
    inv.note = data.note
    await session.commit()
    return to_out(inv, student, group_name)
