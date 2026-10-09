"""Guruh reytingi — o'quvchi, ota-ona, o'qituvchi va xodimlar uchun."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_not_locked, get_current_user
from app.models import Group, User, UserStatus
from app.routers.common import can_access_group
from app.schemas import RatingHero, RatingOut, RatingRow, UserShort
from app.services import rating

router = APIRouter(tags=["Reyting"])
MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]


@router.get("/rating/groups/{group_id}", response_model=RatingOut)
async def group_rating(group_id: int, period: str = Query(default="week", pattern=r"^(week|month)$"),
                       offset: int = Query(default=0, ge=-24, le=0),
                       user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Butun guruh ro'yxati: 1–3-o'rinlar alohida ranglarda ko'rsatiladi (frontend)."""
    group = await session.get(Group, group_id)
    if group is None or user.status != UserStatus.active or not await can_access_group(session, user, group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    await assert_not_locked(session, user)

    start, end = rating.period_bounds(period, offset)
    cur = await rating.compute(session, group_id, start, end)
    prev_start, prev_end = rating.period_bounds(period, offset - 1)
    prev = await rating.compute(session, group_id, prev_start, prev_end)
    has_prev = prev["max_points"] > 0
    medals = await rating.medals(session, group_id)

    rows = []
    for u in cur["students"]:
        prev_rank = prev["ranks"].get(u.id) if has_prev else None
        rows.append(RatingRow(
            student=UserShort.model_validate(u), rank=cur["ranks"][u.id], points=cur["totals"][u.id],
            homework_points=cur["hw"][u.id], test_points=cur["tp"][u.id], prev_rank=prev_rank,
            delta=(prev_rank - cur["ranks"][u.id]) if prev_rank else None, medals=medals.get(u.id, 0),
        ))
    # «O'tgan oy faxri»: o'tgan kalendar oyining 1-o'rni (teng ball bo'lsa — bir nechta)
    m_start, m_end = rating.period_bounds("month", -1)
    if period == "month" and offset == -1:
        last = cur
    elif period == "month" and offset == 0:
        last = prev
    else:
        last = await rating.compute(session, group_id, m_start, m_end)
    heroes = []
    if last["max_points"] > 0:
        top = [u for u in last["students"] if last["ranks"][u.id] == 1 and last["totals"][u.id] > 0]
        heroes = [RatingHero(student=UserShort.model_validate(u), points=last["totals"][u.id]) for u in top[:3]]
    return RatingOut(group_id=group.id, group_name=group.name, period=period, period_start=start,
                     period_end=end - rating.timedelta(days=1), max_points=cur["max_points"],
                     homework_count=cur["homework_count"], pending=cur["pending"], rows=rows,
                     last_month=MONTHS[m_start.month - 1], last_month_heroes=heroes)
