from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import OtpPurpose, PhoneChangeRequest, PhoneChangeStatus, User
from app.schemas import (
    DebtOut, LockOut,
    CodeIn, PasswordRemoveIn, PasswordSetIn, PhoneChangeOut, PhoneChangeStartIn, ProfileUpdateIn,
    TokenOut, UserOut,
)
from app.security import create_access_token, hash_password, verify_password
from app.config import settings
from app.services import billing, notify
from app.services.otp import issue_otp, verify_otp

router = APIRouter(prefix="/me", tags=["Profil"])

ACTIVE_PHONE_STATUSES = (
    PhoneChangeStatus.awaiting_new, PhoneChangeStatus.awaiting_old, PhoneChangeStatus.awaiting_admin,
)


def _token(user: User) -> TokenOut:
    return TokenOut(access_token=create_access_token(user.id, user.token_version), user=UserOut.model_validate(user))


@router.get("", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.get("/lock", response_model=LockOut)
async def lock_status(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """O'quvchi/ota-ona ilovasi to'lov sababli qulflanganmi va qancha qarz bor."""
    ids = await billing.learner_student_ids(session, user)
    debts = await billing.overdue_debts(session, ids)
    from app.models import Role  # noqa: PLC0415

    return LockOut(
        locked=bool(debts),
        show_amounts=user.role != Role.student or user.self_guardian,
        debts=[DebtOut(student_name=u.full_name, group_name=g, period=i.period,
                       left=i.amount - i.paid_amount, due_date=i.due_date) for i, u, g in debts],
        support_phone=settings.support_phone or None,
    )


@router.patch("", response_model=UserOut)
async def update_me(data: ProfileUpdateIn, user: User = Depends(get_current_user),
                    session: AsyncSession = Depends(get_session)):
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(user, field, value.strip())
    await session.commit()
    return user


# ---------- Parol ----------

@router.post("/password", response_model=TokenOut)
async def set_password(data: PasswordSetIn, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    """Parol o'rnatish yoki almashtirish. Boshqa qurilmalardagi seanslar yopiladi."""
    if user.password_hash:
        if not data.current_password or not verify_password(data.current_password, user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Joriy parol noto'g'ri")
    user.password_hash = hash_password(data.new_password)
    user.token_version += 1
    await session.commit()
    return _token(user)


@router.delete("/password", response_model=TokenOut)
async def remove_password(data: PasswordRemoveIn, user: User = Depends(get_current_user),
                          session: AsyncSession = Depends(get_session)):
    if not user.password_hash or not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Joriy parol noto'g'ri")
    user.password_hash = None
    user.token_version += 1
    await session.commit()
    return _token(user)


@router.post("/sessions/revoke", response_model=TokenOut)
async def revoke_sessions(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Barcha qurilmalardan chiqish (joriy qurilma uchun yangi token qaytadi)."""
    user.token_version += 1
    await session.commit()
    return _token(user)


# ---------- Telefon raqamni o'zgartirish ----------
# 1) /phone/start       -> yangi raqamga kod
# 2) /phone/verify-new  -> eski raqamga rozilik kodi
# 3) /phone/verify-old  -> raqam almashadi, ikkala raqamga xabar
#    yoki /phone/request-admin -> eski raqam yo'q bo'lsa, admin tasdiqlaydi

async def _active_request(session: AsyncSession, user_id: int, expected: PhoneChangeStatus) -> PhoneChangeRequest:
    req = await session.scalar(
        select(PhoneChangeRequest)
        .where(PhoneChangeRequest.user_id == user_id, PhoneChangeRequest.status == expected)
        .order_by(PhoneChangeRequest.created_at.desc())
        .limit(1)
    )
    if req is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Faol so'rov topilmadi, jarayonni boshidan boshlang")
    return req


@router.get("/phone", response_model=PhoneChangeOut | None)
async def phone_change_status(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await session.scalar(
        select(PhoneChangeRequest)
        .where(PhoneChangeRequest.user_id == user.id, PhoneChangeRequest.status.in_(ACTIVE_PHONE_STATUSES))
        .order_by(PhoneChangeRequest.created_at.desc())
        .limit(1)
    )


@router.post("/phone/start", response_model=PhoneChangeOut)
async def phone_start(data: PhoneChangeStartIn, user: User = Depends(get_current_user),
                      session: AsyncSession = Depends(get_session)):
    if data.new_phone == user.phone:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bu sizning hozirgi raqamingiz")
    if await session.scalar(select(User.id).where(User.phone == data.new_phone)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu raqam boshqa foydalanuvchida")

    await session.execute(
        update(PhoneChangeRequest)
        .where(PhoneChangeRequest.user_id == user.id, PhoneChangeRequest.status.in_(ACTIVE_PHONE_STATUSES))
        .values(status=PhoneChangeStatus.cancelled)
    )
    req = PhoneChangeRequest(user_id=user.id, old_phone=user.phone, new_phone=data.new_phone)
    session.add(req)
    await session.commit()
    await issue_otp(session, user.id, data.new_phone, OtpPurpose.phone_new)
    await session.refresh(req)
    return req


@router.post("/phone/verify-new", response_model=PhoneChangeOut)
async def phone_verify_new(data: CodeIn, user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    req = await _active_request(session, user.id, PhoneChangeStatus.awaiting_new)
    await verify_otp(session, user.id, OtpPurpose.phone_new, data.code)
    req.status = PhoneChangeStatus.awaiting_old
    await session.commit()
    await issue_otp(session, user.id, req.old_phone, OtpPurpose.phone_old)
    await session.refresh(req)
    return req


@router.post("/phone/verify-old", response_model=UserOut)
async def phone_verify_old(data: CodeIn, bg: BackgroundTasks, user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    req = await _active_request(session, user.id, PhoneChangeStatus.awaiting_old)
    await verify_otp(session, user.id, OtpPurpose.phone_old, data.code)
    if await session.scalar(select(User.id).where(User.phone == req.new_phone, User.id != user.id)):
        req.status = PhoneChangeStatus.cancelled
        await session.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu raqam boshqa foydalanuvchida")

    user.phone = req.new_phone
    req.status = PhoneChangeStatus.done
    await session.commit()
    bg.add_task(notify.phone_changed, user.id, req.old_phone, req.new_phone)
    return user


@router.post("/phone/resend", status_code=204)
async def phone_resend(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Joriy qadam uchun SMS kodni qayta yuborish (60 soniyada bir marta)."""
    req = await session.scalar(
        select(PhoneChangeRequest)
        .where(PhoneChangeRequest.user_id == user.id,
               PhoneChangeRequest.status.in_([PhoneChangeStatus.awaiting_new, PhoneChangeStatus.awaiting_old]))
        .order_by(PhoneChangeRequest.created_at.desc())
        .limit(1)
    )
    if req is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Faol so'rov topilmadi, jarayonni boshidan boshlang")
    if req.status == PhoneChangeStatus.awaiting_new:
        await issue_otp(session, user.id, req.new_phone, OtpPurpose.phone_new)
    else:
        await issue_otp(session, user.id, req.old_phone, OtpPurpose.phone_old)


@router.post("/phone/cancel", status_code=204)
async def phone_cancel(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await session.execute(
        update(PhoneChangeRequest)
        .where(PhoneChangeRequest.user_id == user.id, PhoneChangeRequest.status.in_(ACTIVE_PHONE_STATUSES))
        .values(status=PhoneChangeStatus.cancelled)
    )
    await session.commit()


@router.post("/phone/request-admin", response_model=PhoneChangeOut)
async def phone_request_admin(bg: BackgroundTasks, user: User = Depends(get_current_user),
                              session: AsyncSession = Depends(get_session)):
    """Eski raqam qo'lda bo'lmasa: yangi raqam tasdiqlangan, so'rov adminga o'tadi."""
    req = await _active_request(session, user.id, PhoneChangeStatus.awaiting_old)
    req.status = PhoneChangeStatus.awaiting_admin
    await session.commit()
    bg.add_task(notify.phone_change_needs_admin, req.id)
    return req
