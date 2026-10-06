from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import ParentUser, ParentUserUnlocked
from app.models import Group, GroupStudent, Invoice, LinkStatus, ParentLink, Payment, User
from app.routers.common import attendance_history
from app.schemas import AttendanceHistoryOut, ChildOut, GroupOut, InvoiceOut, ParentLinkOut, PaymentOut, UserShort

router = APIRouter(prefix="/parent", tags=["Ota-ona"])


@router.get("/links", response_model=list[ParentLinkOut])
async def my_links(status_: LinkStatus | None = Query(default=None, alias="status"), user: User = ParentUserUnlocked,
                   session: AsyncSession = Depends(get_session)):
    """Tasdiq kutayotgan bog'lanishlar: GET /parent/links?status=pending"""
    stmt = select(ParentLink).where(ParentLink.parent_id == user.id)
    if status_:
        stmt = stmt.where(ParentLink.status == status_)
    result = []
    for link in await session.scalars(stmt.order_by(ParentLink.created_at.desc())):
        student = await session.get(User, link.student_id)
        result.append(ParentLinkOut(id=link.id, parent=UserShort.model_validate(user),
                                    student=UserShort.model_validate(student), status=link.status,
                                    created_at=link.created_at))
    return result


@router.post("/links/{link_id}/{decision}", response_model=ParentLinkOut)
async def decide_link(link_id: int, decision: str, user: User = ParentUserUnlocked,
                      session: AsyncSession = Depends(get_session)):
    if decision not in ("confirm", "reject"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "confirm yoki reject")
    link = await session.get(ParentLink, link_id)
    if link is None or link.parent_id != user.id or link.status != LinkStatus.pending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "So'rov topilmadi")
    link.status = LinkStatus.confirmed if decision == "confirm" else LinkStatus.rejected
    link.decided_at = datetime.now(timezone.utc)
    await session.commit()
    student = await session.get(User, link.student_id)
    return ParentLinkOut(id=link.id, parent=UserShort.model_validate(user),
                         student=UserShort.model_validate(student), status=link.status,
                         created_at=link.created_at)


async def _my_child(session: AsyncSession, parent: User, child_id: int) -> User:
    ok = await session.scalar(
        select(ParentLink.id).where(
            ParentLink.parent_id == parent.id, ParentLink.student_id == child_id,
            ParentLink.status == LinkStatus.confirmed,
        )
    )
    if ok is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Farzand topilmadi")
    return await session.get(User, child_id)


@router.get("/children", response_model=list[ChildOut])
async def my_children(user: User = ParentUser, session: AsyncSession = Depends(get_session)):
    """Bir nechta farzand — bitta akkaunt."""
    children = await session.scalars(
        select(User).join(ParentLink, ParentLink.student_id == User.id)
        .where(ParentLink.parent_id == user.id, ParentLink.status == LinkStatus.confirmed)
        .order_by(User.first_name)
    )
    result = []
    for child in children:
        groups = await session.scalars(
            select(Group.name).join(GroupStudent, GroupStudent.group_id == Group.id)
            .where(GroupStudent.student_id == child.id)
        )
        result.append(ChildOut(id=child.id, first_name=child.first_name, last_name=child.last_name,
                               groups=list(groups)))
    return result


@router.get("/children/{child_id}/attendance", response_model=list[AttendanceHistoryOut])
async def child_attendance(child_id: int, user: User = ParentUser, session: AsyncSession = Depends(get_session)):
    await _my_child(session, user, child_id)
    return await attendance_history(session, child_id)


@router.get("/children/{child_id}/groups", response_model=list[GroupOut])
async def child_groups(child_id: int, user: User = ParentUser, session: AsyncSession = Depends(get_session)):
    """Farzand o'qiyotgan guruhlar (darslar va materiallarni ko'rish uchun)."""
    await _my_child(session, user, child_id)
    return list(await session.scalars(
        select(Group).join(GroupStudent, GroupStudent.group_id == Group.id)
        .where(GroupStudent.student_id == child_id, Group.is_active.is_(True))
        .order_by(Group.name)
    ))


@router.get("/children/{child_id}/invoices", response_model=list[InvoiceOut])
async def child_invoices(child_id: int, user: User = ParentUserUnlocked,
                         session: AsyncSession = Depends(get_session)):
    """Farzandning oylik to'lovlari va har bir to'lov tarixi (yangisi birinchi). Qulflanganda ham ochiq."""
    from app.routers.billing import to_out  # aylanma importdan qochish

    child = await _my_child(session, user, child_id)
    rows = list(await session.execute(
        select(Invoice, Group.name).join(Group, Group.id == Invoice.group_id)
        .where(Invoice.student_id == child_id).order_by(Invoice.period.desc(), Group.name).limit(24)
    ))
    payments: dict[int, list[PaymentOut]] = {}
    if rows:
        for p in await session.scalars(
            select(Payment).where(Payment.invoice_id.in_([inv.id for inv, _ in rows])).order_by(Payment.created_at)
        ):
            payments.setdefault(p.invoice_id, []).append(PaymentOut.model_validate(p))
    result = []
    for inv, name in rows:
        out = to_out(inv, child, name)
        out.payments = payments.get(inv.id, [])
        result.append(out)
    return result
