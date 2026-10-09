"""Filiallar, hududiy menejerlar va markaz brendi."""
import io

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from PIL import Image
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import AdminUser, GeneralUser, SuperUser
from app.models import Branch, CenterSettings, Group, ManagerBranch, Role, User, UserStatus
from app.schemas import (
    BranchIn, BranchOut, BranchShort, CenterSettingsIn, ManagerBranchesIn, ManagerOut, PublicInfoOut, UserShort,
)
from app.scope import branch_ids
from app.services import storage

router = APIRouter(tags=["Filiallar"])
public = APIRouter(prefix="/public", tags=["Ochiq"])


# =================== Markaz brendi ===================

async def get_settings(session: AsyncSession) -> CenterSettings:
    settings_ = await session.get(CenterSettings, 1)
    if settings_ is None:
        settings_ = CenterSettings(id=1, name="EduConnect", logo_version=0)
        session.add(settings_)
        await session.commit()
    return settings_


@public.get("/info", response_model=PublicInfoOut)
async def public_info(session: AsyncSession = Depends(get_session)):
    """Ro'yxatdan o'tish ekrani uchun (avtorizatsiyasiz): markaz nomi, logotip va filiallar."""
    s = await get_settings(session)
    branches = await session.scalars(select(Branch).where(Branch.is_active.is_(True)).order_by(Branch.name))
    return PublicInfoOut(
        name=s.name,
        logo_url=f"/api/public/logo?v={s.logo_version}" if s.logo_key else None,
        branches=[BranchShort.model_validate(b) for b in branches],
    )


@public.get("/logo")
async def public_logo(session: AsyncSession = Depends(get_session)):
    s = await get_settings(session)
    if not s.logo_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Logotip yo'q")
    data = await storage.get_bytes(s.logo_key)
    # ?v= versiyasi o'zgarganda brauzer yangisini oladi, shuning uchun uzoq keshlash xavfsiz
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "public, max-age=31536000"})


@router.put("/admin/settings", response_model=PublicInfoOut)
async def update_settings(data: CenterSettingsIn, user: User = SuperUser, session: AsyncSession = Depends(get_session)):
    s = await get_settings(session)
    s.name = data.name.strip()
    await session.commit()
    return await public_info(session)


@router.post("/admin/settings/logo", response_model=PublicInfoOut)
async def upload_logo(file: UploadFile = File(...), user: User = SuperUser, session: AsyncSession = Depends(get_session)):
    """Logotip: kvadrat rasm tavsiya etiladi; 512×512 PNG ga keltiriladi."""
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Rasm 5 MB dan katta")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Rasm o'qilmadi. PNG yoki JPG yuboring") from exc
    img.thumbnail((512, 512))
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    s = await get_settings(session)
    if s.logo_key:
        await storage.delete(s.logo_key)
    s.logo_version += 1
    s.logo_key = f"center/logo-{s.logo_version}.png"
    await storage.put_bytes(s.logo_key, out.getvalue(), "image/png")
    await session.commit()
    return await public_info(session)


@router.delete("/admin/settings/logo", response_model=PublicInfoOut)
async def delete_logo(user: User = SuperUser, session: AsyncSession = Depends(get_session)):
    s = await get_settings(session)
    if s.logo_key:
        await storage.delete(s.logo_key)
    s.logo_key = None
    s.logo_version += 1
    await session.commit()
    return await public_info(session)


# =================== Filiallar ===================

async def _branch_out(session: AsyncSession, b: Branch) -> BranchOut:
    managers = await session.scalars(
        select(User).join(ManagerBranch, ManagerBranch.manager_id == User.id).where(ManagerBranch.branch_id == b.id)
    )
    admins = await session.scalars(select(User).where(
        User.branch_id == b.id, User.role == Role.admin, User.status == UserStatus.active))
    students = await session.scalar(select(func.count()).where(
        User.branch_id == b.id, User.role == Role.student, User.status == UserStatus.active))
    out = BranchOut.model_validate(b)
    out.managers = [UserShort.model_validate(u) for u in managers]
    out.admins = [UserShort.model_validate(u) for u in admins]
    out.students = students or 0
    return out


