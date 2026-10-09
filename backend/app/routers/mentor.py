import math
from datetime import datetime, timedelta, timezone
import mimetypes
import uuid
from pathlib import Path

from botocore.exceptions import ClientError
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import MentorUser
from app.models import (
    Attendance, AttendanceStatus, Group, GroupStudent, Lesson, LessonMaterial, LinkStatus, MaterialKind, MaterialSource,
    MaterialStatus, ParentLink, Role, User, UserStatus, VideoView,
)
from app.schemas import (
    AttendanceIn, AttendanceOut, GroupOut, LessonCreateIn, LessonOut, LessonUpdateIn, LinkIn, LinkParentIn,
    MaterialOut, SelfGuardianIn, VideoCompleteIn, VideoStartIn, VideoStartOut, VideoViewOut, ParentLinkOut, ParentSearchOut, StudentInGroupOut, UserShort,
)
from app.security import mask_phone
from app.services import notify
from app.config import settings
from app.models import STAFF_ROLES
from app.scope import branch_ids, in_scope
from app.services import storage

MB = 1024 * 1024
VIDEO_PART_SIZE = 16 * MB  # S3 da bo'lak kamida 5 MB bo'lishi kerak

router = APIRouter(prefix="/mentor", tags=["Mentor"])


def _is_admin(user: User) -> bool:
    return user.role in STAFF_ROLES


