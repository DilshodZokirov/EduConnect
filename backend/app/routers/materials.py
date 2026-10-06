"""Materiallarni ochish/yuklab olish — barcha rollar uchun (Telegram, veb va kelajakdagi mobil ilova bir xil ishlatadi)."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import assert_not_locked, get_current_user
from app.models import Lesson, LessonMaterial, MaterialKind, MaterialStatus, Role, User, UserStatus, VideoView
from app.routers.common import can_access_group
from app.schemas import MaterialUrlOut, ProgressIn
from app.services import storage
from app.services.telegram import TelegramError, send_document, upload_document

router = APIRouter(prefix="/materials", tags=["Materiallar"])

TELEGRAM_LIMIT = 50 * 1024 * 1024
FILE_URL_TTL = 10 * 60        # hujjat havolasi 10 daqiqa amal qiladi
VIDEO_URL_TTL = 4 * 60 * 60   # video uzoq ko'riladi — pleer shu havola bilan oldinga/orqaga o'tadi


async def _accessible(session: AsyncSession, user: User, material_id: int) -> tuple[LessonMaterial, Lesson]:
    material = await session.get(LessonMaterial, material_id)
    lesson = await session.get(Lesson, material.lesson_id) if material else None
    if (lesson is None or user.status != UserStatus.active
            or not await can_access_group(session, user, lesson.group_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material topilmadi")
    await assert_not_locked(session, user)
    return material, lesson


def _download_name(material: LessonMaterial) -> str:
    ext = Path(material.storage_key or "").suffix
    return material.name if material.name.lower().endswith(ext.lower()) else f"{material.name}{ext}"


@router.get("/{material_id}/url", response_model=MaterialUrlOut)
async def material_url(material_id: int, download: bool = Query(default=False),
                       user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Faylni ochish yoki yuklab olish uchun vaqtinchalik havola."""
    material, _ = await _accessible(session, user, material_id)
    if material.kind == MaterialKind.link:
        return MaterialUrlOut(url=material.url, expires_in=0)
    if material.status != MaterialStatus.ready or not material.storage_key:
        raise HTTPException(status.HTTP_409_CONFLICT, "Material hali tayyor emas")
    ttl = VIDEO_URL_TTL if material.kind == MaterialKind.video else FILE_URL_TTL
    filename = _download_name(material)
    url = storage.presign_get(material.storage_key, filename, download=download, expires=ttl)
    return MaterialUrlOut(url=url, expires_in=ttl, filename=filename)


@router.post("/{material_id}/send", status_code=204)
async def send_to_telegram(material_id: int, user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    """Faylni foydalanuvchining Telegram chatiga yuborish (qo'shimcha qulaylik, asosiy saqlash joyi — ombor)."""
    material, lesson = await _accessible(session, user, material_id)
    caption = f"📚 {lesson.title}"
    try:
        if material.telegram_file_id:
            await send_document(user.telegram_id, material.telegram_file_id, caption)
            return
        if material.kind != MaterialKind.file or not material.storage_key:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bu materialni ilova ichida oching")
        if (material.size_bytes or 0) > TELEGRAM_LIMIT:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fayl Telegram uchun juda katta — «Yuklab olish» ni bosing")
        content = await storage.get_bytes(material.storage_key)
        file_id = await upload_document(user.telegram_id, _download_name(material), content, caption)
        material.telegram_file_id = file_id  # keyingi safar tezroq yuboriladi
        await session.commit()
    except TelegramError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Yuborib bo'lmadi: {exc}. Botni bloklamaganingizni tekshiring")


@router.post("/{material_id}/progress", status_code=204)
async def video_progress(material_id: int, data: ProgressIn, user: User = Depends(get_current_user),
                         session: AsyncSession = Depends(get_session)):
    """Video ko'rilgan joyni saqlaydi. Faqat o'quvchilar hisobga olinadi."""
    if user.role != Role.student:
        return
    material, _ = await _accessible(session, user, material_id)
    if material.kind != MaterialKind.video:
        return
    duration = material.duration_seconds or data.duration
    position = min(int(data.position), int(duration))
    view = await session.scalar(
        select(VideoView).where(VideoView.material_id == material_id, VideoView.student_id == user.id)
    )
    if view is None:
        view = VideoView(material_id=material_id, student_id=user.id, max_position=0, percent=0)
        session.add(view)
    if position > view.max_position:
        view.max_position = position
        view.percent = min(100, round(100 * position / duration))
    await session.commit()
