"""Fon ishchisi: yuklangan dars videolarini siqadi va o'quvchilarga xabar beradi.

Ishga tushirish: python -m app.worker  (docker-compose'da `worker` xizmati)
Bir nechta ishchi parallel ishlashi mumkin — har bir video faqat bitta ishchiga tushadi.
"""
import asyncio
import json
import logging
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, update

from app.db import SessionLocal
from app.models import (
    Assignment, Submission, SubmissionStatus, Invoice, GroupStudent, Lesson, LessonMaterial, LinkStatus, MaterialKind, MaterialStatus, ParentLink, User,
)
from app.services import ai_grader, billing, notify, storage
from app.services.telegram import send_message

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("worker")

# Ekran va dars videolari uchun sozlamalar: matn o'qiladi, ovoz aniq, hajm kichik
VIDEO_FILTER = "fps=15,mpdecimate,scale='min(1920,trunc(iw/2)*2)':-2"
FFMPEG_VIDEO = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-fps_mode", "vfr"]
FFMPEG_AUDIO = ["-af", "loudnorm", "-c:a", "aac", "-b:a", "64k", "-ac", "1"]
STALE_UPLOAD_HOURS = 24


async def run(*args: str) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate()
    return proc.returncode, out.decode(errors="ignore"), err.decode(errors="ignore")


