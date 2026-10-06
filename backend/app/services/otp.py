from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Otp, OtpPurpose
from app.security import generate_otp, hash_otp
from app.services.sms import send_sms

MESSAGES = {
    OtpPurpose.phone_new: "EduConnect: yangi raqamni tasdiqlash kodi: {code}. Hech kimga bermang.",
    OtpPurpose.phone_old: "EduConnect: raqamingizni o'zgartirish so'raldi. Rozi bo'lsangiz kod: {code}. "
                          "Agar bu siz bo'lmasangiz, kodni hech kimga bermang.",
    OtpPurpose.password_reset: "EduConnect: parolni tiklash kodi: {code}. Hech kimga bermang.",
}


async def issue_otp(session: AsyncSession, user_id: int, phone: str, purpose: OtpPurpose) -> None:
    now = datetime.now(timezone.utc)

    last = await session.scalar(
        select(Otp)
        .where(Otp.user_id == user_id, Otp.purpose == purpose)
        .order_by(Otp.created_at.desc())
        .limit(1)
    )
    if last and (now - last.created_at).total_seconds() < settings.otp_resend_seconds:
        wait = settings.otp_resend_seconds - int((now - last.created_at).total_seconds())
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Kodni {wait} soniyadan keyin qayta so'rang")

    # Avvalgi ishlatilmagan kodlarni bekor qilish
    await session.execute(
        update(Otp).where(Otp.user_id == user_id, Otp.purpose == purpose, Otp.used.is_(False)).values(used=True)
    )
    code = generate_otp()
    session.add(Otp(
        user_id=user_id, phone=phone, purpose=purpose, code_hash=hash_otp(code),
        expires_at=now + timedelta(seconds=settings.otp_ttl_seconds),
    ))
    await session.commit()

    if not await send_sms(phone, MESSAGES[purpose].format(code=code)):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "SMS yuborib bo'lmadi, birozdan keyin urinib ko'ring")


async def verify_otp(session: AsyncSession, user_id: int, purpose: OtpPurpose, code: str) -> Otp:
    otp = await session.scalar(
        select(Otp)
        .where(Otp.user_id == user_id, Otp.purpose == purpose, Otp.used.is_(False))
        .order_by(Otp.created_at.desc())
        .limit(1)
    )
    if otp is None or otp.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kod topilmadi yoki muddati o'tgan")
    if otp.attempts >= settings.otp_max_attempts:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Urinishlar tugadi, yangi kod so'rang")

    if otp.code_hash != hash_otp(code):
        otp.attempts += 1
        await session.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kod noto'g'ri")

    otp.used = True
    await session.commit()
    return otp
