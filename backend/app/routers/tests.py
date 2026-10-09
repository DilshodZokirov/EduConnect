"""Testlar: mentor tuzadi, o'quvchi vaqt chegarasi bilan ishlaydi, natija darhol hisoblanadi."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.config import settings

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import MentorUser, ParentUser, StudentUser
from app.models import (
    Group, GroupStudent, LinkStatus, ParentLink, Test, TestAttempt, TestQuestion, TestRetake, User,
)
from app.routers.common import can_access_group
from app.schemas import (
    AnswersIn, AttemptResultOut, AttemptStartOut, AttemptSummary, ChildTestOut, LeaveOut, QuestionOut,
    QuestionStat, ResultQuestion, StudentQuestionOut, StudentTestOut, TestDetailOut, TestIn, TestOut, UserShort,
    WeekBudgetOut,
)
from app.services import notify, testing
from app.services.testing import now

router = APIRouter(tags=["Testlar"])
GRACE = timedelta(seconds=30)  # internet sekinligi uchun kichik zaxira


WEEKLY_POINTS = 100


def points_of(score: int | None, max_points: int) -> float | None:
    return None if score is None else round(score * max_points / 100, 1)


def week_bounds(moment: datetime) -> tuple[datetime, datetime]:
    """Toshkent vaqti bo'yicha shu haftaning dushanba 00:00 — keyingi dushanba 00:00 oralig'i."""
    tz = ZoneInfo(settings.timezone)
    local = moment.astimezone(tz)
    monday = local.date() - timedelta(days=local.weekday())
    start = datetime.combine(monday, time.min, tzinfo=tz)
    return start, start + timedelta(days=7)


async def week_used(session: AsyncSession, group_id: int, moment: datetime, exclude_id: int | None = None):
    start, end = week_bounds(moment)
    stmt = select(Test).where(Test.group_id == group_id, Test.opens_at >= start, Test.opens_at < end)
    if exclude_id:
        stmt = stmt.where(Test.id != exclude_id)
    tests = list(await session.scalars(stmt.order_by(Test.opens_at)))
    return start, end, tests


async def check_week_budget(session: AsyncSession, group_id: int, data: TestIn, exclude_id: int | None = None) -> None:
    _, _, tests = await week_used(session, group_id, data.opens_at, exclude_id)
    used = sum(t.max_points for t in tests)
    if used + data.max_points > WEEKLY_POINTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Bu haftada testlarga {used} ball band. Yana ko'pi bilan {WEEKLY_POINTS - used} ballik test qo'shish mumkin")


async def _test_out(session: AsyncSession, t: Test) -> TestOut:
    out = TestOut.model_validate(t)
    out.question_count = len(t.questions)
    out.total = await session.scalar(select(func.count()).where(GroupStudent.group_id == t.group_id)) or 0
    latest = await _latest_attempts(session, t.id)
    done = [a for a in latest.values() if a.finished_at]
    out.finished = len(done)
    scored = [a.score for a in done if a.score is not None]
    out.average = round(sum(scored) / len(scored)) if scored else None
    return out


async def _latest_attempts(session: AsyncSession, test_id: int) -> dict[int, TestAttempt]:
    """Har bir o'quvchining oxirgi urinishi (hisobga olinadigani)."""
    latest: dict[int, TestAttempt] = {}
    for a in await session.scalars(select(TestAttempt).where(TestAttempt.test_id == test_id).order_by(TestAttempt.attempt_no)):
        latest[a.student_id] = a
    return latest


