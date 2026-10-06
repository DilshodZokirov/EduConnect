import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Role, User, UserStatus
from app.security import decode_access_token

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token kerak")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token yaroqsiz yoki muddati o'tgan")

    user = await session.get(User, int(payload["sub"]))
    if user is None or user.token_version != payload.get("tv"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Seans bekor qilingan")
    if user.status == UserStatus.blocked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Profil bloklangan")
    return user


PAYMENT_LOCKED = "payment_locked"


async def assert_not_locked(session: AsyncSession, user: User) -> None:
    """To'lov muddati o'tgan bo'lsa, o'quvchi va ota-ona hech narsadan foydalana olmaydi (423)."""
    from app.services import billing  # aylanma importdan qochish

    if user.role in (Role.student, Role.parent):
        ids = await billing.learner_student_ids(session, user)
        if await billing.overdue_debts(session, ids):
            raise HTTPException(status.HTTP_423_LOCKED, PAYMENT_LOCKED)


def require_roles(*roles: Role, check_lock: bool = False):
    """Faqat faol (tasdiqlangan) va ko'rsatilgan roldagi foydalanuvchilarni o'tkazadi."""

    async def dependency(user: User = Depends(get_current_user),
                         session: AsyncSession = Depends(get_session)) -> User:
        if user.status != UserStatus.active or user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu amal uchun ruxsat yo'q")
        if check_lock:
            await assert_not_locked(session, user)
        return user

    return dependency


AdminUser = Depends(require_roles(Role.admin, Role.superadmin))
MentorUser = Depends(require_roles(Role.mentor, Role.admin, Role.superadmin))
StudentUser = Depends(require_roles(Role.student, check_lock=True))
ParentUser = Depends(require_roles(Role.parent, check_lock=True))
# Qulflangan ota-ona ham bog'lanish so'rovini va qarzini ko'ra olishi kerak
ParentUserUnlocked = Depends(require_roles(Role.parent))
