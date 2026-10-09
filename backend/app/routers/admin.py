"""Admin va menejerlar: foydalanuvchilar, rol berish, tasdiqlash, guruhlar.

Har kim faqat o'z doirasini ko'radi: admin — o'z filialini, hududiy menejer — biriktirilgan filiallarni,
umumiy menejer va superadmin — hammasini.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import AdminUser, ManagerUser
from app.models import (
    Branch, Group, GroupStudent, Invoice, PhoneChangeRequest, PhoneChangeStatus, Role, User, UserStatus,
)
from app.schemas import (
    GroupCreateIn, GroupOut, GroupUpdateIn, PhoneChangeOut, RoleAssignIn, StudentIdsIn, UserBranchIn, UserOut,
)
from app.scope import assert_can_manage, branch_ids, in_scope
from app.services import billing, notify
from app.services.profiles import phone_taken, set_phone_everywhere

router = APIRouter(prefix="/admin", tags=["Admin"])

# Kim qaysi rolni bera oladi. O'quvchi va ota-onalar guruh havolasi orqali o'zi qo'shiladi,
# ularning rolini o'qituvchi tuzatadi — shuning uchun bu yerda faqat xodim rollari.
BASIC_ROLES = (Role.mentor,)
# Filial admini — faqat mentor so'rovlarini tasdiqlaydi.
# Hududiy menejer — o'z filiallarida admin so'rovlarini tasdiqlaydi, xodimlar rolini o'zgartiradi.
# Umumiy menejer — hududiy menejerlarni ham tayinlaydi. Superadmin — hammasini.
GRANTABLE = {
    Role.admin: BASIC_ROLES,
    Role.regional_manager: BASIC_ROLES + (Role.admin,),
    Role.general_manager: BASIC_ROLES + (Role.admin, Role.regional_manager),
    Role.superadmin: BASIC_ROLES + (Role.admin, Role.regional_manager, Role.general_manager),
}
GENERAL = (Role.general_manager, Role.superadmin)


def _scoped(stmt, scope, column):
    return stmt if scope is None else stmt.where(column.in_(scope or {-1}))


# ---------- Foydalanuvchilar ----------

@router.get("/users", response_model=list[UserOut])
async def list_users(
    status_: UserStatus | None = Query(default=None, alias="status"),
    role: Role | None = None,
    branch_id: int | None = None,
    q: str | None = Query(default=None, min_length=2, description="Ism, familiya yoki telefon"),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    admin: User = AdminUser,
    session: AsyncSession = Depends(get_session),
):
    """Yangi so'rovlar: GET /admin/users?status=pending (menejer tasdiqlashini kutayotganlar bu ro'yxatda yo'q)."""
    scope = await branch_ids(session, admin)
    stmt = _scoped(select(User).order_by(User.created_at.desc()).limit(limit).offset(offset), scope, User.branch_id)
    if status_:
        stmt = stmt.where(User.status == status_)
        if status_ == UserStatus.pending:
            stmt = stmt.where(User.awaiting_manager.is_(False))
            if admin.role == Role.admin:  # admin so'rovlarini filial admini emas, hududiy menejer ko'radi
                stmt = stmt.where(or_(User.requested_role.is_(None), User.requested_role != "admin"))
    if role:
        stmt = stmt.where(User.role == role)
    if branch_id:
        stmt = stmt.where(User.branch_id == branch_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(User.first_name.ilike(like), User.last_name.ilike(like), User.phone.like(like)))
    return list(await session.scalars(stmt))


