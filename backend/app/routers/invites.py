"""Guruh havolalari, o'qituvchining o'z guruhlari, ota-ona so'rovlari va rollarni tuzatish."""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import MentorUser, get_current_user
from app.models import (
    Group, GroupStudent, Invoice, LinkStatus, ParentLink, PendingInvite, Role, User, UserStatus,
)
from app.config import settings
from app.security import InitDataError, validate_init_data
from app.routers.branches import get_settings
from app.routers.mentor import _check_teaches, _own_group
from app.schemas import (
    ClassmateOut, GroupOut, InviteInfoOut, InviteOut, JoinIn, JoinOut, MentorGroupIn, MentorRoleIn, ParentLinkOut,
    UserOut, UserShort,
)
from app.services import billing, notify
from app.services.invites import group_by_token, join_as_parent, join_as_student, new_token, short_label
from app.services.telegram import bot_username

router = APIRouter(tags=["Guruh havolalari"])


async def _info(session: AsyncSession, group: Group) -> InviteInfoOut:
    s = await get_settings(session)
    return InviteInfoOut(
        center_name=s.name, group_name=group.name, branch_name=group.branch_name,
        branch_address=group.branch.address if group.branch else None,
        mentor_name=group.mentor.full_name if group.mentor else None, schedule=group.schedule,
        active=group.invite_active,
    )


@router.get("/public/invite/{token}", response_model=InviteInfoOut)
async def public_invite(token: str, session: AsyncSession = Depends(get_session)):
    """Havola ochilganda ko'rsatiladigan kartochka: markaz, filial, guruh, o'qituvchi, jadval."""
    return await _info(session, await group_by_token(session, token))


@router.get("/join/{token}/students", response_model=list[ClassmateOut])
async def classmates(token: str, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Ota-ona farzandini tanlashi uchun: faqat ism va familiyaning bosh harfi."""
    group = await group_by_token(session, token)
    students = await session.scalars(
        select(User).join(GroupStudent, GroupStudent.student_id == User.id)
        .where(GroupStudent.group_id == group.id).order_by(User.first_name, User.last_name))
    return [ClassmateOut(id=s.id, label=short_label(s)) for s in students]


@router.post("/join/{token}", response_model=JoinOut)
async def join(token: str, data: JoinIn, bg: BackgroundTasks, user: User = Depends(get_current_user),
               session: AsyncSession = Depends(get_session)):
    """Ro'yxatdan o'tgan foydalanuvchi havola orqali guruhga qo'shiladi yoki farzandini bog'laydi."""
    if user.status == UserStatus.blocked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Profil bloklangan")
    group = await group_by_token(session, token)
    await clear_pending(session, user.telegram_id)
    if data.join_as == "student":
        added = await join_as_student(session, user, group)
        await session.commit()
        if added:
            bg.add_task(notify.student_joined, group.id, user.id)
        return JoinOut(joined_as="student", group_name=group.name)
    links = await join_as_parent(session, user, group, data.child_ids)
    await session.commit()
    for link in links:
        bg.add_task(notify.parent_requested, link.id)
    return JoinOut(joined_as="parent", group_name=group.name, pending_children=len(links))


# =================== Eslab qolingan havola (bot -> ilova) ===================

PENDING_INVITE_HOURS = 48


def _bot_key_ok(key: str | None) -> bool:
    expected = hashlib.sha256(settings.bot_token.encode()).hexdigest()
    return bool(key) and hmac.compare_digest(key, expected)


async def clear_pending(session: AsyncSession, telegram_id: int) -> None:
    await session.execute(delete(PendingInvite).where(PendingInvite.telegram_id == telegram_id))


@router.post("/bot/pending-invite", status_code=204)
async def bot_pending_invite(data: dict, x_bot_key: str | None = Header(default=None),
                             session: AsyncSession = Depends(get_session)):
    """Bot chaqiradi: foydalanuvchi guruh havolasini ochdi — ilova qaysi tugmadan ochilmasin, havola qo'llanadi."""
    if not _bot_key_ok(x_bot_key):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ruxsat yo'q")
    try:
        telegram_id, token = int(data["telegram_id"]), str(data["token"])[:40]
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "telegram_id va token kerak")
    row = await session.get(PendingInvite, telegram_id)
    if row is None:
        session.add(PendingInvite(telegram_id=telegram_id, token=token))
    else:
        row.token, row.created_at = token, datetime.now(timezone.utc)
    await session.commit()


