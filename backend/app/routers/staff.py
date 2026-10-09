"""«Ishga tayinlash»: ro'yxatdan o'tganlar orasidan qidirish, rol va filial berish, rolni olib qo'yish, vakolatni topshirish.

Kim nima qila oladi:
- Hududiy menejer — o'z filiallaridagi odamlarga mentor yoki admin rolini beradi (adminning filialini o'zgartirmaydi).
- Umumiy menejer — hududiy menejerlarni ham tayinlaydi, adminlar filialini belgilaydi, vakolatini topshiradi.
- Superadmin — istalgan odamga istalgan rolni beradi va olib qo'yadi.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import ManagerUser
from app.models import Branch, ManagerBranch, Role, User, UserStatus, role_level
from app.routers.auth import _token
from app.schemas import BranchShort, TokenOut, UserOut
from app.scope import branch_ids, in_scope

router = APIRouter(prefix="/admin/staff", tags=["Ishga tayinlash"])

CAN_GIVE = {
    Role.regional_manager: [Role.mentor, Role.admin],
    Role.general_manager: [Role.mentor, Role.admin, Role.regional_manager],
    Role.superadmin: [Role.student, Role.parent, Role.mentor, Role.admin, Role.regional_manager, Role.general_manager],
}
GENERAL = (Role.general_manager, Role.superadmin)


class StaffOut(UserOut):
    manager_branches: list[BranchShort] = []
    allowed_roles: list[Role] = []
    can_change_branch: bool = False
    can_revoke: bool = False
    can_transfer: bool = False


class StaffUpdateIn(BaseModel):
    role: Role
    branch_id: int | None = None                   # admin va mentor uchun asosiy filial
    branch_ids: list[int] = Field(default=[])      # hududiy menejer filiallari


class TransferIn(BaseModel):
    keep: str = Field(pattern=r"^(regional_manager|none)$")  # o'zim: hududiy menejer bo'lib qolaman | rolsiz


async def _manager_branches(session: AsyncSession, user_id: int) -> list[Branch]:
    return list(await session.scalars(
        select(Branch).join(ManagerBranch, ManagerBranch.branch_id == Branch.id).where(ManagerBranch.manager_id == user_id)
    ))


def _outranks(actor: User, target: User) -> bool:
    return actor.role == Role.superadmin or role_level(actor.role) > role_level(target.role)


async def _visible(session: AsyncSession, actor: User, target: User) -> bool:
    if actor.role in GENERAL:
        return True
    return in_scope(await branch_ids(session, actor), target.branch_id)


async def _out(session: AsyncSession, actor: User, target: User) -> StaffOut:
    out = StaffOut.model_validate(target)
    out.manager_branches = [BranchShort.model_validate(b) for b in await _manager_branches(session, target.id)]
    editable = target.id != actor.id and _outranks(actor, target)
    out.allowed_roles = CAN_GIVE.get(actor.role, []) if editable else []
    out.can_change_branch = editable and actor.role in GENERAL
    out.can_revoke = editable and target.role is not None
    out.can_transfer = actor.role == Role.general_manager and target.id != actor.id and target.status != UserStatus.blocked
    return out


async def _target(session: AsyncSession, actor: User, user_id: int) -> User:
    target = await session.get(User, user_id)
    if target is None or not await _visible(session, actor, target):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foydalanuvchi topilmadi")
    return target


@router.get("", response_model=list[StaffOut])
async def search(q: str | None = Query(default=None, max_length=60), role: Role | None = None,
                 limit: int = Query(default=40, le=100), actor: User = ManagerUser,
                 session: AsyncSession = Depends(get_session)):
    """Ro'yxatdan o'tganlar bo'yicha umumiy qidiruv (ism, familiya yoki telefon)."""
    stmt = select(User).order_by(User.last_name, User.first_name).limit(limit)
    scope = await branch_ids(session, actor)
    if scope is not None:
        stmt = stmt.where(User.branch_id.in_(scope or {-1}))
    if role:
        stmt = stmt.where(User.role == role)
    if q and q.strip():
        like = f"%{q.strip()}%"
        digits = "".join(ch for ch in q if ch.isdigit())
        conds = [User.first_name.ilike(like), User.last_name.ilike(like)]
        if len(digits) >= 3:
            conds.append(User.phone.like(f"%{digits}%"))
        stmt = stmt.where(or_(*conds))
    return [await _out(session, actor, u) for u in await session.scalars(stmt)]


