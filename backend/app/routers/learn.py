"""O'quvchi va ota-ona uchun umumiy: guruh darslari va video ko'rish holati."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_not_locked, get_current_user
from app.models import Lesson, LinkStatus, MaterialStatus, ParentLink, Role, User, UserStatus, VideoView
from app.routers.common import can_access_group
from app.schemas import LessonOut, VideoProgressOut

router = APIRouter(prefix="/learn", tags=["O'quv"])

STAFF = (Role.mentor, Role.admin, Role.regional_manager, Role.general_manager, Role.superadmin)


@router.get("/groups/{group_id}/lessons", response_model=list[LessonOut])
async def group_lessons(group_id: int, user: User = Depends(get_current_user),
                        session: AsyncSession = Depends(get_session)):
    """Guruh darslari. O'quvchi va ota-onaga faqat tayyor materiallar ko'rsatiladi."""
    if user.status != UserStatus.active or not await can_access_group(session, user, group_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    await assert_not_locked(session, user)
    lessons = await session.scalars(
        select(Lesson).where(Lesson.group_id == group_id).order_by(Lesson.lesson_date.desc(), Lesson.id.desc())
    )
    result = []
    for lesson in lessons:
        out = LessonOut.model_validate(lesson)
        if user.role not in STAFF:
            out.materials = [m for m in out.materials if m.status == MaterialStatus.ready]
        result.append(out)
    return result


@router.get("/students/{student_id}/video-progress", response_model=list[VideoProgressOut])
async def video_progress(student_id: int, user: User = Depends(get_current_user),
                         session: AsyncSession = Depends(get_session)):
    """O'quvchi videolarni necha foiz ko'rgani. O'quvchining o'zi, tasdiqlangan ota-onasi yoki admin ko'radi."""
    allowed = user.status == UserStatus.active and (
        (user.role == Role.student and user.id == student_id)
        or user.role in (Role.admin, Role.regional_manager, Role.general_manager, Role.superadmin)
        or (user.role == Role.parent and await session.scalar(
            select(ParentLink.id).where(
                ParentLink.parent_id == user.id, ParentLink.student_id == student_id,
                ParentLink.status == LinkStatus.confirmed,
            )
        ) is not None)
    )
    if not allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Topilmadi")
    await assert_not_locked(session, user)
    rows = await session.execute(
        select(VideoView.material_id, VideoView.percent).where(VideoView.student_id == student_id)
    )
    return [VideoProgressOut(material_id=m, percent=p) for m, p in rows]
