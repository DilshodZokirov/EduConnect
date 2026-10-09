from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import Branch, LoginCode, OtpPurpose, Role, User, UserStatus
from sqlalchemy import func
from app.schemas import (
    CodeLoginIn, LoginIn, PasswordResetFinishIn, PasswordResetStartIn, RegisterIn, TokenOut, UserOut,
)
from app.security import (
    InitDataError, create_access_token, hash_password, validate_init_data, verify_password,
)
from app.services import notify
from app.services.invites import group_by_token, join_as_parent, join_as_student
from app.services.otp import issue_otp, verify_otp
from app.services.profiles import phone_taken, pick_profile, touch

router = APIRouter(prefix="/auth", tags=["Auth"])


def _tg_user(init_data: str) -> dict:
    try:
        return validate_init_data(init_data)
    except InitDataError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Telegram ma'lumoti yaroqsiz: {exc}")


async def _user_by_init_data(session: AsyncSession, init_data: str) -> User:
    tg = _tg_user(init_data)
    user = await pick_profile(session, tg["id"])
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
    if await phone_taken(session, data.phone, tg["id"]):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu telefon raqam band")

    group = None
    if data.invite_token:
        # Guruh havolasi orqali: o'quvchi darhol guruhga qo'shiladi, ota-ona keyin farzandini tanlaydi
        group = await group_by_token(session, data.invite_token)
        if not data.join_as:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "O'quvchi yoki ota-ona ekaningizni tanlang")
        branch_id = group.branch_id
    else:
        has_branches = await session.scalar(select(func.count()).select_from(Branch).where(Branch.is_active.is_(True)))
        if has_branches:
            branch = await session.get(Branch, data.branch_id) if data.branch_id else None
            if branch is None or not branch.is_active:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Filialni tanlang")
        branch_id = data.branch_id if has_branches else None

    user = User(telegram_id=tg["id"], first_name=data.first_name, last_name=data.last_name, phone=data.phone,
                branch_id=branch_id, requested_role=None if group else (data.requested_role or "mentor"),
                last_active_at=datetime.now(timezone.utc))
    if tg["id"] in settings.superadmin_telegram_ids:
        user.role, user.status = Role.superadmin, UserStatus.active
    session.add(user)
    await session.flush()

    joined_student = False
    if group:
        from app.routers.invites import clear_pending  # noqa: PLC0415
        await clear_pending(session, user.telegram_id)
    if group and user.role is None:
        if data.join_as == "student":
            joined_student = await join_as_student(session, user, group)
        else:
            await join_as_parent(session, user, group, [])
    await session.commit()
    await session.refresh(user, ["branch"])

    if user.status == UserStatus.pending:
        bg.add_task(notify.new_user_registered, user.id)  # havolasiz: admin o'qituvchi yoki admin qiladi
    if joined_student:
        bg.add_task(notify.student_joined, group.id, user.id)
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
    touch(user)
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


@router.post("/code-login", response_model=TokenOut)
async def code_login(data: CodeLoginIn, session: AsyncSession = Depends(get_session)):
    """Bir martalik kod bilan kirish (Telegram'dan tashqari brauzerda — masalan, ekranni yozish uchun)."""
    from app.routers.recording import hash_code  # noqa: PLC0415

    now = datetime.now(timezone.utc)
    rec = await session.scalar(select(LoginCode).where(LoginCode.code_hash == hash_code(data.code)).with_for_update())
    if rec is None or rec.used_at is not None or rec.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Havola eskirgan yoki allaqachon ishlatilgan. Ilovadan yangisini oling.")
    user = await session.get(User, rec.user_id)
    if user is None or user.status != UserStatus.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Kirish mumkin emas")
    rec.used_at = now
    await session.commit()
    return _token(user)