async def _target(session: AsyncSession, actor: User, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foydalanuvchi topilmadi")
    await assert_can_manage(session, actor, user)
    return user


@router.post("/users/{user_id}/role", response_model=UserOut)
async def assign_role(user_id: int, data: RoleAssignIn, bg: BackgroundTasks,
                      admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    """Rol berish: filial admini — faqat mentor; hududiy menejer — admin ham; umumiy menejer — hududiy menejer ham."""
    if data.role not in GRANTABLE.get(admin.role, ()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu rolni berishga ruxsatingiz yo'q")
    user = await _target(session, admin, user_id)
    if data.role == Role.admin and not user.branch_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin filialga tegishli bo'lishi kerak — avval filialni belgilang")

    was_pending = user.status == UserStatus.pending
    user.role = data.role
    user.awaiting_manager = False
    if user.status != UserStatus.blocked:
        user.status = UserStatus.active
    await session.commit()
    if was_pending:
        bg.add_task(notify.role_assigned, user.id)
    return user


@router.patch("/users/{user_id}/branch", response_model=UserOut)
async def change_branch(user_id: int, data: UserBranchIn, admin: User = ManagerUser,
                        session: AsyncSession = Depends(get_session)):
    """Foydalanuvchini boshqa filialga o'tkazish (menejerlar)."""
    user = await _target(session, admin, user_id)
    branch = await session.get(Branch, data.branch_id)
    if branch is None or not in_scope(await branch_ids(session, admin), branch.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Filial topilmadi")
    user.branch_id = branch.id
    await session.commit()
    await session.refresh(user, ["branch"])
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
    user.status = UserStatus.active if user.role and not user.awaiting_manager else UserStatus.pending
    await session.commit()
    return user


# ---------- Adminlikni tasdiqlash (hududiy / umumiy menejer) ----------

@router.get("/approvals", response_model=list[UserOut])
async def approvals(manager: User = ManagerUser, session: AsyncSession = Depends(get_session)):
    """Filial adminlari "admin" rolini bergan va menejer tasdiqlashini kutayotganlar."""
    scope = await branch_ids(session, manager)
    stmt = select(User).where(User.awaiting_manager.is_(True), User.status == UserStatus.pending).order_by(User.created_at)
    return list(await session.scalars(_scoped(stmt, scope, User.branch_id)))


@router.post("/approvals/{user_id}/{decision}", response_model=UserOut)
async def decide_approval(user_id: int, decision: str, bg: BackgroundTasks, manager: User = ManagerUser,
                          session: AsyncSession = Depends(get_session)):
    if decision not in ("approve", "reject"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "approve yoki reject")
    user = await _target(session, manager, user_id)
    if not user.awaiting_manager:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu so'rov allaqachon ko'rib chiqilgan")
    user.awaiting_manager = False
    if decision == "approve":
        user.status = UserStatus.active
        await session.commit()
        bg.add_task(notify.role_assigned, user.id)
    else:
        user.role = None  # filial adminlari qayta ko'rib chiqadi
        await session.commit()
    return user


# ---------- Guruhlar ----------

async def _check_mentor(session: AsyncSession, mentor_id: int | None, branch_id: int | None) -> None:
    if mentor_id is None:
        return
    mentor = await session.get(User, mentor_id)
    if mentor is None or mentor.role != Role.mentor or mentor.status != UserStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mentor topilmadi yoki faol emas")
    if branch_id and mentor.branch_id and mentor.branch_id != branch_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mentor boshqa filialda ishlaydi")


async def _group_out(session: AsyncSession, group: Group) -> GroupOut:
    count = await session.scalar(select(func.count()).where(GroupStudent.group_id == group.id))
    out = GroupOut.model_validate(group)
    out.student_count = count or 0
    return out


async def _scoped_group(session: AsyncSession, admin: User, group_id: int) -> Group:
    group = await session.get(Group, group_id)
    if group is None or not in_scope(await branch_ids(session, admin), group.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    return group


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(branch_id: int | None = None, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    stmt = _scoped(select(Group).order_by(Group.name), await branch_ids(session, admin), Group.branch_id)
    if branch_id:
        stmt = stmt.where(Group.branch_id == branch_id)
    return [await _group_out(session, g) for g in await session.scalars(stmt)]


@router.post("/groups", response_model=GroupOut, status_code=201)
async def create_group(data: GroupCreateIn, admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    values = data.model_dump()
    scope = await branch_ids(session, admin)
    if admin.role == Role.admin:
        values["branch_id"] = admin.branch_id  # admin faqat o'z filialida guruh ochadi
    elif values["branch_id"] is not None and not in_scope(scope, values["branch_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Filial topilmadi")
    has_branches = await session.scalar(select(func.count()).select_from(Branch))
    if has_branches and values["branch_id"] is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Guruh qaysi filialga tegishli ekanini tanlang")
    await _check_mentor(session, values["mentor_id"], values["branch_id"])
    from app.services.invites import new_token  # noqa: PLC0415
    group = Group(**values, invite_token=new_token())
    session.add(group)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu nomdagi guruh mavjud")
    await session.refresh(group, ["mentor", "branch"])
    return await _group_out(session, group)


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(group_id: int, data: GroupUpdateIn, admin: User = AdminUser,
                       session: AsyncSession = Depends(get_session)):
    group = await _scoped_group(session, admin, group_id)
    changes = data.model_dump(exclude_unset=True)
    if "mentor_id" in changes:
        await _check_mentor(session, changes["mentor_id"], group.branch_id)
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
    await session.refresh(group, ["mentor", "branch"])
    return await _group_out(session, group)


@router.post("/groups/{group_id}/students", response_model=GroupOut)
async def add_students(group_id: int, data: StudentIdsIn, admin: User = AdminUser,
                       session: AsyncSession = Depends(get_session)):
    group = await _scoped_group(session, admin, group_id)
    ids = set(data.student_ids)
    stmt = select(User.id).where(User.id.in_(ids), User.role == Role.student, User.status == UserStatus.active)
    if group.branch_id:
        stmt = stmt.where(User.branch_id == group.branch_id)
    valid = set(await session.scalars(stmt))
    if invalid := ids - valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"O'quvchi emas, faol emas yoki boshqa filialda: {sorted(invalid)}")

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


# O'quvchini guruhdan chiqarish — faqat o'qituvchi (DELETE /mentor/groups/{id}/students/{sid})


# ---------- Telefon raqam so'rovlari (eski raqam yo'q holatlar) ----------

@router.get("/phone-requests", response_model=list[PhoneChangeOut])
async def phone_requests(admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    stmt = (select(PhoneChangeRequest).join(User, User.id == PhoneChangeRequest.user_id)
            .where(PhoneChangeRequest.status == PhoneChangeStatus.awaiting_admin).order_by(PhoneChangeRequest.created_at))
    return list(await session.scalars(_scoped(stmt, await branch_ids(session, admin), User.branch_id)))


@router.post("/phone-requests/{request_id}/{decision}", response_model=PhoneChangeOut)
async def decide_phone_request(request_id: int, decision: str, bg: BackgroundTasks,
                               admin: User = AdminUser, session: AsyncSession = Depends(get_session)):
    if decision not in ("approve", "reject"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "approve yoki reject")
    req = await session.get(PhoneChangeRequest, request_id)
    if req is None or req.status != PhoneChangeStatus.awaiting_admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "So'rov topilmadi")
    user = await _target(session, admin, req.user_id)

    req.decided_by = admin.id
    if decision == "reject":
        req.status = PhoneChangeStatus.rejected
        await session.commit()
        return req

    if await phone_taken(session, req.new_phone, user.telegram_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Yangi raqam boshqa foydalanuvchida")
    await set_phone_everywhere(session, user, req.new_phone)
    req.status = PhoneChangeStatus.done
    await session.commit()
    bg.add_task(notify.phone_changed, user.id, req.old_phone, req.new_phone)
    return req