@router.post("/auth/pending-invite")
async def get_pending_invite(data: dict, session: AsyncSession = Depends(get_session)):
    """Ilova ochilganda: shu Telegram foydalanuvchisi uchun eslab qolingan guruh havolasi bormi."""
    try:
        tg = validate_init_data(str(data.get("init_data", "")))
    except InitDataError:
        return {"token": None}
    row = await session.get(PendingInvite, tg["id"])
    if row is None:
        return {"token": None}
    if row.created_at < datetime.now(timezone.utc) - timedelta(hours=PENDING_INVITE_HOURS):
        await session.delete(row)
        await session.commit()
        return {"token": None}
    group = await session.scalar(select(Group).where(Group.invite_token == row.token))
    if group is None or not group.is_active or not group.invite_active:
        return {"token": None}
    return {"token": row.token}


@router.post("/join/pending/clear", status_code=204)
async def clear_pending_invite(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """«Keyinroq» bosilganda — havola qayta-qayta chiqmasligi uchun."""
    await clear_pending(session, user.telegram_id)
    await session.commit()


# =================== O'qituvchi: o'z guruhlari ===================

async def _invite_out(session: AsyncSession, group: Group) -> InviteOut:
    info = await _info(session, group)
    username = await bot_username()
    param = "startapp" if settings.invite_open_app else "start"
    url = f"https://t.me/{username}?{param}=g_{group.invite_token}" if username else None
    return InviteOut(**info.model_dump(), token=group.invite_token, url=url)


@router.post("/mentor/groups", response_model=GroupOut, status_code=201)
async def mentor_create_group(data: MentorGroupIn, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """O'qituvchi guruhni o'zi yaratadi (o'z filialida, o'zi mentor)."""
    if user.role != Role.mentor:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Guruhni bu yerda faqat o'qituvchi yaratadi")
    branch_id = data.branch_id or user.branch_id
    if data.branch_id is not None:
        # Mentor bir nechta filialda dars bera oladi — guruh ochayotganda filialni o'zi tanlaydi
        from app.models import Branch  # noqa: PLC0415
        branch = await session.get(Branch, data.branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Filial topilmadi")
    group = Group(name=data.name.strip(), schedule=data.schedule, price=data.price, mentor_id=user.id,
                  branch_id=branch_id, invite_token=new_token())
    session.add(group)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu nomdagi guruh mavjud")
    await session.refresh(group, ["mentor", "branch"])
    return GroupOut.model_validate(group)


@router.patch("/mentor/groups/{group_id}", response_model=GroupOut)
async def mentor_update_group(group_id: int, data: MentorGroupIn, user: User = MentorUser,
                              session: AsyncSession = Depends(get_session)):
    group = await _own_group(session, user, group_id)
    group.name, group.schedule = data.name.strip(), data.schedule
    if data.branch_id and data.branch_id != group.branch_id:
        from app.models import Branch  # noqa: PLC0415
        branch = await session.get(Branch, data.branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Filial topilmadi")
        group.branch_id = branch.id
    price_changed = data.price != group.price
    group.price = data.price
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu nomdagi guruh mavjud")
    if price_changed and data.price:
        await billing.generate_month(session, billing.month_start(billing.today()))
    out = GroupOut.model_validate(group)
    out.student_count = await session.scalar(select(func.count()).where(GroupStudent.group_id == group.id)) or 0
    return out


@router.get("/mentor/groups/{group_id}/invite", response_model=InviteOut)
async def get_invite(group_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    group = await _own_group(session, user, group_id)
    if not group.invite_token:
        group.invite_token = new_token()
        await session.commit()
    return await _invite_out(session, group)


@router.post("/mentor/groups/{group_id}/invite/reset", response_model=InviteOut)
async def reset_invite(group_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Yangi havola — eskisi darhol ishlamay qoladi (begona joyga tarqalib ketsa)."""
    group = await _own_group(session, user, group_id)
    group.invite_token, group.invite_active = new_token(), True
    await session.commit()
    return await _invite_out(session, group)


@router.post("/mentor/groups/{group_id}/invite/active", response_model=InviteOut)
async def toggle_invite(group_id: int, active: bool = Query(...), user: User = MentorUser,
                        session: AsyncSession = Depends(get_session)):
    group = await _own_group(session, user, group_id)
    group.invite_active = active
    await session.commit()
    return await _invite_out(session, group)


@router.delete("/mentor/groups/{group_id}/students/{student_id}", status_code=204)
async def mentor_remove_student(group_id: int, student_id: int, user: User = MentorUser,
                                session: AsyncSession = Depends(get_session)):
    await _own_group(session, user, group_id)
    await session.execute(delete(GroupStudent).where(
        GroupStudent.group_id == group_id, GroupStudent.student_id == student_id))
    await session.execute(delete(Invoice).where(
        Invoice.group_id == group_id, Invoice.student_id == student_id,
        Invoice.period > billing.month_start(billing.today()), Invoice.paid_amount == 0))
    await session.commit()


# =================== O'qituvchi: ota-ona so'rovlari ===================

async def _my_student_ids(session: AsyncSession, user: User) -> set[int]:
    return set(await session.scalars(
        select(GroupStudent.student_id).join(Group, Group.id == GroupStudent.group_id).where(Group.mentor_id == user.id)))


async def _link_out(session: AsyncSession, link: ParentLink) -> ParentLinkOut:
    parent = await session.get(User, link.parent_id)
    student = await session.get(User, link.student_id)
    return ParentLinkOut(id=link.id, parent=UserShort.model_validate(parent), student=UserShort.model_validate(student),
                         status=link.status, created_at=link.created_at, requested_by_parent=link.requested_by_parent)


@router.get("/mentor/parent-requests", response_model=list[ParentLinkOut])
async def parent_requests(user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Havola orqali kelgan ota-onalarning "bu mening farzandim" so'rovlari."""
    ids = await _my_student_ids(session, user)
    links = await session.scalars(select(ParentLink).where(
        ParentLink.requested_by_parent.is_(True), ParentLink.status == LinkStatus.pending,
        ParentLink.student_id.in_(ids or {-1})).order_by(ParentLink.created_at))
    return [await _link_out(session, link) for link in links]


@router.post("/mentor/parent-requests/{link_id}/{decision}", response_model=ParentLinkOut)
async def decide_parent_request(link_id: int, decision: str, bg: BackgroundTasks, user: User = MentorUser,
                                session: AsyncSession = Depends(get_session)):
    if decision not in ("confirm", "reject"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "confirm yoki reject")
    link = await session.get(ParentLink, link_id)
    if (link is None or not link.requested_by_parent or link.status != LinkStatus.pending
            or link.student_id not in await _my_student_ids(session, user)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "So'rov topilmadi")
    link.status = LinkStatus.confirmed if decision == "confirm" else LinkStatus.rejected
    link.decided_at = datetime.now(timezone.utc)
    await session.commit()
    bg.add_task(notify.parent_request_decided, link.id)
    return await _link_out(session, link)


# =================== O'qituvchi: rolni tuzatish ===================

@router.post("/mentor/users/{user_id}/role", response_model=UserOut)
async def fix_role(user_id: int, data: MentorRoleIn, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Adashib noto'g'ri rol bilan ro'yxatdan o'tganlarni tuzatish: o'quvchi <-> ota-ona."""
    target = await session.get(User, user_id)
    if target is None or target.role not in (Role.student, Role.parent) or target.id == user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Foydalanuvchi topilmadi")
    mine = await _my_student_ids(session, user)
    is_my_student = target.role == Role.student and target.id in mine
    my_group_ids = set(await session.scalars(select(Group.id).where(Group.mentor_id == user.id)))
    is_my_parent = target.role == Role.parent and (
        target.joined_group_id in my_group_ids
        or await session.scalar(select(ParentLink.id).where(
            ParentLink.parent_id == target.id, ParentLink.student_id.in_(mine or {-1})).limit(1)) is not None)
    if not (is_my_student or is_my_parent):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bu foydalanuvchi sizning guruhingizda emas")

    if data.role == "parent" and target.role == Role.student:
        my_groups = list(await session.scalars(select(Group.id).where(Group.mentor_id == user.id)))
        await session.execute(delete(GroupStudent).where(
            GroupStudent.student_id == target.id, GroupStudent.group_id.in_(my_groups or [-1])))
        await session.execute(delete(Invoice).where(
            Invoice.student_id == target.id, Invoice.group_id.in_(my_groups or [-1]), Invoice.paid_amount == 0))
        target.role = Role.parent
    elif data.role == "student" and target.role == Role.parent:
        if not data.group_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Qaysi guruhga qo'shishni tanlang")
        group = await _own_group(session, user, data.group_id)
        await session.execute(delete(ParentLink).where(ParentLink.parent_id == target.id))
        target.role = None  # join_as_student "ota-ona o'quvchi bo'la olmaydi" tekshiruvidan o'tishi uchun
        await join_as_student(session, target, group)
    await session.commit()
    await session.refresh(target, ["branch"])
    return target


@router.get("/mentor/groups/{group_id}/unlinked-parents", response_model=list[UserShort])
async def unlinked_parents(group_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Guruh havolasi orqali "ota-ona" bo'lib kelgan, lekin hali farzand tanlamaganlar.
    Ko'pincha bu adashib ro'yxatdan o'tgan o'quvchi — o'qituvchi rolini tuzatadi."""
    await _own_group(session, user, group_id)
    linked = select(ParentLink.parent_id).where(ParentLink.status != LinkStatus.rejected)
    return list(await session.scalars(select(User).where(
        User.joined_group_id == group_id, User.role == Role.parent, User.id.not_in(linked)).order_by(User.created_at.desc())))
