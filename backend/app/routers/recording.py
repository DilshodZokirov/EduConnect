"""Ekrandan dars yozish.

Yozish brauzerda (MediaRecorder) bo'ladi, video esa yozilayotgan paytning o'zida bo'lak-bo'lak
omborga yuklanadi — dars tugaganda hammasi deyarli yuklangan bo'ladi va brauzer xotirasi to'lmaydi.

1) POST /mentor/lessons/{id}/recordings          -> material (status uploading) va bo'lak hajmi
2) POST /mentor/recordings/{id}/parts/{n}        -> n-bo'lak uchun vaqtinchalik yuklash havolasi
3) POST /mentor/videos/{id}/complete              -> (umumiy) ishchi videoni siqadi, o'quvchilarga xabar boradi
Ekrandan yozilgan videolar settings.recording_retention_days kundan keyin avtomatik o'chiriladi.

Telefonda ekranni yozib bo'lmaydi, shuning uchun:
- POST /mentor/lessons/{id}/record/send       -> bot mentorga "Darsni yozish" tugmali xabar yuboradi (kompyuterda ochish uchun)
- POST /mentor/lessons/{id}/record/browser    -> Chrome'da ochish uchun bir martalik havola (10 daqiqa)
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.deps import MentorUser
from app.models import LessonMaterial, LoginCode, MaterialKind, MaterialSource, MaterialStatus, User
from app.routers.mentor import VIDEO_PART_SIZE, _own_lesson, _own_material
from app.schemas import MaterialOut, RecordingStartIn, RecordingStartOut, UrlOut
from app.services import storage
from app.services.telegram import send_message

router = APIRouter(prefix="/mentor", tags=["Dars yozish"])

MAX_PARTS = 10000  # S3 cheklovi
LOGIN_CODE_PURPOSE = "record"
MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _webapp_link(**params: str) -> str:
    base = settings.webapp_url.strip()
    if not base.startswith("https://"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "WEBAPP_URL sozlanmagan — administratorga murojaat qiling")
    return f"{base}{'&' if '?' in base else '?'}{urlencode(params)}"


@router.post("/lessons/{lesson_id}/recordings", response_model=RecordingStartOut, status_code=201)
async def start_recording(lesson_id: int, data: RecordingStartIn, user: User = MentorUser,
                          session: AsyncSession = Depends(get_session)):
    lesson = await _own_lesson(session, user, lesson_id)
    content_type = data.content_type.split(";")[0]
    ext = ".mp4" if content_type == "video/mp4" else ".webm"
    d = lesson.lesson_date
    material = LessonMaterial(
        lesson_id=lesson_id, name=(data.name or f"Dars yozuvi — {d.day}-{MONTHS[d.month - 1]}")[:200],
        kind=MaterialKind.video, source=MaterialSource.recording, status=MaterialStatus.uploading,
        content_type=content_type,
    )
    session.add(material)
    await session.flush()
    material.storage_key = f"videos/{material.id}/original{ext}"
    material.upload_id = await storage.create_multipart(material.storage_key, content_type)
    await session.commit()
    return RecordingStartOut(material=MaterialOut.model_validate(material), part_size=VIDEO_PART_SIZE,
                             max_minutes=settings.max_recording_minutes)


@router.post("/recordings/{material_id}/parts/{part_number}", response_model=UrlOut)
async def recording_part_url(material_id: int, part_number: int, user: User = MentorUser,
                             session: AsyncSession = Depends(get_session)):
    material = await _own_material(session, user, material_id)
    if material.source != MaterialSource.recording or material.status != MaterialStatus.uploading or not material.upload_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Bu yozuv allaqachon yakunlangan")
    if not 1 <= part_number <= MAX_PARTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bo'lak raqami noto'g'ri")
    return UrlOut(url=storage.presign_part(material.storage_key, material.upload_id, part_number))


@router.post("/lessons/{lesson_id}/record/send", status_code=204)
async def send_record_button(lesson_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Telefonda bosilganda: bot "Darsni yozish" tugmasini yuboradi — xabar kompyuterdagi Telegram'da ham ko'rinadi."""
    lesson = await _own_lesson(session, user, lesson_id)
    url = _webapp_link(record=f"{lesson.group_id}.{lesson.id}")
    ok = await send_message(
        user.telegram_id,
        f"🎥 <b>Darsni ekrandan yozish</b>\n«{lesson.title}»\n\n"
        "Bu xabarni <b>kompyuterdagi Telegram</b>da oching va pastdagi tugmani bosing. "
        "Agar u yerda yozish ishlamasa, ilovadagi «Brauzerda ochish» tugmasidan foydalaning.",
        reply_markup={"inline_keyboard": [[{"text": "🔴 Darsni yozish", "web_app": {"url": url}}]]},
    )
    if not ok:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Botdan xabar yuborib bo'lmadi. Botni bloklamaganingizni tekshiring.")


@router.post("/lessons/{lesson_id}/record/browser", response_model=UrlOut)
async def browser_record_link(lesson_id: int, user: User = MentorUser, session: AsyncSession = Depends(get_session)):
    """Chrome'da ochish uchun bir martalik havola: faqat shu mentor uchun, 10 daqiqa amal qiladi."""
    lesson = await _own_lesson(session, user, lesson_id)
    code = secrets.token_urlsafe(32)
    session.add(LoginCode(
        code_hash=hash_code(code), user_id=user.id, purpose=LOGIN_CODE_PURPOSE,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.login_code_ttl_minutes),
    ))
    await session.commit()
    return UrlOut(url=_webapp_link(code=code, record=f"{lesson.group_id}.{lesson.id}"))
