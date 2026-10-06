"""Uy vazifasi: mentor beradi, o'quvchi topshiradi, AI dastlabki tekshiradi, mentor yakuniy baho qo'yadi."""
import io
import json
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.deps import MentorUser, ParentUser, StudentUser, assert_not_locked, get_current_user
from app.models import (
    Assignment, Group, GroupStudent, Lesson, LinkStatus, ParentLink, Role, Submission, SubmissionFile,
    SubmissionStatus, User, UserStatus,
)
from app.routers.common import can_access_group
from app.schemas import (
    AssignmentDetailOut, AssignmentIn, AssignmentOut, AssignmentUpdateIn, ChildHomeworkOut, GradeIn,
    MaterialUrlOut, MySubmissionOut, StudentAssignmentOut, SubmissionFileOut, SubmissionOut, UserShort,
)
from app.services import ai_grader, notify, storage

router = APIRouter(tags=["Uy vazifasi"])
MB = 1024 * 1024
NEEDS_MENTOR = (SubmissionStatus.review, SubmissionStatus.failed, SubmissionStatus.manual)


def now() -> datetime:
    return datetime.now(timezone.utc)


def _criteria(sub: Submission) -> list[dict]:
    try:
        return json.loads(sub.ai_details) if sub.ai_details else []
    except json.JSONDecodeError:
        return []


def submission_out(sub: Submission, student: User) -> SubmissionOut:
    return SubmissionOut(
        id=sub.id, student=UserShort.model_validate(student), text=sub.text, is_code=sub.is_code,
        submitted_at=sub.submitted_at, late=sub.late, attempt=sub.attempt, ai_status=sub.ai_status,
        ai_score=sub.ai_score, ai_feedback=sub.ai_feedback, ai_criteria=_criteria(sub),
        final_score=sub.final_score, mentor_comment=sub.mentor_comment, graded_at=sub.graded_at,
        files=[SubmissionFileOut.model_validate(f) for f in sub.files],
    )


def my_submission_out(sub: Submission) -> MySubmissionOut:
    # Baho mentor tasdiqlagunga qadar ko'rsatilmaydi — faqat izohlar
    comments = [{"name": c.get("name"), "comment": c.get("comment")} for c in _criteria(sub)]
    if sub.final_score is not None:
        comments = _criteria(sub)
    return MySubmissionOut(
        text=sub.text, is_code=sub.is_code, submitted_at=sub.submitted_at, late=sub.late, attempt=sub.attempt,
        ai_status=sub.ai_status, ai_feedback=sub.ai_feedback, ai_comments=comments,
        final_score=sub.final_score, mentor_comment=sub.mentor_comment,
        files=[SubmissionFileOut.model_validate(f) for f in sub.files],
    )


async def _assignment_stats(session: AsyncSession, a: Assignment) -> AssignmentOut:
    out = AssignmentOut.model_validate(a)
    students = set(await session.scalars(select(GroupStudent.student_id).where(GroupStudent.group_id == a.group_id)))
    subs = list(await session.scalars(select(Submission).where(Submission.assignment_id == a.id)))
    out.total = len(students)
    out.submitted = len(subs)
    out.graded = sum(1 for s in subs if s.final_score is not None)
    out.to_review = sum(1 for s in subs if s.final_score is None and s.ai_status in NEEDS_MENTOR)
    out.to_approve = sum(1 for s in subs if s.final_score is None and s.ai_status == SubmissionStatus.done)
    return out


async def _own_assignment(session: AsyncSession, user: User, assignment_id: int) -> Assignment:
    a = await session.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vazifa topilmadi")
    if user.role == Role.mentor:
        mentor_id = await session.scalar(select(Group.mentor_id).where(Group.id == a.group_id))
        if mentor_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Vazifa topilmadi")
    return a


async def _own_lesson_group(session: AsyncSession, user: User, lesson_id: int) -> Lesson:
    lesson = await session.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dars topilmadi")
    if user.role == Role.mentor:
        mentor_id = await session.scalar(select(Group.mentor_id).where(Group.id == lesson.group_id))
        if mentor_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Dars topilmadi")
    return lesson


# =================== Mentor ===================

@router.post("/mentor/lessons/{lesson_id}/assignments", response_model=AssignmentOut, status_code=201)
async def create_assignment(lesson_id: int, data: AssignmentIn, bg: BackgroundTasks, user: User = MentorUser,
                            session: AsyncSession = Depends(get_session)):
    lesson = await _own_lesson_group(session, user, lesson_id)
    if data.due_at <= now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Muddat kelajakda bo'lishi kerak")
    a = Assignment(lesson_id=lesson.id, group_id=lesson.group_id, title=data.title.strip(),
                   description=data.description.strip(), criteria=data.criteria.strip(), due_at=data.due_at,
                   created_by=user.id)
    session.add(a)
    await session.commit()
    await session.refresh(a)
    bg.add_task(notify.homework_assigned, a.id)
    return await _assignment_stats(session, a)