async def _own_group(session: AsyncSession, user: User, group_id: int) -> Group:
    group = await session.get(Group, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    if _is_admin(user):
        if not in_scope(await branch_ids(session, user), group.branch_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    elif group.mentor_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    return group


async def _own_lesson(session: AsyncSession, user: User, lesson_id: int) -> Lesson:
    lesson = await session.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dars topilmadi")
    await _own_group(session, user, lesson.group_id)
    return lesson


async def _check_teaches(session: AsyncSession, user: User, student_id: int) -> User:
    student = await session.get(User, student_id)
    if student is None or student.role != Role.student:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "O'quvchi topilmadi")
    if not _is_admin(user):
        teaches = await session.scalar(
            select(GroupStudent.student_id)
            .join(Group, Group.id == GroupStudent.group_id)
            .where(GroupStudent.student_id == student_id, Group.mentor_id == user.id)
            .limit(1)
        )
        if teaches is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu o'quvchi sizning guruhingizda emas")
    return student


# ---------- Guruhlar ----------

@router.get("/groups", response_model=list[GroupOut])
async def my_groups(user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    groups = await session.scalars(
        select(Group).where(Group.mentor_id == user.id, Group.is_active.is_(True)).order_by(Group.name)
    )
    result = []
    for g in groups:
        out = GroupOut.model_validate(g)
        out.student_count = await session.scalar(select(func.count()).where(GroupStudent.group_id == g.id)) or 0
        result.append(out)
    return result


@router.get("/groups/{group_id}/students", response_model=list[StudentInGroupOut])
async def group_students(group_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    await _own_group(session, user, group_id)
    parents = (
        select(func.count())
        .where(ParentLink.student_id == User.id, ParentLink.status == LinkStatus.confirmed)
        .correlate(User)
        .scalar_subquery()
    )
    rows = await session.execute(
        select(User.id, User.first_name, User.last_name, parents.label("confirmed_parents"), User.self_guardian)
        .join(GroupStudent, GroupStudent.student_id == User.id)
        .where(GroupStudent.group_id == group_id)
        .order_by(User.last_name, User.first_name)
    )
    students = [StudentInGroupOut(**r._mapping) for r in rows]

    # Davomat foizi: shu guruh darslarida keldi yoki kechikdi / jami belgilangan
    attended = func.sum(case((Attendance.status != AttendanceStatus.absent, 1), else_=0))
    stats = await session.execute(
        select(Attendance.student_id, attended, func.count())
        .join(Lesson, Lesson.id == Attendance.lesson_id)
        .where(Lesson.group_id == group_id)
        .group_by(Attendance.student_id)
    )
    percent = {sid: round(100 * (ok or 0) / total) for sid, ok, total in stats if total}
    for s in students:
        s.attendance_percent = percent.get(s.id)
    return students


# ---------- Darslar va materiallar ----------

@router.get("/groups/{group_id}/lessons", response_model=list[LessonOut])
async def group_lessons(group_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    await _own_group(session, user, group_id)
    return list(await session.scalars(
        select(Lesson).where(Lesson.group_id == group_id).order_by(Lesson.lesson_date.desc())
    ))


@router.post("/groups/{group_id}/lessons", response_model=LessonOut, status_code=201)
async def create_lesson(group_id: int, data: LessonCreateIn, user: User = MentorUser,
                        session: AsyncSession = Depends(get_session)):
    await _own_group(session, user, group_id)
    lesson = Lesson(group_id=group_id, created_by=user.id, **data.model_dump())
    session.add(lesson)
    await session.commit()
    await session.refresh(lesson, ["materials"])
    return lesson


@router.patch("/lessons/{lesson_id}", response_model=LessonOut)
async def update_lesson(lesson_id: int, data: LessonUpdateIn, user: User = MentorUser,
                        session: AsyncSession = Depends(get_session)):
    lesson = await _own_lesson(session, user, lesson_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None or field == "description":
            setattr(lesson, field, value)
    await session.commit()
    await session.refresh(lesson, ["materials"])
    return lesson


async def _remove_objects(material: LessonMaterial) -> None:
    """Material fayllarini ombordan o'chiradi (bazadagi yozuvdan oldin)."""
    if material.upload_id and material.storage_key:
        await storage.abort_multipart(material.storage_key, material.upload_id)
    if material.storage_key:
        await storage.delete(material.storage_key)


async def _own_material(session: AsyncSession, user: User, material_id: int) -> LessonMaterial:
    material = await session.get(LessonMaterial, material_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material topilmadi")
    await _own_lesson(session, user, material.lesson_id)
    return material


@router.delete("/lessons/{lesson_id}", status_code=204)
async def delete_lesson(lesson_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Darsni o'chiradi (materiallar, ularning fayllari va yo'qlama ham o'chadi)."""
    lesson = await _own_lesson(session, user, lesson_id)
    for material in lesson.materials:
        await _remove_objects(material)
    await session.delete(lesson)
    await session.commit()


@router.post("/lessons/{lesson_id}/materials/upload", response_model=MaterialOut, status_code=201)
async def upload_material(lesson_id: int, file: UploadFile = File(...), name: str | None = Form(default=None),
                          user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Hujjat yoki rasmni (prezentatsiya, PDF, Word…) omborga yuklash. Videolar uchun /videos ishlatiladi."""
    await _own_lesson(session, user, lesson_id)
    filename = file.filename or "fayl"
    ext = Path(filename).suffix.lower()
    if ext in storage.VIDEO_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Videoni «Video» bo'limi orqali yuklang")
    if ext not in storage.DOCUMENT_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Bu fayl turi qabul qilinmaydi: {ext or 'kengaytmasiz'}")

    limit = settings.max_file_mb * MB
    content = await file.read(limit + 1)
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fayl bo'sh")
    if len(content) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Fayl {settings.max_file_mb} MB dan katta")

    content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    key = f"materials/{lesson_id}/{uuid.uuid4().hex}/{storage.safe_filename(filename)}"
    await storage.put_bytes(key, content, content_type)

    material = LessonMaterial(
        lesson_id=lesson_id, name=(name or filename)[:200], kind=MaterialKind.file, storage_key=key,
        content_type=content_type, size_bytes=len(content),
    )
    session.add(material)
    await session.commit()
    return material


@router.post("/lessons/{lesson_id}/materials", response_model=MaterialOut, status_code=201)
async def add_link(lesson_id: int, data: LinkIn, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Tashqi havola (YouTube, Google Drive…)."""
    await _own_lesson(session, user, lesson_id)
    material = LessonMaterial(lesson_id=lesson_id, name=data.name, url=data.url, kind=MaterialKind.link)
    session.add(material)
    await session.commit()
    return material


@router.delete("/materials/{material_id}", status_code=204)
async def delete_material(material_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    material = await _own_material(session, user, material_id)
    await _remove_objects(material)
    await session.delete(material)
    await session.commit()


# ---------- Dars videolari ----------
# 1) POST /lessons/{id}/videos      -> bo'laklar uchun vaqtinchalik yuklash havolalari
# 2) brauzer har bir bo'lakni to'g'ridan-to'g'ri omborga PUT qiladi (backend orqali o'tmaydi)
# 3) POST /videos/{id}/complete     -> ishchi (worker) videoni siqadi va o'quvchilarga xabar beradi

@router.post("/lessons/{lesson_id}/videos", response_model=VideoStartOut, status_code=201)
async def start_video_upload(lesson_id: int, data: VideoStartIn, user: User = MentorUser,
                             session: AsyncSession = Depends(get_session)):
    await _own_lesson(session, user, lesson_id)
    ext = Path(data.filename).suffix.lower()
    if ext not in storage.VIDEO_EXTENSIONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Video formati: mp4, mov, webm, mkv yoki avi bo'lishi kerak")
    if data.size > settings.max_video_mb * MB:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Video {settings.max_video_mb} MB dan katta")

    content_type = data.content_type or mimetypes.guess_type(data.filename)[0] or "video/mp4"
    material = LessonMaterial(
        lesson_id=lesson_id, name=(data.name or Path(data.filename).stem)[:200], kind=MaterialKind.video,
        status=MaterialStatus.uploading, content_type=content_type, size_bytes=data.size,
    )
    session.add(material)
    await session.flush()
    material.storage_key = f"videos/{material.id}/original{ext}"
    material.upload_id = await storage.create_multipart(material.storage_key, content_type)
    await session.commit()

    count = math.ceil(data.size / VIDEO_PART_SIZE)
    parts = [{"part_number": n, "url": storage.presign_part(material.storage_key, material.upload_id, n)}
             for n in range(1, count + 1)]
    return VideoStartOut(material=MaterialOut.model_validate(material), part_size=VIDEO_PART_SIZE, parts=parts)


@router.post("/videos/{material_id}/complete", response_model=MaterialOut)
async def complete_video_upload(material_id: int, data: VideoCompleteIn, user: User = MentorUser,
                                session: AsyncSession = Depends(get_session)):
    material = await _own_material(session, user, material_id)
    if material.kind != MaterialKind.video or material.status != MaterialStatus.uploading:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu video allaqachon yuklangan")
    try:
        await storage.complete_multipart(
            material.storage_key, material.upload_id, [(p.part_number, p.etag) for p in data.parts],
        )
    except ClientError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Yuklashni yakunlab bo'lmadi: {exc}")
    material.upload_id = None
    material.status = MaterialStatus.processing  # worker navbatga oladi
    if material.source == MaterialSource.recording:
        material.expires_at = datetime.now(timezone.utc) + timedelta(days=settings.recording_retention_days)
    await session.commit()
    return material


@router.post("/videos/{material_id}/abort", status_code=204)
async def abort_video_upload(material_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    material = await _own_material(session, user, material_id)
    if material.status == MaterialStatus.uploading:
        await _remove_objects(material)
        await session.delete(material)
        await session.commit()


@router.get("/materials/{material_id}/views", response_model=list[VideoViewOut])
async def video_views(material_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Guruhdagi har bir o'quvchi videoni necha foiz ko'rgani."""
    material = await _own_material(session, user, material_id)
    lesson = await session.get(Lesson, material.lesson_id)
    rows = await session.execute(
        select(User, VideoView.percent, VideoView.updated_at)
        .join(GroupStudent, GroupStudent.student_id == User.id)
        .outerjoin(VideoView, (VideoView.student_id == User.id) & (VideoView.material_id == material_id))
        .where(GroupStudent.group_id == lesson.group_id)
        .order_by(VideoView.percent.desc().nulls_last(), User.last_name)
    )
    return [VideoViewOut(student=UserShort.model_validate(u), percent=p or 0, updated_at=t) for u, p, t in rows]


# ---------- Yo'qlama ----------

@router.get("/lessons/{lesson_id}/attendance", response_model=list[AttendanceOut])
async def get_attendance(lesson_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    await _own_lesson(session, user, lesson_id)
    return list(await session.scalars(select(Attendance).where(Attendance.lesson_id == lesson_id)))


@router.put("/lessons/{lesson_id}/attendance", response_model=list[AttendanceOut])
async def save_attendance(lesson_id: int, data: AttendanceIn, bg: BackgroundTasks,
                          user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Yo'qlamani saqlaydi. 'absent' bo'lganlarning ota-onasiga SMS + Telegram ketadi (bir marta)."""
    lesson = await _own_lesson(session, user, lesson_id)

    group_student_ids = set(await session.scalars(
        select(GroupStudent.student_id).where(GroupStudent.group_id == lesson.group_id)
    ))
    if extra := {i.student_id for i in data.items} - group_student_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Guruhda yo'q o'quvchilar: {sorted(extra)}")

    existing = {a.student_id: a for a in await session.scalars(
        select(Attendance).where(Attendance.lesson_id == lesson_id)
    )}
    for item in data.items:
        rec = existing.get(item.student_id)
        if rec is None:
            rec = Attendance(lesson_id=lesson_id, student_id=item.student_id)
            session.add(rec)
            existing[item.student_id] = rec
        rec.status = item.status
        rec.marked_by = user.id
    await session.commit()

    bg.add_task(notify.absent_students, lesson_id)
    return list(existing.values())


# ---------- Ota-onani bog'lash ----------

@router.get("/parents/search", response_model=list[ParentSearchOut])
async def search_parents(q: str = Query(min_length=3, description="Telefon raqam yoki ism"),
                         user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Faqat 'ota-ona' roli berilgan, faol foydalanuvchilar orasida qidiradi."""
    digits = "".join(ch for ch in q if ch.isdigit())
    if len(digits) >= 3:
        cond = User.phone.like(f"%{digits}%")
    else:
        like = f"%{q.strip()}%"
        cond = or_(User.first_name.ilike(like), User.last_name.ilike(like))

    children = (
        select(func.count())
        .where(ParentLink.parent_id == User.id, ParentLink.status == LinkStatus.confirmed)
        .correlate(User)
        .scalar_subquery()
    )
    rows = await session.execute(
        select(User, children.label("children_count"))
        .where(User.role == Role.parent, User.status == UserStatus.active, cond)
        .order_by(User.last_name)
        .limit(10)
    )
    return [
        ParentSearchOut(id=u.id, first_name=u.first_name, last_name=u.last_name,
                        phone_masked=mask_phone(u.phone), children_count=cnt)
        for u, cnt in rows
    ]


async def _link_out(session: AsyncSession, link: ParentLink) -> ParentLinkOut:
    parent = await session.get(User, link.parent_id)
    student = await session.get(User, link.student_id)
    return ParentLinkOut(id=link.id, parent=UserShort.model_validate(parent),
                         student=UserShort.model_validate(student), status=link.status,
                         created_at=link.created_at)


@router.get("/students/{student_id}/parents", response_model=list[ParentLinkOut])
async def student_parents(student_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    await _check_teaches(session, user, student_id)
    links = await session.scalars(select(ParentLink).where(ParentLink.student_id == student_id))
    return [await _link_out(session, link) for link in links]


@router.post("/students/{student_id}/parents", response_model=ParentLinkOut, status_code=201)
async def link_parent(student_id: int, data: LinkParentIn, bg: BackgroundTasks,
                      user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """O'quvchini ota-onaga bog'laydi. Ota-ona Web App da tasdiqlaguncha 'pending' bo'ladi."""
    await _check_teaches(session, user, student_id)
    parent = await session.get(User, data.parent_id)
    if parent is None or parent.role != Role.parent or parent.status != UserStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ota-ona topilmadi yoki faol emas")

    link = await session.scalar(
        select(ParentLink).where(ParentLink.parent_id == parent.id, ParentLink.student_id == student_id)
    )
    if link and link.status != LinkStatus.rejected:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu ota-ona allaqachon bog'langan")
    if link is None:
        link = ParentLink(parent_id=parent.id, student_id=student_id)
        session.add(link)
    link.status, link.created_by, link.decided_at = LinkStatus.pending, user.id, None
    await session.commit()
    await session.refresh(link)

    bg.add_task(notify.parent_link_created, link.id)
    return await _link_out(session, link)


@router.delete("/students/{student_id}/parents/{link_id}", status_code=204)
async def unlink_parent(student_id: int, link_id: int, user: User = MentorUser,
                        session: AsyncSession = Depends(get_session)):
    """O'qituvchi ota-onaning farzand bilan bog'lanishini bekor qiladi (masalan, adashib bog'langan bo'lsa)."""
    await _check_teaches(session, user, student_id)
    link = await session.get(ParentLink, link_id)
    if link is None or link.student_id != student_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bog'lanish topilmadi")
    await session.delete(link)
    await session.commit()


@router.post("/students/{student_id}/self-guardian", status_code=204)
async def set_self_guardian(student_id: int, data: SelfGuardianIn, user: User = MentorUser,
                            session: AsyncSession = Depends(get_session)):
    """O'quvchi o'zi o'ziga vasiy (masalan, voyaga yetgan): to'lov xabarlari ota-onaga emas, o'ziga boradi."""
    student = await _check_teaches(session, user, student_id)
    student.self_guardian = data.value
    await session.commit()
