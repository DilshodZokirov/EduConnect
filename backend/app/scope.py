"""Filiallar bo'yicha ko'rinish doirasi.

- Superadmin va umumiy menejer — barcha filiallar (None).
- Hududiy menejer — o'ziga biriktirilgan filiallar.
- Admin va boshqalar — o'z filiali.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ManagerBranch, Role, User, role_level


async def branch_ids(session: AsyncSession, user: User) -> set[int] | None:
    if user.role in (Role.superadmin, Role.general_manager):
        return None
    if user.role == Role.regional_manager:
        return set(await session.scalars(select(ManagerBranch.branch_id).where(ManagerBranch.manager_id == user.id)))
    return {user.branch_id} if user.branch_id else set()


def in_scope(scope: set[int] | None, branch_id: int | None) -> bool:
    return scope is None or (branch_id is not None and branch_id in scope)


async def assert_can_manage(session: AsyncSession, actor: User, target: User) -> None:
    """Faqat o'zidan past darajadagi va o'z filiallaridagi foydalanuvchini o'zgartirish mumkin."""
    if target.id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O'zingizga bu amalni qo'llay olmaysiz")
    if role_level(target.role) >= role_level(actor.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu foydalanuvchini o'zgartirishga ruxsat yo'q")
    if not in_scope(await branch_ids(session, actor), target.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foydalanuvchi topilmadi")