@router.post("/mentor/assignments/{assignment_id}/file", response_model=AssignmentOut)
async def upload_assignment_file(assignment_id: int, file: UploadFile = File(...), user: User = MentorUser,
                                 session: AsyncSession = Depends(get_session)):
    """Topshiriq sharti yozilgan fayl (PDF, Word, rasm…)."""
    a = await _own_assignment(session, user, assignment_id)
    filename = file.filename or "fayl"
    if Path(filename).suffix.lower() not in storage.DOCUMENT_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bu fayl turi qabul qilinmaydi")
    content = await file.read(settings.max_file_mb * MB + 1)
    if len(content) > settings.max_file_mb * MB:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Fayl {settings.max_file_mb} MB dan katta")
    if a.file_key:
        await storage.delete(a.file_key)
    a.file_key = f"homework/{a.id}/task/{uuid.uuid4().hex}/{storage.safe_filename(filename)}"
    a.file_name = filename[:200]
    await storage.put_bytes(a.file_key, content, file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream")
    await session.commit()
    return await _assignment_stats(session, a)


@router.get("/mentor/groups/{group_id}/assignments", response_model=list[AssignmentOut])
async def group_assignments(group_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    if user.role == Role.mentor:
        if await session.scalar(select(Group.mentor_id).where(Group.id == group_id)) != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    items = await session.scalars(select(Assignment).where(Assignment.group_id == group_id).order_by(Assignment.due_at.desc()))
    return [await _assignment_stats(session, a) for a in items]


@router.get("/mentor/assignments/{assignment_id}", response_model=AssignmentDetailOut)
async def assignment_detail(assignment_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    a = await _own_assignment(session, user, assignment_id)
    rows = list(await session.execute(
        select(Submission, User).join(User, User.id == Submission.student_id)
        .where(Submission.assignment_id == a.id).order_by(Submission.submitted_at)
    ))
    submitted_ids = {u.id for _, u in rows}
    students = await session.scalars(
        select(User).join(GroupStudent, GroupStudent.student_id == User.id)
        .where(GroupStudent.group_id == a.group_id).order_by(User.last_name, User.first_name)
    )
    return AssignmentDetailOut(
        assignment=await _assignment_stats(session, a),
        submissions=[submission_out(s, u) for s, u in rows],
        missing=[UserShort.model_validate(u) for u in students if u.id not in submitted_ids],
    )


@router.patch("/mentor/assignments/{assignment_id}", response_model=AssignmentOut)
async def update_assignment(assignment_id: int, data: AssignmentUpdateIn, user: User = MentorUser,
                            session: AsyncSession = Depends(get_session)):
    a = await _own_assignment(session, user, assignment_id)
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    if "due_at" in changes and changes["due_at"] != a.due_at:
        a.reminder_sent = a.overdue_notified = False  # yangi muddat bo'yicha eslatmalar qaytadan
    for field, value in changes.items():
        setattr(a, field, value.strip() if isinstance(value, str) else value)
    await session.commit()
    return await _assignment_stats(session, a)


@router.delete("/mentor/assignments/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    a = await _own_assignment(session, user, assignment_id)
    subs = await session.scalars(select(Submission).where(Submission.assignment_id == a.id))
    for s in subs:
        for f in s.files:
            await storage.delete(f.storage_key)
    if a.file_key:
        await storage.delete(a.file_key)
    await session.delete(a)
    await session.commit()


async def _own_submission(session: AsyncSession, user: User, submission_id: int) -> tuple[Submission, User]:
    sub = await session.get(Submission, submission_id)
    if sub is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Javob topilmadi")
    await _own_assignment(session, user, sub.assignment_id)
    return sub, await session.get(User, sub.student_id)


@router.post("/mentor/submissions/{submission_id}/grade", response_model=SubmissionOut)
async def grade_submission(submission_id: int, data: GradeIn, bg: BackgroundTasks, user: User = MentorUser,
                           session: AsyncSession = Depends(get_session)):
    """Yakuniy baho — faqat mentor qo'yadi (AI bahosini tasdiqlash yoki o'zgartirish)."""
    sub, student = await _own_submission(session, user, submission_id)
    sub.final_score = data.score
    sub.mentor_comment = (data.comment or "").strip() or None
    sub.graded_by, sub.graded_at = user.id, now()
    await session.commit()
    bg.add_task(notify.homework_graded, sub.id)
    return submission_out(sub, student)


@router.post("/mentor/assignments/{assignment_id}/approve-ai", response_model=AssignmentDetailOut)
async def approve_ai_scores(assignment_id: int, bg: BackgroundTasks, user: User = MentorUser,
                            session: AsyncSession = Depends(get_session)):
    """AI ishonch bilan bergan barcha baholarni bir tugma bilan tasdiqlash."""
    a = await _own_assignment(session, user, assignment_id)
    subs = list(await session.scalars(select(Submission).where(
        Submission.assignment_id == a.id, Submission.final_score.is_(None),
        Submission.ai_status == SubmissionStatus.done, Submission.ai_score.is_not(None),
    )))
    for s in subs:
        s.final_score, s.graded_by, s.graded_at = s.ai_score, user.id, now()
    await session.commit()
    for s in subs:
        bg.add_task(notify.homework_graded, s.id)
    return await assignment_detail(assignment_id, user, session)


@router.post("/mentor/submissions/{submission_id}/recheck", response_model=SubmissionOut)
async def recheck_submission(submission_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    sub, student = await _own_submission(session, user, submission_id)
    if not ai_grader.enabled():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "AI ulanmagan (ANTHROPIC_API_KEY yo'q)")
    sub.ai_status, sub.ai_error = SubmissionStatus.pending, None
    await session.commit()
    return submission_out(sub, student)


# =================== O'quvchi ===================

def _student_status(a: Assignment, sub: Submission | None) -> str:
    if sub is None:
        return "overdue" if a.due_at < now() else "new"
    return "graded" if sub.final_score is not None else "submitted"


async def _student_assignments(session: AsyncSession, student_id: int):
    rows = await session.execute(
        select(Assignment, Group.name, Lesson.title)
        .join(Group, Group.id == Assignment.group_id).join(Lesson, Lesson.id == Assignment.lesson_id)
        .join(GroupStudent, GroupStudent.group_id == Assignment.group_id)
        .where(GroupStudent.student_id == student_id).order_by(Assignment.due_at.desc())
    )
    rows = list(rows)
    subs = {s.assignment_id: s for s in await session.scalars(select(Submission).where(
        Submission.student_id == student_id, Submission.assignment_id.in_([a.id for a, _, _ in rows] or [0]),
    ))}
    return rows, subs


@router.get("/student/assignments", response_model=list[StudentAssignmentOut])
async def student_assignments(user: User = StudentUser, session: AsyncSession = Depends(get_session)):
    rows, subs = await _student_assignments(session, user.id)
    return [StudentAssignmentOut(
        id=a.id, title=a.title, description=a.description, criteria=a.criteria, due_at=a.due_at,
        file_name=a.file_name, group_name=g, lesson_title=lt, status=_student_status(a, subs.get(a.id)),
        submission=my_submission_out(subs[a.id]) if a.id in subs else None,
    ) for a, g, lt in rows]


def _prepare_image(data: bytes) -> bytes:
    """Rasmni JPEG ga o'giradi va 2000 px gacha kichraytiradi (joy tejaladi)."""
    try:
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Rasm o'qilmadi. JPG yoki PNG yuboring") from exc
    img.thumbnail((2000, 2000))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return out.getvalue()


@router.post("/student/assignments/{assignment_id}/submit", response_model=StudentAssignmentOut)
async def submit(assignment_id: int, text: str | None = Form(default=None), is_code: bool = Form(default=False),
                 files: list[UploadFile] | None = File(default=None), user: User = StudentUser,
                 session: AsyncSession = Depends(get_session)):
    """Javob topshirish (matn, kod yoki rasmlar). Baholangunga qadar qayta topshirish mumkin."""
    a = await session.get(Assignment, assignment_id)
    member = a and await session.scalar(select(GroupStudent.student_id).where(
        GroupStudent.group_id == a.group_id, GroupStudent.student_id == user.id))
    if not a or not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vazifa topilmadi")
    files = [f for f in (files or []) if f.filename]
    text = (text or "").strip()
    if not text and not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Javob matnini yozing yoki rasm qo'shing")
    if len(files) > settings.homework_max_images:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ko'pi bilan {settings.homework_max_images} ta rasm")

    sub = await session.scalar(select(Submission).where(
        Submission.assignment_id == a.id, Submission.student_id == user.id))
    if sub and sub.final_score is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Vazifa allaqachon baholangan")

    images = []
    for f in files:
        data = await f.read(settings.homework_max_image_mb * MB + 1)
        if len(data) > settings.homework_max_image_mb * MB:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Rasm {settings.homework_max_image_mb} MB dan katta")
        images.append(_prepare_image(data))

    if sub is None:
        sub = Submission(assignment_id=a.id, student_id=user.id, attempt=0, files=[])
        session.add(sub)
    else:
        for old in sub.files:
            await storage.delete(old.storage_key)
        sub.files = []
    new_files = []
    for data in images:
        key = f"homework/{a.id}/submissions/{user.id}/{uuid.uuid4().hex}.jpg"
        await storage.put_bytes(key, data, "image/jpeg")
        new_files.append(SubmissionFile(storage_key=key, content_type="image/jpeg", size_bytes=len(data)))
    sub.files = new_files
    sub.text, sub.is_code = text or None, is_code
    sub.submitted_at, sub.late, sub.attempt = now(), now() > a.due_at, sub.attempt + 1
    sub.ai_status = SubmissionStatus.pending if ai_grader.enabled() else SubmissionStatus.manual
    sub.ai_score = sub.ai_feedback = sub.ai_details = sub.ai_error = None
    await session.commit()

    group_name = await session.scalar(select(Group.name).where(Group.id == a.group_id))
    lesson_title = await session.scalar(select(Lesson.title).where(Lesson.id == a.lesson_id))
    return StudentAssignmentOut(
        id=a.id, title=a.title, description=a.description, criteria=a.criteria, due_at=a.due_at,
        file_name=a.file_name, group_name=group_name, lesson_title=lesson_title, status="submitted",
        submission=my_submission_out(sub),
    )


# =================== Ota-ona ===================

@router.get("/parent/children/{child_id}/homework", response_model=list[ChildHomeworkOut])
async def child_homework(child_id: int, user: User = ParentUser, session: AsyncSession = Depends(get_session)):
    linked = await session.scalar(select(ParentLink.id).where(
        ParentLink.parent_id == user.id, ParentLink.student_id == child_id, ParentLink.status == LinkStatus.confirmed))
    if linked is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Farzand topilmadi")
    rows, subs = await _student_assignments(session, child_id)
    result = []
    for a, g, _ in rows[:50]:
        sub = subs.get(a.id)
        st = ("graded" if sub.final_score is not None else "submitted") if sub else ("missing" if a.due_at < now() else "waiting")
        result.append(ChildHomeworkOut(
            id=a.id, title=a.title, group_name=g, due_at=a.due_at, status=st, late=bool(sub and sub.late),
            final_score=sub.final_score if sub else None, mentor_comment=sub.mentor_comment if sub else None,
        ))
    return result


# =================== Fayllar ===================

async def _can_see_student(session: AsyncSession, user: User, student_id: int, group_id: int) -> bool:
    if user.role in (Role.admin, Role.superadmin):
        return True
    if user.role == Role.mentor:
        return await session.scalar(select(Group.mentor_id).where(Group.id == group_id)) == user.id
    if user.role == Role.student:
        return user.id == student_id
    if user.role == Role.parent:
        return await session.scalar(select(ParentLink.id).where(
            ParentLink.parent_id == user.id, ParentLink.student_id == student_id,
            ParentLink.status == LinkStatus.confirmed)) is not None
    return False


@router.get("/homework/files/{file_id}/url", response_model=MaterialUrlOut)
async def submission_file_url(file_id: int, user: User = Depends(get_current_user),
                              session: AsyncSession = Depends(get_session)):
    f = await session.get(SubmissionFile, file_id)
    sub = await session.get(Submission, f.submission_id) if f else None
    a = await session.get(Assignment, sub.assignment_id) if sub else None
    if not a or user.status != UserStatus.active or not await _can_see_student(session, user, sub.student_id, a.group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fayl topilmadi")
    await assert_not_locked(session, user)
    return MaterialUrlOut(url=storage.presign_get(f.storage_key, f"javob-{f.id}.jpg", expires=600), expires_in=600)


@router.get("/homework/assignments/{assignment_id}/file/url", response_model=MaterialUrlOut)
async def assignment_file_url(assignment_id: int, download: bool = False, user: User = Depends(get_current_user),
                              session: AsyncSession = Depends(get_session)):
    a = await session.get(Assignment, assignment_id)
    if (not a or not a.file_key or user.status != UserStatus.active
            or not await can_access_group(session, user, a.group_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fayl topilmadi")
    await assert_not_locked(session, user)
    return MaterialUrlOut(url=storage.presign_get(a.file_key, a.file_name, download=download, expires=600),
                          expires_in=600, filename=a.file_name)