@router.get("/{user_id}", response_model=StaffOut)
async def detail(user_id: int, actor: User = ManagerUser, session: AsyncSession = Depends(get_session)):
    return await _out(session, actor, await _target(session, actor, user_id))


@router.put("/{user_id}", response_model=StaffOut)
async def update(user_id: int, data: StaffUpdateIn, actor: User = ManagerUser,
                 session: AsyncSession = Depends(get_session)):
    target = await _target(session, actor, user_id)
    if target.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O'z rolingizni o'zgartira olmaysiz")
    if not _outranks(actor, target) or data.role not in CAN_GIVE.get(actor.role, []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu rolni berishga ruxsatingiz yo'q")

    scope = await branch_ids(session, actor)
    branch_id = data.branch_id if data.branch_id is not None else target.branch_id
    if branch_id is not None:
        branch = await session.get(Branch, branch_id)
        if branch is None or not in_scope(scope, branch_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Filial topilmadi")
    if data.role == Role.admin:
        if branch_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin qaysi filialda ishlashini tanlang")
        # Admin faqat bitta filialda ishlaydi va uni faqat umumiy menejer belgilaydi
        if actor.role not in GENERAL and target.role == Role.admin and branch_id != target.branch_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Adminning filialini faqat umumiy menejer o'zgartiradi")
    if data.branch_id is not None and data.branch_id != target.branch_id and actor.role not in GENERAL \
            and data.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Filialni faqat umumiy menejer o'zgartiradi")

    role_changed = target.role != data.role
    target.role, target.branch_id = data.role, branch_id
    target.status, target.awaiting_manager = UserStatus.active, False
    await session.execute(delete(ManagerBranch).where(ManagerBranch.manager_id == target.id))
    if data.role == Role.regional_manager:
        for bid in set(data.branch_ids):
            if await session.get(Branch, bid) is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Filial topilmadi")
            session.add(ManagerBranch(manager_id=target.id, branch_id=bid))
    if role_changed:
        target.token_version += 1  # ilova qayta ochilganda yangi rol bilan kiradi
    await session.commit()
    await session.refresh(target, ["branch"])
    return await _out(session, actor, target)


@router.post("/{user_id}/revoke", response_model=StaffOut)
async def revoke(user_id: int, actor: User = ManagerUser, session: AsyncSession = Depends(get_session)):
    """Rolni olib qo'yish: odam «kutilmoqda» holatiga qaytadi."""
    target = await _target(session, actor, user_id)
    if target.id == actor.id or not _outranks(actor, target):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ruxsat yo'q")
    await session.execute(delete(ManagerBranch).where(ManagerBranch.manager_id == target.id))
    target.role, target.status, target.awaiting_manager = None, UserStatus.pending, False
    target.token_version += 1
    await session.commit()
    await session.refresh(target, ["branch"])
    return await _out(session, actor, target)


@router.post("/{user_id}/transfer", response_model=TokenOut)
async def transfer(user_id: int, data: TransferIn, actor: User = ManagerUser,
                   session: AsyncSession = Depends(get_session)):
    """Umumiy menejer vakolatini boshqa odamga topshiradi. O'zi hududiy menejer bo'lib qoladi yoki rolsiz."""
    if actor.role != Role.general_manager:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Vakolatni faqat umumiy menejer topshiradi")
    target = await _target(session, actor, user_id)
    if target.id == actor.id or target.status == UserStatus.blocked:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bu odamga topshirib bo'lmaydi")
    await session.execute(delete(ManagerBranch).where(ManagerBranch.manager_id == target.id))
    target.role, target.status, target.awaiting_manager = Role.general_manager, UserStatus.active, False
    target.token_version += 1
    if data.keep == "regional_manager":
        actor.role = Role.regional_manager
    else:
        actor.role, actor.status = None, UserStatus.pending
    await session.commit()
    await session.refresh(actor, ["branch"])
    return _token(actor)
