from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import AdminUser
from app.models import (
    Group, GroupStudent, Invoice, PhoneChangeRequest, PhoneChangeStatus, Role, User, UserStatus,
)
from app.schemas import (
    GroupCreateIn, GroupOut, GroupUpdateIn, PhoneChangeOut, RoleAssignIn, StudentIdsIn, UserOut,
)
from app.services import billing, notify

router = APIRouter(prefix="/admin", tags=["Admin"])

PROTECTED_ROLES = (Role.admin, Role.superadmin)


# ---------- Foydalanuvchilar ----------

@router.get("/users", response_model=list[UserOut])
async def list_users(
    status_: UserStatus | None = Query(default=None, alias="status"),
    role: Role | None = None,
    q: str | None = Query(default=None, min_length=2, description="Ism, familiya yoki telefon"),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    admin: User = AdminUser,
    session: AsyncSession = Depends(get_session),
):
    """Yangi so'rovlar: GET /admin/users?status=pending"""
    stmt = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    if status_:
        stmt = stmt.where(User.status == status_)
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(User.first_name.ilike(like), User.last_name.ilike(like), User.phone.like(like)))
    return list(await session.scalars(stmt))


async def _target(session: AsyncSession, admin: User, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foydalanuvchi topilmadi")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O'zingizga bu amalni qo'llay olmaysiz")
    if user.role == Role.superadmin or (user.role == Role.admin and admin.role != Role.superadmin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu foydalanuvchini o'zgartirishga ruxsat yo'q")
    return user


@router.post("/users/{user_id}/role", response_model=UserOut)
async def assign_role(user_id: int, data: RoleAssignIn, bg: BackgroundTasks,
                      admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    """Rol berish va profilni faollashtirish. Admin rolini faqat superadmin beradi."""
    if data.role == Role.superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Superadmin API orqali tayinlanmaydi")
    if data.role == Role.admin and admin.role != Role.superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin rolini faqat superadmin beradi")

    user = await _target(session, admin, user_id)
    was_pending = user.status == UserStatus.pending
    user.role = data.role
    if user.status != UserStatus.blocked:
        user.status = UserStatus.active
    await session.commit()
    if was_pending:
        bg.add_task(notify.role_assigned, user.id)
    return user


@router.post("/users/{user_id}/block", response_model=UserOut)
async def block_user(user_id: int, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    user = await _target(session, admin, user_id)
    user.status = UserStatus.blocked
    user.token_version += 1
    await session.commit()
    return user


@router.post("/users/{user_id}/unblock", response_model=UserOut)
async def unblock_user(user_id: int, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    user = await _target(session, admin, user_id)
    user.status = UserStatus.active if user.role else UserStatus.pending
    await session.commit()
    return user


# ---------- Guruhlar ----------

async def _check_mentor(session: AsyncSession, mentor_id: int | None) -> None:
    if mentor_id is None:
        return
    mentor = await session.get(User, mentor_id)
    if mentor is None or mentor.role != Role.mentor or mentor.status != UserStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mentor topilmadi yoki faol emas")


async def _group_out(session: AsyncSession, group: Group) -> GroupOut:
    count = await session.scalar(select(func.count()).where(GroupStudent.group_id == group.id))
    out = GroupOut.model_validate(group)
    out.student_count = count or 0
    return out


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    groups = await session.scalars(select(Group).order_by(Group.name))
    return [await _group_out(session, g) for g in groups]


@router.post("/groups", response_model=GroupOut, status_code=201)
async def create_group(data: GroupCreateIn, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    await _check_mentor(session, data.mentor_id)
    group = Group(**data.model_dump())
    session.add(group)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu nomdagi guruh mavjud")
    await session.refresh(group, ["mentor"])
    return await _group_out(session, group)


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(group_id: int, data: GroupUpdateIn, admin: User = AdminUser,
                       session: AsyncSession = Depends(get_session)):
    group = await session.get(Group, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    changes = data.model_dump(exclude_unset=True)
    if "mentor_id" in changes:
        await _check_mentor(session, changes["mentor_id"])
    for field, value in changes.items():
        setattr(group, field, value)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu nomdagi guruh mavjud")
    if changes.get("price"):
        # Narx endi qo'yilgan bo'lsa — shu oy to'lovlari darhol yaratiladi (mavjudlariga tegilmaydi)
        await billing.generate_month(session, billing.month_start(billing.today()))
    await session.refresh(group, ["mentor"])
    return await _group_out(session, group)


@router.post("/groups/{group_id}/students", response_model=GroupOut)
async def add_students(group_id: int, data: StudentIdsIn, admin: User = AdminUser,
                       session: AsyncSession = Depends(get_session)):
    group = await session.get(Group, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")

    ids = set(data.student_ids)
    valid = set(await session.scalars(
        select(User.id).where(User.id.in_(ids), User.role == Role.student, User.status == UserStatus.active)
    ))
    if invalid := ids - valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"O'quvchi emas yoki faol emas: {sorted(invalid)}")

    existing = set(await session.scalars(
        select(GroupStudent.student_id).where(GroupStudent.group_id == group_id, GroupStudent.student_id.in_(ids))
    ))
    new_ids = ids - existing
    session.add_all(GroupStudent(group_id=group_id, student_id=sid) for sid in new_ids)
    # Shu oy uchun to'lov: qo'shilgan kundan oy oxirigacha qolgan darslar bo'yicha
    today = billing.today()
    for sid in new_ids:
        await billing.ensure_invoice(session, group, sid, billing.month_start(today), today)
    await session.commit()
    return await _group_out(session, group)


@router.delete("/groups/{group_id}/students/{student_id}", status_code=204)
async def remove_student(group_id: int, student_id: int, admin: User = AdminUser,
                         session: AsyncSession = Depends(get_session)):
    await session.execute(
        delete(GroupStudent).where(GroupStudent.group_id == group_id, GroupStudent.student_id == student_id)
    )
    # Keyingi oylar uchun oldindan yaratilgan, hali to'lanmagan to'lovlar keraksiz (joriy oy qarzi qoladi)
    await session.execute(delete(Invoice).where(
        Invoice.group_id == group_id, Invoice.student_id == student_id,
        Invoice.period > billing.month_start(billing.today()), Invoice.paid_amount == 0,
    ))
    await session.commit()


# ---------- Telefon raqam so'rovlari (eski raqam yo'q holatlar) ----------

@router.get("/phone-requests", response_model=list[PhoneChangeOut])
async def phone_requests(admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    return list(await session.scalars(
        select(PhoneChangeRequest)
        .where(PhoneChangeRequest.status == PhoneChangeStatus.awaiting_admin)
        .order_by(PhoneChangeRequest.created_at)
    ))


@router.post("/phone-requests/{request_id}/{decision}", response_model=PhoneChangeOut)
async def decide_phone_request(request_id: int, decision: str, bg: BackgroundTasks,
                               admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    if decision not in ("approve", "reject"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "approve yoki reject")
    req = await session.get(PhoneChangeRequest, request_id)
    if req is None or req.status != PhoneChangeStatus.awaiting_admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "So'rov topilmadi")

    req.decided_by = admin.id
    if decision == "reject":
        req.status = PhoneChangeStatus.rejected
        await session.commit()
        return req

    if await session.scalar(select(User.id).where(User.phone == req.new_phone)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Yangi raqam boshqa foydalanuvchida")
    user = await _target(session, admin, req.user_id)
    user.phone = req.new_phone
    req.status = PhoneChangeStatus.done
    await session.commit()
    bg.add_task(notify.phone_changed, user.id, req.old_phone, req.new_phone)
    return req
