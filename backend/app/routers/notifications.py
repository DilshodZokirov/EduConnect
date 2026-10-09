"""Ilova ichidagi bildirishnomalar (qo'ng'iroqcha), xabar sozlamalari va ob-havo."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import Branch, Notification, User
from app.schemas import NotificationListOut, NotificationOut, NotifyPrefsIn, WeatherOut
from app.services import weather
from app.services.inbox import MANDATORY_KINDS, OPTIONAL_KINDS

router = APIRouter(tags=["Bildirishnomalar"])


async def _unread(session: AsyncSession, user_id: int) -> int:
    return await session.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == user_id, Notification.read_at.is_(None))) or 0


@router.get("/notifications", response_model=NotificationListOut)
async def list_notifications(before_id: int | None = None, limit: int = Query(default=30, ge=1, le=100),
                             user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if before_id:
        stmt = stmt.where(Notification.id < before_id)
    rows = list(await session.scalars(stmt.order_by(Notification.id.desc()).limit(limit + 1)))
    return NotificationListOut(
        items=[NotificationOut.model_validate(n) for n in rows[:limit]],
        unread=await _unread(session, user.id),
        has_more=len(rows) > limit,
    )


@router.get("/notifications/unread")
async def unread_count(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return {"count": await _unread(session, user.id)}


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: int, user: User = Depends(get_current_user),
                    session: AsyncSession = Depends(get_session)):
    n = await session.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bildirishnoma topilmadi")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        await session.commit()
    return n


@router.post("/notifications/read-all")
async def mark_all_read(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await session.execute(update(Notification).where(
        Notification.user_id == user.id, Notification.read_at.is_(None)).values(read_at=datetime.now(timezone.utc)))
    await session.commit()
    return {"count": 0}


@router.get("/me/notify-prefs")
async def get_prefs(user: User = Depends(get_current_user)):
    prefs = user.notify_prefs or {}
    return {
        "optional": [{"key": k, "label": v, "enabled": prefs.get(k, True)} for k, v in OPTIONAL_KINDS.items()],
        "mandatory": [{"key": k, "label": v} for k, v in MANDATORY_KINDS.items()],
    }


@router.put("/me/notify-prefs")
async def set_prefs(data: NotifyPrefsIn, user: User = Depends(get_current_user),
                    session: AsyncSession = Depends(get_session)):
    user.notify_prefs = {k: bool(v) for k, v in data.prefs.items() if k in OPTIONAL_KINDS}
    await session.commit()
    return await get_prefs(user)


@router.get("/weather", response_model=WeatherOut | None)
async def current_weather(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Foydalanuvchi filiali joylashgan shahar bo'yicha (filialsiz bo'lsa — birinchi filial yoki Toshkent)."""
    city = user.branch.city if user.branch else None
    if not city:
        city = await session.scalar(select(Branch.city).where(Branch.city.is_not(None), Branch.is_active.is_(True)).limit(1))
    return await weather.current(city)


@router.get("/public/cities")
async def cities():
    return [{"key": k, "name": v[0]} for k, v in weather.CITIES.items()]