@router.get("/admin/branches", response_model=list[BranchOut])
async def list_branches(user: User = AdminUser, session: AsyncSession = Depends(get_session)):
    scope = await branch_ids(session, user)
    stmt = select(Branch).order_by(Branch.is_active.desc(), Branch.name)
    if scope is not None:
        stmt = stmt.where(Branch.id.in_(scope or {-1}))
    return [await _branch_out(session, b) for b in await session.scalars(stmt)]


@router.post("/admin/branches", response_model=BranchOut, status_code=201)
async def create_branch(data: BranchIn, user: User = GeneralUser, session: AsyncSession = Depends(get_session)):
    first = not await session.scalar(select(func.count()).select_from(Branch))
    b = Branch(name=data.name.strip(), address=data.address, city=data.city, is_active=data.is_active)
    session.add(b)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu nomdagi filial mavjud")
    if first:
        # Birinchi filial: hozirgacha filialsiz bo'lgan foydalanuvchi va guruhlar unga o'tkaziladi
        await session.execute(update(User).where(
            User.branch_id.is_(None), User.role.not_in([Role.superadmin, Role.general_manager])).values(branch_id=b.id))
        await session.execute(update(Group).where(Group.branch_id.is_(None)).values(branch_id=b.id))
    await session.commit()
    return await _branch_out(session, b)


@router.put("/admin/branches/{branch_id}", response_model=BranchOut)
async def update_branch(branch_id: int, data: BranchIn, user: User = GeneralUser,
                        session: AsyncSession = Depends(get_session)):
    b = await session.get(Branch, branch_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Filial topilmadi")
    b.name, b.address, b.city, b.is_active = data.name.strip(), data.address, data.city, data.is_active
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu nomdagi filial mavjud")
    return await _branch_out(session, b)


# =================== Hududiy menejerlar ===================

@router.get("/admin/managers", response_model=list[ManagerOut])
async def list_managers(user: User = GeneralUser, session: AsyncSession = Depends(get_session)):
    managers = await session.scalars(select(User).where(User.role == Role.regional_manager).order_by(User.last_name))
    result = []
    for m in managers:
        branches = await session.scalars(
            select(Branch).join(ManagerBranch, ManagerBranch.branch_id == Branch.id).where(ManagerBranch.manager_id == m.id)
        )
        result.append(ManagerOut(user=UserShort.model_validate(m), phone=m.phone,
                                 branches=[BranchShort.model_validate(b) for b in branches]))
    return result


@router.put("/admin/managers/{manager_id}/branches", response_model=ManagerOut)
async def set_manager_branches(manager_id: int, data: ManagerBranchesIn, user: User = GeneralUser,
                               session: AsyncSession = Depends(get_session)):
    """Hududiy menejerga filiallarni biriktirish (umumiy menejer)."""
    m = await session.get(User, manager_id)
    if m is None or m.role != Role.regional_manager:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hududiy menejer topilmadi")
    ids = set(data.branch_ids)
    found = set(await session.scalars(select(Branch.id).where(Branch.id.in_(ids or {-1}))))
    if missing := ids - found:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Filial topilmadi: {sorted(missing)}")
    await session.execute(delete(ManagerBranch).where(ManagerBranch.manager_id == m.id))
    session.add_all(ManagerBranch(manager_id=m.id, branch_id=b) for b in ids)
    await session.commit()
    branches = await session.scalars(select(Branch).where(Branch.id.in_(ids or {-1})).order_by(Branch.name))
    return ManagerOut(user=UserShort.model_validate(m), phone=m.phone,
                      branches=[BranchShort.model_validate(b) for b in branches])
