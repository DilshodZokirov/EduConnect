from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import OtpPurpose, Role, User, UserStatus
from app.schemas import (
    LoginIn, PasswordResetFinishIn, PasswordResetStartIn, RegisterIn, TokenOut, UserOut,
)
from app.security import (
    InitDataError, create_access_token, hash_password, validate_init_data, verify_password,
)
from app.services import notify
from app.services.otp import issue_otp, verify_otp

router = APIRouter(prefix="/auth", tags=["Auth"])


def _tg_user(init_data: str) -> dict:
    try:
        return validate_init_data(init_data)
    except InitDataError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Telegram ma'lumoti yaroqsiz: {exc}")


async def _user_by_init_data(session: AsyncSession, init_data: str) -> User:
    tg = _tg_user(init_data)
    user = await session.scalar(select(User).where(User.telegram_id == tg["id"]))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not_registered")
    return user


def _token(user: User) -> TokenOut:
    return TokenOut(access_token=create_access_token(user.id, user.token_version), user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(data: RegisterIn, bg: BackgroundTasks, session: AsyncSession = Depends(get_session)):
    """Ro'yxatdan o'tish. Foydalanuvchi 'pending' holatida yaratiladi, rolni admin beradi."""
    tg = _tg_user(data.init_data)

    if await session.scalar(select(User.id).where(User.telegram_id == tg["id"])):
        raise HTTPException(status.HTTP_409_CONFLICT, "Siz allaqachon ro'yxatdan o'tgansiz")
    if await session.scalar(select(User.id).where(User.phone == data.phone)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu telefon raqam band")

    user = User(telegram_id=tg["id"], first_name=data.first_name, last_name=data.last_name, phone=data.phone)
    if tg["id"] in settings.superadmin_telegram_ids:
        user.role, user.status = Role.superadmin, UserStatus.active

    session.add(user)
    await session.commit()
    await session.refresh(user)

    if user.status == UserStatus.pending:
        bg.add_task(notify.new_user_registered, user.id)
    return _token(user)


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn, session: AsyncSession = Depends(get_session)):
    """Web App ochilganda chaqiriladi. Parol o'rnatilgan bo'lsa — parol ham kerak.

    Javoblar: 404 not_registered → ro'yxatdan o'tish sahifasi;
    401 password_required → parol so'rash ekrani; 423 → vaqtincha bloklangan.
    """
    user = await _user_by_init_data(session, data.init_data)
    if user.status == UserStatus.blocked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Profil bloklangan")

    now = datetime.now(timezone.utc)
    if user.locked_until and user.locked_until > now:
        minutes = int((user.locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(status.HTTP_423_LOCKED, f"Kirish bloklangan. {minutes} daqiqadan keyin urinib ko'ring")

    if user.password_hash:
        if not data.password:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "password_required")
        if not verify_password(data.password, user.password_hash):
            user.failed_logins += 1
            left = settings.login_max_attempts - user.failed_logins
            if left <= 0:
                user.failed_logins = 0
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                await session.commit()
                raise HTTPException(
                    status.HTTP_423_LOCKED,
                    f"Parol {settings.login_max_attempts} marta noto'g'ri kiritildi. "
                    f"Kirish {settings.login_lock_minutes} daqiqaga bloklandi",
                )
            await session.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Parol noto'g'ri. Qolgan urinishlar: {left}")

    user.failed_logins, user.locked_until = 0, None
    await session.commit()
    return _token(user)


@router.post("/password-reset/start", status_code=204)
async def password_reset_start(data: PasswordResetStartIn, session: AsyncSession = Depends(get_session)):
    """Parolni unutganda: profildagi telefon raqamga SMS kod yuboriladi."""
    user = await _user_by_init_data(session, data.init_data)
    if not user.password_hash:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Parol o'rnatilmagan")
    await issue_otp(session, user.id, user.phone, OtpPurpose.password_reset)


@router.post("/password-reset/finish", response_model=TokenOut)
async def password_reset_finish(data: PasswordResetFinishIn, session: AsyncSession = Depends(get_session)):
    user = await _user_by_init_data(session, data.init_data)
    await verify_otp(session, user.id, OtpPurpose.password_reset, data.code)
    user.password_hash = hash_password(data.new_password)
    user.failed_logins, user.locked_until = 0, None
    user.token_version += 1  # boshqa qurilmalardagi seanslar yopiladi
    await session.commit()
    return _token(user)
