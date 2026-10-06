"""Admin: chegirma turlari va ularni o'quvchilarga berish."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import AdminUser
from app.models import Discount, DiscountGroup, Group, Role, StudentDiscount, User, UserStatus
from app.schemas import (
    AssignDiscountIn, DiscountIn, DiscountOut, DiscountUpdateIn, StudentDiscountOut, UserShort,
)
from app.services import billing, notify

router = APIRouter(prefix="/admin/discounts", tags=["Chegirmalar"])


def _active(sd: StudentDiscount, today_period: date) -> bool:
    return sd.end_period is None or sd.end_period >= today_period


def _add_months(period: date, n: int) -> date:
    for _ in range(n):
        period = billing.next_month(period)
    return period


async def _discount_out(session: AsyncSession, d: Discount) -> DiscountOut:
    now = billing.month_start(billing.today())
    count = await session.scalar(select(func.count()).where(
        StudentDiscount.discount_id == d.id,
        (StudentDiscount.end_period.is_(None)) | (StudentDiscount.end_period >= now),
    ))
    out = DiscountOut.model_validate(d)
    out.active_count = count or 0
    return out


async def _set_groups(session: AsyncSession, d: Discount, group_ids: list[int]) -> None:
    await session.execute(delete(DiscountGroup).where(DiscountGroup.discount_id == d.id))
    if group_ids:
        found = set(await session.scalars(select(Group.id).where(Group.id.in_(group_ids))))
        if missing := set(group_ids) - found:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Guruh topilmadi: {sorted(missing)}")
        session.add_all(DiscountGroup(discount_id=d.id, group_id=g) for g in found)
    d.all_groups = not group_ids


@router.get("", response_model=list[DiscountOut])
async def list_discounts(admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    items = await session.scalars(select(Discount).order_by(Discount.is_active.desc(), Discount.name))
    return [await _discount_out(session, d) for d in items]


@router.post("", response_model=DiscountOut, status_code=201)
async def create_discount(data: DiscountIn, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    d = Discount(name=data.name.strip(), description=data.description, conditions=data.conditions.strip(),
                 kind=data.kind, value=data.value, months=data.months, created_by=admin.id)
    session.add(d)
    await session.flush()
    await _set_groups(session, d, data.group_ids)
    await session.commit()
    await session.refresh(d, ["groups"])
    return await _discount_out(session, d)


@router.put("/{discount_id}", response_model=DiscountOut)
async def update_discount(discount_id: int, data: DiscountUpdateIn, admin: User = AdminUser,
                          session: AsyncSession = Depends(get_session)):
    """O'zgarishlar faqat kelajakdagi oylarga ta'sir qiladi; o'tgan oylardagi chegirmalar saqlanib qoladi."""
    d = await session.get(Discount, discount_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chegirma topilmadi")
    d.name, d.description, d.kind, d.value = data.name.strip(), data.description, data.kind, data.value
    d.conditions = data.conditions.strip()
    d.months, d.is_active = data.months, data.is_active
    await _set_groups(session, d, data.group_ids)
    await session.commit()
    await session.refresh(d, ["groups"])
    return await _discount_out(session, d)


@router.get("/assignments", response_model=list[StudentDiscountOut])
async def list_assignments(student_id: int | None = None, active: bool = Query(default=True),
                           admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    now = billing.month_start(billing.today())
    stmt = (select(StudentDiscount, User).join(User, User.id == StudentDiscount.student_id)
            .order_by(StudentDiscount.created_at.desc()))
    if student_id:
        stmt = stmt.where(StudentDiscount.student_id == student_id)
    if active:
        stmt = stmt.where((StudentDiscount.end_period.is_(None)) | (StudentDiscount.end_period >= now))
    result = []
    for sd, student in await session.execute(stmt):
        result.append(StudentDiscountOut(
            id=sd.id, discount=await _discount_out(session, sd.discount), student=UserShort.model_validate(student),
            start_period=sd.start_period, end_period=sd.end_period, note=sd.note, active=_active(sd, now),
        ))
    return result


@router.post("/{discount_id}/assign", response_model=StudentDiscountOut, status_code=201)
async def assign_discount(discount_id: int, data: AssignDiscountIn, bg: BackgroundTasks,
                          admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    d = await session.get(Discount, discount_id)
    if d is None or not d.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chegirma topilmadi yoki arxivlangan")
    student = await session.get(User, data.student_id)
    if student is None or student.role != Role.student or student.status != UserStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O'quvchi topilmadi yoki faol emas")

    now = billing.month_start(billing.today())
    start = now if data.start == "current" else billing.next_month(now)
    end = _add_months(start, d.months - 1) if d.months else None
    sd = StudentDiscount(discount_id=d.id, student_id=student.id, start_period=start, end_period=end,
                         note=data.note, created_by=admin.id)
    session.add(sd)
    await session.flush()
    await session.refresh(sd, ["discount"])
    await billing.recalc_unpaid(session, student.id, start)
    await session.commit()
    bg.add_task(notify.discount_given, sd.id)
    return StudentDiscountOut(
        id=sd.id, discount=await _discount_out(session, d), student=UserShort.model_validate(student),
        start_period=start, end_period=end, note=sd.note, active=True,
    )


@router.post("/assignments/{assignment_id}/stop", response_model=StudentDiscountOut)
async def stop_assignment(assignment_id: int, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    """Muddatidan oldin to'xtatish: joriy oy oxirigacha amal qiladi, keyingi oydan to'xtaydi.
    Hali boshlanmagan bo'lsa — butunlay bekor qilinadi."""
    sd = await session.get(StudentDiscount, assignment_id)
    if sd is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Topilmadi")
    student = await session.get(User, sd.student_id)
    now = billing.month_start(billing.today())
    d = sd.discount
    if sd.start_period > now:
        out_start, out_end = sd.start_period, sd.start_period
        await session.delete(sd)
        await session.flush()
        await billing.recalc_unpaid(session, student.id, out_start)
        await session.commit()
        return StudentDiscountOut(id=assignment_id, discount=await _discount_out(session, d),
                                  student=UserShort.model_validate(student), start_period=out_start,
                                  end_period=out_end, note=sd.note, active=False)
    sd.end_period = now
    await session.flush()
    await billing.recalc_unpaid(session, student.id, billing.next_month(now))
    await session.commit()
    return StudentDiscountOut(id=sd.id, discount=await _discount_out(session, d),
                              student=UserShort.model_validate(student), start_period=sd.start_period,
                              end_period=sd.end_period, note=sd.note, active=_active(sd, now))
