"""Bir Telegram hisobidagi profillar (masalan: superadmin + mentor, yoki sinov uchun o'quvchi/ota-ona)."""
from datetime import datetime, timezone

from sqlalchemy import case, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserStatus


async def profiles_of(session: AsyncSession, telegram_id: int) -> list[User]:
    return list(await session.scalars(
        select(User).where(User.telegram_id == telegram_id).order_by(User.id)
    ))


async def pick_profile(session: AsyncSession, telegram_id: int) -> User | None:
    """Ilova ochilganda: oxirgi foydalanilgan, bloklanmagan profil."""
    return await session.scalar(
        select(User).where(User.telegram_id == telegram_id)
        .order_by(case((User.status == UserStatus.blocked, 1), else_=0),
                  User.last_active_at.desc().nulls_last(), User.id)
        .limit(1)
    )


async def phone_taken(session: AsyncSession, phone: str, telegram_id: int | None) -> bool:
    """Raqam boshqa odamda (boshqa Telegram hisobida) bormi. O'z profillari hisobga olinmaydi."""
    stmt = select(User.id).where(User.phone == phone)
    if telegram_id is not None:
        stmt = stmt.where(User.telegram_id != telegram_id)
    return await session.scalar(stmt.limit(1)) is not None


async def set_phone_everywhere(session: AsyncSession, user: User, phone: str) -> None:
    """Telefon odamga tegishli — barcha profillarida birdaniga o'zgaradi."""
    await session.execute(update(User).where(User.telegram_id == user.telegram_id).values(phone=phone))
    user.phone = phone


def touch(user: User) -> None:
    user.last_active_at = datetime.now(timezone.utc)


def new_profile_from(base: User, **fields) -> User:
    """Shu odamning yangi profili: ism, familiya, telefon va Telegram bir xil."""
    return User(telegram_id=base.telegram_id, first_name=base.first_name, last_name=base.last_name,
                phone=base.phone, password_hash=base.password_hash, notify_prefs=dict(base.notify_prefs or {}),
                last_active_at=datetime.now(timezone.utc), **fields)
