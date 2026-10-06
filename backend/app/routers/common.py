from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attendance, Group, GroupStudent, Lesson, LinkStatus, ParentLink, Role, User
from app.schemas import AttendanceHistoryOut


async def attendance_history(session: AsyncSession, student_id: int, limit: int = 100) -> list[AttendanceHistoryOut]:
    rows = await session.execute(
        select(Lesson.id, Lesson.title, Lesson.lesson_date, Group.name, Attendance.status)
        .join(Lesson, Lesson.id == Attendance.lesson_id)
        .join(Group, Group.id == Lesson.group_id)
        .where(Attendance.student_id == student_id)
        .order_by(Lesson.lesson_date.desc())
        .limit(limit)
    )
    return [
        AttendanceHistoryOut(lesson_id=i, lesson_title=t, lesson_date=d, group_name=g, status=s)
        for i, t, d, g, s in rows
    ]


async def can_access_group(session: AsyncSession, user: User, group_id: int) -> bool:
    """Admin, guruh mentori, guruh o'quvchisi yoki o'quvchining tasdiqlangan ota-onasi."""
    if user.role in (Role.admin, Role.superadmin):
        return True
    if user.role == Role.mentor:
        return await session.scalar(select(Group.id).where(Group.id == group_id, Group.mentor_id == user.id)) is not None
    if user.role == Role.student:
        return await session.scalar(
            select(GroupStudent.student_id).where(GroupStudent.group_id == group_id, GroupStudent.student_id == user.id)
        ) is not None
    if user.role == Role.parent:
        return await session.scalar(
            select(GroupStudent.student_id)
            .join(ParentLink, ParentLink.student_id == GroupStudent.student_id)
            .where(GroupStudent.group_id == group_id, ParentLink.parent_id == user.id,
                   ParentLink.status == LinkStatus.confirmed)
            .limit(1)
        ) is not None
    return False
