"""Guruh havolasi orqali qo'shilish: o'quvchi darhol guruhga kiradi, ota-ona farzandini tanlaydi (o'qituvchi tasdiqlaydi)."""
import secrets

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Group, GroupStudent, LinkStatus, ParentLink, Role, User, UserStatus
from app.services import billing


def new_token() -> str:
    return secrets.token_urlsafe(12)


async def group_by_token(session: AsyncSession, token: str, must_be_active: bool = True) -> Group:
    group = await session.scalar(select(Group).where(Group.invite_token == token))
    if group is None or not group.is_active or (must_be_active and not group.invite_active):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Havola eskirgan yoki o'chirilgan. O'qituvchingizdan yangisini so'rang")
    return group


def _check_role(user: User, join_as: str) -> None:
    if user.role in (Role.mentor, Role.admin, Role.regional_manager, Role.general_manager, Role.superadmin):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Xodimlar guruh havolasi orqali qo'shilmaydi")
    if user.role == Role.student and join_as == "parent":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Siz o'quvchi sifatida ro'yxatdan o'tgansiz. Rolni o'zgartirish uchun o'qituvchiga murojaat qiling")
    if user.role == Role.parent and join_as == "student":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Siz ota-ona sifatida ro'yxatdan o'tgansiz. Rolni o'zgartirish uchun o'qituvchiga murojaat qiling")


async def join_as_student(session: AsyncSession, user: User, group: Group) -> bool:
    """O'quvchini guruhga qo'shadi. Yangi qo'shilgan bo'lsa True."""
    _check_role(user, "student")
    user.role, user.status, user.awaiting_manager = Role.student, UserStatus.active, False
    if user.joined_group_id is None:
        user.joined_group_id = group.id
    if group.branch_id and not user.branch_id:
        user.branch_id = group.branch_id
    exists = await session.scalar(select(GroupStudent.student_id).where(
        GroupStudent.group_id == group.id, GroupStudent.student_id == user.id))
    if exists:
        return False
    session.add(GroupStudent(group_id=group.id, student_id=user.id))
    today = billing.today()
    await billing.ensure_invoice(session, group, user.id, billing.month_start(today), today)
    return True


async def join_as_parent(session: AsyncSession, user: User, group: Group, child_ids: list[int]) -> list[ParentLink]:
    """Ota-ona: tanlangan farzandlar uchun bog'lanish so'rovi (o'qituvchi tasdiqlaydi)."""
    _check_role(user, "parent")
    user.role, user.status, user.awaiting_manager = Role.parent, UserStatus.active, False
    if user.joined_group_id is None:
        user.joined_group_id = group.id
    if group.branch_id and not user.branch_id:
        user.branch_id = group.branch_id
    if not child_ids:
        return []
    members = set(await session.scalars(select(GroupStudent.student_id).where(
        GroupStudent.group_id == group.id, GroupStudent.student_id.in_(child_ids))))
    if set(child_ids) - members:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tanlangan o'quvchi bu guruhda emas")
    created = []
    for child_id in child_ids:
        link = await session.scalar(select(ParentLink).where(
            ParentLink.parent_id == user.id, ParentLink.student_id == child_id))
        if link and link.status != LinkStatus.rejected:
            continue  # allaqachon bog'langan yoki kutilmoqda
        if link is None:
            link = ParentLink(parent_id=user.id, student_id=child_id)
            session.add(link)
        link.status, link.created_by, link.decided_at, link.requested_by_parent = LinkStatus.pending, user.id, None, True
        created.append(link)
    return created


def short_label(u: User) -> str:
    return f"{u.first_name} {u.last_name[:1]}." if u.last_name else u.first_name
