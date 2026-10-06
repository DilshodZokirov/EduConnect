from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import StudentUser
from app.models import Group, GroupStudent, Lesson, User
from app.routers.common import attendance_history
from app.schemas import AttendanceHistoryOut, GroupOut, LessonOut

router = APIRouter(prefix="/student", tags=["O'quvchi"])


@router.get("/groups", response_model=list[GroupOut])
async def my_groups(user: User = StudentUser, session: AsyncSession = Depends(get_session)):
    return list(await session.scalars(
        select(Group).join(GroupStudent, GroupStudent.group_id == Group.id)
        .where(GroupStudent.student_id == user.id, Group.is_active.is_(True))
    ))


@router.get("/groups/{group_id}/lessons", response_model=list[LessonOut])
async def group_lessons(group_id: int, user: User = StudentUser, session: AsyncSession = Depends(get_session)):
    member = await session.scalar(
        select(GroupStudent.student_id).where(GroupStudent.group_id == group_id, GroupStudent.student_id == user.id)
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guruh topilmadi")
    return list(await session.scalars(
        select(Lesson).where(Lesson.group_id == group_id).order_by(Lesson.lesson_date.desc())
    ))


@router.get("/attendance", response_model=list[AttendanceHistoryOut])
async def my_attendance(user: User = StudentUser, session: AsyncSession = Depends(get_session)):
    return await attendance_history(session, user.id)
