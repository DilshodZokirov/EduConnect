"""Profillar: bitta Telegram hisobida bir nechta rol (masalan, superadmin va mentor) — alohida profil sifatida.

- GET  /me/profiles              — mening profillarim
- POST /me/profiles/switch       — boshqa profilga o'tish (yangi token)
- POST /me/profiles              — xodim profili so'rash (mentor yoki admin)
- POST /join/{token}/new-profile — guruh havolasi orqali o'quvchi/ota-ona profili qo'shish (masalan, sinash uchun)
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import Branch, Role, User, UserStatus
from app.routers.auth import _token
from app.routers.invites import clear_pending
from app.schemas import JoinNewProfileIn, ProfileCreateIn, ProfileOut, ProfileSwitchIn, TokenOut
from app.services import notify
from app.services.invites import group_by_token, join_as_parent, join_as_student
from app.services.profiles import new_profile_from, profiles_of, touch

router = APIRouter(tags=["Profillar"])
MAX_PROFILES = 6
STAFF_ROLES = {Role.mentor, Role.admin, Role.regional_manager, Role.general_manager, Role.superadmin}


def _out(p: User, current: User) -> ProfileOut:
    return ProfileOut(id=p.id, role=p.role, status=p.status, requested_role=p.requested_role,
                      awaiting_manager=p.awaiting_manager, branch_name=p.branch_name,
                      has_password=p.has_password, current=p.id == current.id)


@router.get("/me/profiles", response_model=list[ProfileOut])
async def my_profiles(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return [_out(p, user) for p in await profiles_of(session, user.telegram_id)]


@router.post("/me/profiles/switch", response_model=TokenOut)
async def switch_profile(data: ProfileSwitchIn, user: User = Depends(get_current_user),
                         session: AsyncSession = Depends(get_session)):
    target = await session.get(User, data.profile_id)
    if target is None or target.telegram_id != user.telegram_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profil topilmadi")
    if target.status == UserStatus.blocked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu profil bloklangan")
    touch(target)
    await session.commit()
    await session.refresh(target, ["branch"])
    return _token(target)


async def _check_limit(session: AsyncSession, user: User) -> list[User]:
    profiles = await profiles_of(session, user.telegram_id)
    if len(profiles) >= MAX_PROFILES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Bitta Telegram hisobida eng ko'pi {MAX_PROFILES} ta profil bo'ladi")
    return profiles


@router.post("/me/profiles", response_model=TokenOut, status_code=201)
async def request_staff_profile(data: ProfileCreateIn, bg: BackgroundTasks, user: User = Depends(get_current_user),
                                session: AsyncSession = Depends(get_session)):
    """Xodim profili so'rash: mentor so'rovi filial adminiga, admin so'rovi umumiy menejerga boradi."""
    profiles = await _check_limit(session, user)
    wanted = Role.mentor if data.requested_role == "mentor" else None
    for p in profiles:
        if p.status != UserStatus.blocked and (
            (wanted and p.role == wanted)
            or (p.status == UserStatus.pending and p.requested_role == data.requested_role)
            or (data.requested_role == "admin" and p.role in STAFF_ROLES - {Role.mentor})
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Sizda bunday profil yoki so'rov allaqachon bor")
    branch_id = data.branch_id or user.branch_id
    if branch_id and not await session.get(Branch, branch_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Filial topilmadi")
    new = new_profile_from(user, branch_id=branch_id, requested_role=data.requested_role, status=UserStatus.pending)
    # Superadmin o'zi uchun mentor profili ochsa — tasdiq kutmaydi
    if user.role == Role.superadmin and user.status == UserStatus.active and data.requested_role == "mentor":
        new.role, new.status = Role.mentor, UserStatus.active
    session.add(new)
    await session.commit()
    await session.refresh(new, ["branch"])
    if new.status == UserStatus.pending:
        bg.add_task(notify.new_user_registered, new.id)
    return _token(new)


@router.post("/join/{token}/new-profile", response_model=TokenOut, status_code=201)
async def join_as_new_profile(token: str, data: JoinNewProfileIn, bg: BackgroundTasks,
                              user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Guruh havolasini ochgan xodim (yoki boshqa roldagi) o'quvchi/ota-ona sifatida alohida profil ochadi."""
    group = await group_by_token(session, token)
    profiles = await _check_limit(session, user)
    wanted = Role.student if data.join_as == "student" else Role.parent
    existing = next((p for p in profiles if p.role == wanted and p.status != UserStatus.blocked), None)
    new = existing or new_profile_from(user, branch_id=group.branch_id)
    if existing is None:
        session.add(new)
        await session.flush()
    links = []
    joined = False
    if data.join_as == "student":
        joined = await join_as_student(session, new, group)
    else:
        links = await join_as_parent(session, new, group, data.child_ids)
    touch(new)
    await clear_pending(session, user.telegram_id)
    await session.commit()
    await session.refresh(new, ["branch"])
    if joined:
        bg.add_task(notify.student_joined, group.id, new.id)
    for link in links:
        bg.add_task(notify.parent_requested, link.id)
    return _token(new)