async def probe(path: Path) -> tuple[bool, bool, float]:
    code, out, err = await run("ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path))
    if code != 0:
        raise RuntimeError(f"Video o'qilmadi: {err[-300:]}")
    data = json.loads(out)
    streams = data.get("streams", [])
    has_video = any(s.get("codec_type") == "video" for s in streams)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    return has_video, has_audio, float(data.get("format", {}).get("duration") or 0)


async def claim() -> int | None:
    """Navbatdagi videoni oladi (status processing -> encoding)."""
    async with SessionLocal() as session:
        material_id = await session.scalar(
            select(LessonMaterial.id)
            .where(LessonMaterial.kind == MaterialKind.video, LessonMaterial.status == MaterialStatus.processing)
            .order_by(LessonMaterial.id)
            .limit(1)
        )
        if material_id is None:
            return None
        result = await session.execute(
            update(LessonMaterial)
            .where(LessonMaterial.id == material_id, LessonMaterial.status == MaterialStatus.processing)
            .values(status=MaterialStatus.encoding)
        )
        await session.commit()
        return material_id if result.rowcount == 1 else None


async def notify_ready(material_id: int) -> None:
    async with SessionLocal() as session:
        material = await session.get(LessonMaterial, material_id)
        lesson = await session.get(Lesson, material.lesson_id)
        students = list(await session.scalars(
            select(User).join(GroupStudent, GroupStudent.student_id == User.id).where(GroupStudent.group_id == lesson.group_id)
        ))
        parents = list(await session.scalars(
            select(User).join(ParentLink, ParentLink.parent_id == User.id).where(
                ParentLink.student_id.in_([s.id for s in students] or [0]),
                ParentLink.status == LinkStatus.confirmed,
            ).distinct()
        ))
    text = f"📹 «{lesson.title}» darsining videosi tayyor. EduConnect ilovasida ko'rishingiz mumkin."
    for person in {u.id: u for u in students + parents}.values():
        await send_message(person.telegram_id, text)


async def process(material_id: int) -> None:
    async with SessionLocal() as session:
        material = await session.get(LessonMaterial, material_id)
        original_key = material.storage_key
    log.info("Video %s siqilmoqda", material_id)
    tmp = Path(tempfile.mkdtemp(prefix="video-"))
    try:
        src = tmp / f"original{Path(original_key).suffix}"
        dst = tmp / "video.mp4"
        await storage.download_file(original_key, src)
        has_video, has_audio, duration = await probe(src)
        if not has_video:
            raise RuntimeError("Faylda video topilmadi")

        args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vf", VIDEO_FILTER, *FFMPEG_VIDEO]
        args += FFMPEG_AUDIO if has_audio else ["-an"]
        args += ["-movflags", "+faststart", str(dst)]
        started = time.monotonic()
        code, _, err = await run(*args)
        if code != 0:
            raise RuntimeError(f"ffmpeg xatosi: {err[-500:]}")

        new_key = f"videos/{material_id}/video.mp4"
        await storage.upload_file(dst, new_key, "video/mp4")
        await storage.delete(original_key)
        size = dst.stat().st_size
        async with SessionLocal() as session:
            material = await session.get(LessonMaterial, material_id)
            material.storage_key = new_key
            material.content_type = "video/mp4"
            material.size_bytes = size
            material.duration_seconds = round(duration)
            material.status = MaterialStatus.ready
            material.error = None
            await session.commit()
        log.info("Video %s tayyor: %.1f MB, %d s ichida", material_id, size / 1024 / 1024, time.monotonic() - started)
        await notify_ready(material_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("Video %s siqilmadi", material_id)
        async with SessionLocal() as session:
            material = await session.get(LessonMaterial, material_id)
            if material:
                material.status = MaterialStatus.failed
                material.error = str(exc)[:1000]
                await session.commit()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def cleanup_stale_uploads() -> None:
    """24 soatdan beri tugallanmagan yuklashlarni o'chiradi."""
    limit = datetime.now(timezone.utc) - timedelta(hours=STALE_UPLOAD_HOURS)
    async with SessionLocal() as session:
        stale = list(await session.scalars(
            select(LessonMaterial).where(
                LessonMaterial.status == MaterialStatus.uploading, LessonMaterial.created_at < limit,
            )
        ))
        for material in stale:
            if material.upload_id and material.storage_key:
                await storage.abort_multipart(material.storage_key, material.upload_id)
            await session.delete(material)
        await session.commit()
        if stale:
            log.info("%d ta tugallanmagan yuklash o'chirildi", len(stale))


async def claim_submission() -> int | None:
    async with SessionLocal() as session:
        sid = await session.scalar(
            select(Submission.id).where(Submission.ai_status == SubmissionStatus.pending).order_by(Submission.id).limit(1)
        )
        if sid is None:
            return None
        result = await session.execute(
            update(Submission).where(Submission.id == sid, Submission.ai_status == SubmissionStatus.pending)
            .values(ai_status=SubmissionStatus.checking)
        )
        await session.commit()
        return sid if result.rowcount == 1 else None


async def check_submission(submission_id: int) -> None:
    """AI dastlabki tekshiruvi. Natija o'quvchiga izoh sifatida darhol ko'rinadi, baho — mentor tasdiqlagach."""
    async with SessionLocal() as session:
        sub = await session.get(Submission, submission_id)
        a = await session.get(Assignment, sub.assignment_id)
        images = [await storage.get_bytes(f.storage_key) for f in sub.files]
        try:
            result = await ai_grader.grade(title=a.title, description=a.description, criteria=a.criteria,
                                           answer_text=sub.text, is_code=sub.is_code, images=images)
        except Exception as exc:  # noqa: BLE001
            log.warning("Javob %s AI tekshiruvida xato: %s", submission_id, exc)
            sub.ai_status, sub.ai_error = SubmissionStatus.failed, str(exc)[:1000]
            await session.commit()
            return
        # O'quvchi tekshiruv paytida qayta topshirgan bo'lsa — eski natijani yozmaymiz
        await session.refresh(sub)
        if sub.ai_status != SubmissionStatus.checking:
            return
        sub.ai_score = result["score"]
        sub.ai_feedback = result["feedback"]
        sub.ai_details = json.dumps(result["criteria"], ensure_ascii=False)
        sub.ai_status = SubmissionStatus.done if result["confident"] else SubmissionStatus.review
        await session.commit()
    log.info("Javob %s tekshirildi: %s ball", submission_id, result["score"])


async def homework_tasks() -> None:
    """Vazifa muddatiga 1 kun qolganda va muddat o'tganda eslatmalar."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        soon = list(await session.scalars(select(Assignment).where(
            Assignment.reminder_sent.is_(False), Assignment.due_at > now, Assignment.due_at <= now + timedelta(days=1))))
        missed = list(await session.scalars(select(Assignment).where(
            Assignment.overdue_notified.is_(False), Assignment.due_at <= now,
            Assignment.due_at > now - timedelta(days=3))))  # juda eski vazifalar uchun xabar yubormaymiz
        for a in soon:
            a.reminder_sent = True
        for a in missed:
            a.overdue_notified = True
        await session.commit()
    for a in soon:
        await notify.homework_due_soon(a.id)
    for a in missed:
        await notify.homework_missed(a.id)


async def billing_tasks() -> None:
    """Oy to'lovlarini yaratadi va eslatmalarni yuboradi (har 10 daqiqada; bir xil eslatma takrorlanmaydi)."""
    now = datetime.now(timezone.utc).astimezone(billing.ZoneInfo(billing.settings.timezone))
    today = now.date()
    async with SessionLocal() as session:
        created = await billing.generate_month(session, billing.month_start(today))
        if today.day >= 20:  # keyingi oy to'lovlari oldindan — oldindan to'lash va oy oxiridagi eslatma uchun
            created += await billing.generate_month(session, billing.next_month(billing.month_start(today)))
        if created:
            log.info("%d ta oylik to'lov yaratildi", created)

    if not 9 <= now.hour < 20:  # kechasi xabar yubormaymiz
        return
    async with SessionLocal() as session:
        pending = list(await session.scalars(
            select(Invoice).where(Invoice.paid_amount < Invoice.amount, Invoice.reminder_stage < 3)
        ))
        to_send = []
        for inv in pending:
            stage = billing.reminder_stage_for(inv, today)
            if stage > inv.reminder_stage:
                inv.reminder_stage = stage
                to_send.append((inv.id, stage))
        await session.commit()
    for invoice_id, stage in to_send:
        await notify.payment_reminder(invoice_id, stage)
    if to_send:
        log.info("%d ta to'lov eslatmasi yuborildi", len(to_send))


async def main() -> None:
    # Ishchi to'satdan to'xtagan bo'lsa, chala qolgan videolar va AI tekshiruvlarini navbatga qaytaramiz
    async with SessionLocal() as session:
        await session.execute(
            update(LessonMaterial).where(LessonMaterial.status == MaterialStatus.encoding)
            .values(status=MaterialStatus.processing)
        )
        await session.execute(
            update(Submission).where(Submission.ai_status == SubmissionStatus.checking)
            .values(ai_status=SubmissionStatus.pending)
        )
        await session.commit()
    log.info("Ishchi ishga tushdi")
    last_cleanup = 0.0
    last_billing = 0.0
    while True:
        if time.monotonic() - last_billing > 600:
            try:
                await billing_tasks()
            except Exception:  # noqa: BLE001
                log.exception("To'lov vazifalarida xato")
            try:
                await homework_tasks()
            except Exception:  # noqa: BLE001
                log.exception("Uy vazifasi eslatmalarida xato")
            last_billing = time.monotonic()
        submission_id = await claim_submission()
        if submission_id:
            await check_submission(submission_id)
            continue
        material_id = await claim()
        if material_id:
            await process(material_id)
            continue
        if time.monotonic() - last_cleanup > 3600:
            await cleanup_stale_uploads()
            last_cleanup = time.monotonic()
        await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