async def _own_test(session: AsyncSession, user: User, test_id: int) -> Test:
    t = await session.get(Test, test_id)
    if t is None or not await can_access_group(session, user, t.group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test topilmadi")
    return t


def _questions(data: TestIn) -> list[TestQuestion]:
    return [TestQuestion(position=i, kind=q.kind, text=q.text.strip(), points=q.points,
                         options=[o.model_dump() for o in q.options] if q.kind != "short" else [],
                         correct=[c.strip() for c in q.correct if c.strip()])
            for i, q in enumerate(data.questions, 1)]


# =================== Mentor ===================

@router.post("/mentor/groups/{group_id}/tests", response_model=TestOut, status_code=201)
async def create_test(group_id: int, data: TestIn, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    if not await can_access_group(session, user, group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    await check_week_budget(session, group_id, data)
    t = Test(group_id=group_id, lesson_id=data.lesson_id, title=data.title.strip(), description=data.description,
             time_limit_min=data.time_limit_min, opens_at=data.opens_at, closes_at=data.closes_at,
             show_answers=data.show_answers, max_leaves=data.max_leaves, max_points=data.max_points,
             created_by=user.id, questions=_questions(data))
    session.add(t)
    await session.commit()
    await session.refresh(t, ["questions"])
    return await _test_out(session, t)


@router.put("/mentor/tests/{test_id}", response_model=TestOut)
async def update_test(test_id: int, data: TestIn, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Hali hech kim boshlamagan bo'lsa — to'liq tahrirlash; boshlangan bo'lsa — faqat vaqt va sozlamalar."""
    t = await _own_test(session, user, test_id)
    await check_week_budget(session, t.group_id, data, exclude_id=t.id)
    started = await session.scalar(select(func.count()).where(TestAttempt.test_id == t.id))
    t.title, t.description, t.lesson_id = data.title.strip(), data.description, data.lesson_id
    t.max_points = data.max_points
    t.opens_at, t.closes_at, t.show_answers, t.max_leaves = data.opens_at, data.closes_at, data.show_answers, data.max_leaves
    if not started:
        t.time_limit_min = data.time_limit_min
        t.questions = _questions(data)
    await session.commit()
    await session.refresh(t, ["questions"])
    return await _test_out(session, t)


@router.get("/mentor/groups/{group_id}/tests/week-budget", response_model=WeekBudgetOut)
async def week_budget(group_id: int, at: datetime | None = None, exclude: int | None = None, user: User = MentorUser,
                      session: AsyncSession = Depends(get_session)):
    """Tanlangan sana haftasida testlarga qancha ball band va qancha qolgan."""
    if not await can_access_group(session, user, group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    start, end, tests = await week_used(session, group_id, at or now(), exclude)
    used = sum(t.max_points for t in tests)
    return WeekBudgetOut(week_start=start.date(), week_end=(end - timedelta(days=1)).date(), used=used,
                         left=max(0, WEEKLY_POINTS - used),
                         tests=[{"id": t.id, "title": t.title, "max_points": t.max_points} for t in tests])


@router.get("/mentor/groups/{group_id}/tests", response_model=list[TestOut])
async def group_tests(group_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    if not await can_access_group(session, user, group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    tests = await session.scalars(select(Test).where(Test.group_id == group_id).order_by(Test.opens_at.desc()))
    return [await _test_out(session, t) for t in tests]


@router.get("/mentor/tests/{test_id}", response_model=TestDetailOut)
async def test_detail(test_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    t = await _own_test(session, user, test_id)
    latest = await _latest_attempts(session, t.id)
    students = list(await session.scalars(
        select(User).join(GroupStudent, GroupStudent.student_id == User.id)
        .where(GroupStudent.group_id == t.group_id).order_by(User.last_name, User.first_name)))
    retakes = set(await session.scalars(select(TestRetake.student_id).where(
        TestRetake.test_id == t.id, TestRetake.used.is_(False))))
    by_id = {s.id: s for s in students}
    attempts = []
    for sid, a in latest.items():
        st = by_id.get(sid) or await session.get(User, sid)
        attempts.append(AttemptSummary(
            id=a.id, student=UserShort.model_validate(st), attempt_no=a.attempt_no, started_at=a.started_at,
            finished_at=a.finished_at, finish_reason=a.finish_reason, leaves=a.leaves, score=a.score,
            points=points_of(a.score, t.max_points),
            ai_pending=a.ai_pending, retake_granted=sid in retakes))
    attempts.sort(key=lambda x: (x.score is None, -(x.score or 0)))
    stats = []
    finished = [a for a in latest.values() if a.finished_at]
    for q in t.questions:
        marks = [a.results.get(str(q.id), {}).get("correct") for a in finished]
        marks = [m for m in marks if m is not None]
        stats.append(QuestionStat(question_id=q.id, position=q.position, text=q.text[:120],
                                  correct_rate=round(100 * sum(marks) / len(marks)) if marks else None))
    return TestDetailOut(
        test=await _test_out(session, t), questions=[QuestionOut.model_validate(q) for q in t.questions],
        attempts=attempts, missing=[UserShort.model_validate(s) for s in students if s.id not in latest], stats=stats,
    )


@router.post("/mentor/tests/{test_id}/retake/{student_id}", status_code=204)
async def grant_retake(test_id: int, student_id: int, bg: BackgroundTasks, user: User = MentorUser,
                       session: AsyncSession = Depends(get_session)):
    """Qayta topshirishga ruxsat (bitta urinish). Oxirgi urinish natijasi hisobga olinadi."""
    t = await _own_test(session, user, test_id)
    if not await session.scalar(select(GroupStudent.student_id).where(
            GroupStudent.group_id == t.group_id, GroupStudent.student_id == student_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "O'quvchi bu guruhda emas")
    if not await session.scalar(select(TestRetake.id).where(
            TestRetake.test_id == t.id, TestRetake.student_id == student_id, TestRetake.used.is_(False))):
        session.add(TestRetake(test_id=t.id, student_id=student_id, granted_by=user.id))
        await session.commit()
        bg.add_task(notify.test_retake_granted, t.id, student_id)


@router.delete("/mentor/tests/{test_id}", status_code=204)
async def delete_test(test_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    t = await _own_test(session, user, test_id)
    await session.delete(t)
    await session.commit()


# =================== O'quvchi ===================

async def _student_test(session: AsyncSession, user: User, test_id: int) -> Test:
    t = await session.get(Test, test_id)
    if t is None or not await session.scalar(select(GroupStudent.student_id).where(
            GroupStudent.group_id == t.group_id, GroupStudent.student_id == user.id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Test topilmadi")
    return t


async def _close_if_expired(session: AsyncSession, t: Test, a: TestAttempt) -> None:
    if a.finished_at is None and now() > a.deadline_at + GRACE:
        testing.finish(t, a, "timeout")
        await session.commit()


@router.get("/student/tests", response_model=list[StudentTestOut])
async def student_tests(user: User = StudentUser, session: AsyncSession = Depends(get_session)):
    rows = await session.execute(
        select(Test, Group.name).join(Group, Group.id == Test.group_id)
        .join(GroupStudent, GroupStudent.group_id == Test.group_id)
        .where(GroupStudent.student_id == user.id).order_by(Test.opens_at.desc()))
    result, t_now = [], now()
    for t, gname in rows:
        attempts = list(await session.scalars(select(TestAttempt).where(
            TestAttempt.test_id == t.id, TestAttempt.student_id == user.id).order_by(TestAttempt.attempt_no)))
        last = attempts[-1] if attempts else None
        if last:
            await _close_if_expired(session, t, last)
        retake = await session.scalar(select(TestRetake.id).where(
            TestRetake.test_id == t.id, TestRetake.student_id == user.id, TestRetake.used.is_(False)))
        in_window = t.opens_at <= t_now <= t.closes_at
        if last and last.finished_at is None:
            st = "in_progress"
        elif last:
            st = "done"
        elif t_now < t.opens_at:
            st = "upcoming"
        elif t_now > t.closes_at:
            st = "missed"
        else:
            st = "open"
        can_start = st == "in_progress" or (in_window and (not last or bool(retake)))
        result.append(StudentTestOut(
            id=t.id, title=t.title, group_name=gname, time_limit_min=t.time_limit_min, question_count=len(t.questions),
            opens_at=t.opens_at, closes_at=t.closes_at, status=st, score=last.score if last and last.finished_at else None,
            max_points=t.max_points, points=points_of(last.score, t.max_points) if last and last.finished_at else None,
            attempt_id=last.id if last else None, can_start=can_start))
    return result


def _start_out(t: Test, a: TestAttempt) -> AttemptStartOut:
    by_id = {q.id: q for q in t.questions}
    questions = []
    for qid in a.order["questions"]:
        q = by_id.get(qid)
        if q is None:
            continue
        opts = {o["id"]: o for o in q.options}
        questions.append(StudentQuestionOut(
            id=q.id, kind=q.kind, text=q.text, points=q.points,
            options=[opts[oid] for oid in a.order["options"].get(str(q.id), []) if oid in opts]))
    return AttemptStartOut(attempt_id=a.id, test_title=t.title, deadline_at=a.deadline_at, server_now=now(),
                           max_leaves=t.max_leaves, leaves=a.leaves, questions=questions, answers=a.answers or {})


@router.post("/student/tests/{test_id}/start", response_model=AttemptStartOut)
async def start_test(test_id: int, user: User = StudentUser, session: AsyncSession = Depends(get_session)):
    """Testni boshlash yoki to'xtagan joydan davom ettirish."""
    t = await _student_test(session, user, test_id)
    attempts = list(await session.scalars(select(TestAttempt).where(
        TestAttempt.test_id == t.id, TestAttempt.student_id == user.id).order_by(TestAttempt.attempt_no)))
    last = attempts[-1] if attempts else None
    if last and last.finished_at is None:
        await _close_if_expired(session, t, last)
        if last.finished_at is None:
            return _start_out(t, last)
    t_now = now()
    if not (t.opens_at <= t_now <= t.closes_at):
        raise HTTPException(status.HTTP_409_CONFLICT, "Test hozir ochiq emas")
    retake = None
    if last:
        retake = await session.scalar(select(TestRetake).where(
            TestRetake.test_id == t.id, TestRetake.student_id == user.id, TestRetake.used.is_(False)))
        if retake is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Siz bu testni topshirgansiz. Qayta topshirish uchun mentor ruxsati kerak")
        retake.used = True
    deadline = min(t_now + timedelta(minutes=t.time_limit_min), t.closes_at)
    a = TestAttempt(test_id=t.id, student_id=user.id, attempt_no=(last.attempt_no + 1) if last else 1,
                    started_at=t_now, deadline_at=deadline, order=testing.build_order(t), answers={}, results={})
    session.add(a)
    await session.commit()
    return _start_out(t, a)


async def _my_attempt(session: AsyncSession, user: User, attempt_id: int) -> tuple[Test, TestAttempt]:
    a = await session.get(TestAttempt, attempt_id)
    if a is None or a.student_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Urinish topilmadi")
    return await session.get(Test, a.test_id), a


def _clean(t: Test, answers: dict) -> dict:
    valid = {str(q.id): q for q in t.questions}
    out = {}
    for k, v in answers.items():
        q = valid.get(k)
        if q is None:
            continue
        if q.kind == "short":
            out[k] = (v if isinstance(v, str) else "")[:2000]
        else:
            ids = {o["id"] for o in q.options}
            out[k] = [x for x in (v if isinstance(v, list) else [v]) if x in ids][: (1 if q.kind == "single" else None)]
    return out


@router.put("/student/attempts/{attempt_id}/answers", status_code=204)
async def save_answers(attempt_id: int, data: AnswersIn, user: User = StudentUser,
                       session: AsyncSession = Depends(get_session)):
    """Javoblarni oraliq saqlash (internet uzilsa ham yo'qolmasin)."""
    t, a = await _my_attempt(session, user, attempt_id)
    await _close_if_expired(session, t, a)
    if a.finished_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Test yakunlangan")
    a.answers = {**(a.answers or {}), **_clean(t, data.answers)}
    await session.commit()


@router.post("/student/attempts/{attempt_id}/leave", response_model=LeaveOut)
async def left_page(attempt_id: int, data: AnswersIn, user: User = StudentUser,
                    session: AsyncSession = Depends(get_session)):
    """O'quvchi sahifadan chiqdi. Chegara yetsa — test shu paytgacha berilgan javoblar bilan yakunlanadi."""
    t, a = await _my_attempt(session, user, attempt_id)
    if a.finished_at:
        return LeaveOut(leaves=a.leaves, max_leaves=t.max_leaves, finished=True)
    a.answers = {**(a.answers or {}), **_clean(t, data.answers)}
    a.leaves += 1
    if a.leaves >= t.max_leaves:
        testing.finish(t, a, "left_page")
    await session.commit()
    return LeaveOut(leaves=a.leaves, max_leaves=t.max_leaves, finished=a.finished_at is not None)


@router.post("/student/attempts/{attempt_id}/finish", response_model=AttemptResultOut)
async def finish_attempt(attempt_id: int, data: AnswersIn, user: User = StudentUser,
                         session: AsyncSession = Depends(get_session)):
    t, a = await _my_attempt(session, user, attempt_id)
    if a.finished_at is None:
        if now() <= a.deadline_at + GRACE:
            a.answers = {**(a.answers or {}), **_clean(t, data.answers)}
            testing.finish(t, a, "submitted")
        else:
            testing.finish(t, a, "timeout")  # vaqt o'tgan — faqat oldin saqlangan javoblar
        await session.commit()
    return _result(t, a)


def _result(t: Test, a: TestAttempt) -> AttemptResultOut:
    visible = t.show_answers or now() > t.closes_at
    questions = []
    for q in t.questions:
        r = a.results.get(str(q.id), {})
        questions.append(ResultQuestion(
            id=q.id, kind=q.kind, text=q.text, points=q.points, options=q.options,
            your_answer=a.answers.get(str(q.id)), earned=r.get("earned", 0), is_correct=r.get("correct"),
            correct=q.correct if visible else None))
    return AttemptResultOut(attempt_id=a.id, test_id=t.id, test_title=t.title, score=a.score, ai_pending=a.ai_pending,
                            max_points=t.max_points, points=points_of(a.score, t.max_points),
                            finish_reason=a.finish_reason, leaves=a.leaves, answers_visible=visible, questions=questions)


@router.get("/student/attempts/{attempt_id}/result", response_model=AttemptResultOut)
async def attempt_result(attempt_id: int, user: User = StudentUser, session: AsyncSession = Depends(get_session)):
    t, a = await _my_attempt(session, user, attempt_id)
    await _close_if_expired(session, t, a)
    if a.finished_at is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Test hali yakunlanmagan")
    return _result(t, a)


# =================== Ota-ona ===================

@router.get("/parent/children/{child_id}/tests", response_model=list[ChildTestOut])
async def child_tests(child_id: int, user: User = ParentUser, session: AsyncSession = Depends(get_session)):
    if await session.scalar(select(ParentLink.id).where(
            ParentLink.parent_id == user.id, ParentLink.student_id == child_id,
            ParentLink.status == LinkStatus.confirmed)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Farzand topilmadi")
    rows = await session.execute(
        select(Test, Group.name).join(Group, Group.id == Test.group_id)
        .join(GroupStudent, GroupStudent.group_id == Test.group_id)
        .where(GroupStudent.student_id == child_id, Test.opens_at <= now()).order_by(Test.opens_at.desc()).limit(50))
    result = []
    for t, gname in rows:
        last = await session.scalar(select(TestAttempt).where(
            TestAttempt.test_id == t.id, TestAttempt.student_id == child_id).order_by(TestAttempt.attempt_no.desc()).limit(1))
        if last and last.finished_at:
            st = "done"
        elif now() > t.closes_at:
            st = "missed"
        else:
            st = "waiting"
        result.append(ChildTestOut(id=t.id, title=t.title, group_name=gname, closes_at=t.closes_at, status=st,
                                   score=last.score if st == "done" else None, leaves=last.leaves if last else 0,
                                   max_points=t.max_points,
                                   points=points_of(last.score, t.max_points) if st == "done" else None))
    return result
