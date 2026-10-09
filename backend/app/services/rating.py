"""Reyting: shu davrdagi uy vazifalari (har biri 100 ball) + testlar (haftasiga jami 100) ballari.
Topshirilmagan vazifa/test — 0 ball. Ballar teng bo'lsa, o'rin ham teng (1, 1, 3 ...)."""
import calendar
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Assignment, GroupStudent, RatingAward, Submission, Test, TestAttempt, User


def tz() -> ZoneInfo:
    return ZoneInfo(settings.timezone)


def period_bounds(period: str, offset: int = 0, today: date | None = None) -> tuple[date, date]:
    """(boshlanish, keyingi davr boshlanishi) — Toshkent vaqti bo'yicha. offset=-1 — oldingi davr."""
    today = today or datetime.now(tz()).date()
    if period == "week":
        start = today - timedelta(days=today.weekday()) + timedelta(weeks=offset)
        return start, start + timedelta(days=7)
    y, m = today.year, today.month + offset
    while m < 1:
        y, m = y - 1, m + 12
    while m > 12:
        y, m = y + 1, m - 12
    start = date(y, m, 1)
    return start, start + timedelta(days=calendar.monthrange(y, m)[1])


def _dt(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=tz())


async def compute(session: AsyncSession, group_id: int, start: date, end: date) -> dict:
    s, e = _dt(start), _dt(end)
    students = list(await session.scalars(
        select(User).join(GroupStudent, GroupStudent.student_id == User.id).where(GroupStudent.group_id == group_id)))
    ids = [u.id for u in students] or [-1]
    assignments = list(await session.scalars(select(Assignment.id).where(
        Assignment.group_id == group_id, Assignment.due_at >= s, Assignment.due_at < e)))
    tests = list(await session.scalars(select(Test).where(
        Test.group_id == group_id, Test.opens_at >= s, Test.opens_at < e)))

    hw = {sid: 0.0 for sid in ids}
    pending = 0
    for sub in await session.scalars(select(Submission).where(
            Submission.assignment_id.in_(assignments or [-1]), Submission.student_id.in_(ids))):
        if sub.final_score is not None:
            hw[sub.student_id] += sub.final_score
        else:
            pending += 1

    tp = {sid: 0.0 for sid in ids}
    for t in tests:
        latest: dict[int, TestAttempt] = {}
        for a in await session.scalars(select(TestAttempt).where(
                TestAttempt.test_id == t.id, TestAttempt.student_id.in_(ids)).order_by(TestAttempt.attempt_no)):
            latest[a.student_id] = a  # oxirgi urinish hisobga olinadi
        for sid, a in latest.items():
            if a.finished_at and a.score is not None:
                tp[sid] += round(a.score * t.max_points / 100, 1)

    totals = {u.id: round(hw[u.id] + tp[u.id], 1) for u in students}
    ordered = sorted(students, key=lambda u: (-totals[u.id], u.first_name, u.last_name))
    ranks = {}
    for i, u in enumerate(ordered):
        ranks[u.id] = ranks[ordered[i - 1].id] if i and totals[u.id] == totals[ordered[i - 1].id] else i + 1
    return {
        "students": ordered, "ranks": ranks, "totals": totals, "hw": hw, "tp": tp, "pending": pending,
        "homework_count": len(assignments),
        "max_points": len(assignments) * 100 + sum(t.max_points for t in tests),
    }


async def medals(session: AsyncSession, group_id: int) -> dict[int, int]:
    rows = await session.execute(select(RatingAward.student_id, func.count()).where(
        RatingAward.group_id == group_id).group_by(RatingAward.student_id))
    return dict(rows.all())
