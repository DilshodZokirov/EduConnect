"""Fayl ombori (S3 API). Sinovda RustFS, real ishda Cloudflare R2, AWS S3 va boshqalar —
kod bir xil, faqat .env dagi S3_* sozlamalari o'zgaradi.

Ombor yopiq: fayllarga faqat backend bergan vaqtinchalik (imzolangan) havolalar orqali kiriladi.
"""
import asyncio
import re
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import settings

BUCKET = settings.s3_bucket
_client = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint_url,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    region_name=settings.s3_region,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

DOCUMENT_EXTENSIONS = {
    ".pdf", ".ppt", ".pptx", ".pps", ".ppsx", ".doc", ".docx", ".xls", ".xlsx", ".odp", ".odt", ".ods",
    ".txt", ".rtf", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".rar", ".7z",
}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


def safe_filename(name: str) -> str:
    """Ombordagi kalit uchun faqat lotin harflari, raqamlar va - _ . qoldiriladi.
    (Asl nom bazada saqlanadi va yuklab olishda o'sha nom bilan beriladi.)"""
    stem, ext = Path(name).stem, Path(name).suffix.lower()
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._") or "fayl"
    return f"{stem[:80]}{ext[:10]}"


def _public(url: str) -> str:
    if settings.s3_public_base:
        return url.replace(settings.s3_endpoint_url.rstrip("/"), settings.s3_public_base.rstrip("/"), 1)
    return url


async def ensure_bucket(attempts: int = 30) -> None:
    """Bucket bo'lmasa yaratadi. Ombor endi ishga tushayotgan bo'lsa, bir oz kutadi."""
    def run():
        try:
            _client.head_bucket(Bucket=BUCKET)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchBucket", "NotFound"):
                _client.create_bucket(Bucket=BUCKET)
            else:
                raise

    for attempt in range(1, attempts + 1):
        try:
            await asyncio.to_thread(run)
            return
        except Exception:  # noqa: BLE001 — ombor hali tayyor emas
            if attempt == attempts:
                raise
            await asyncio.sleep(2)


async def put_bytes(key: str, data: bytes, content_type: str) -> None:
    await asyncio.to_thread(_client.put_object, Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)


async def get_bytes(key: str) -> bytes:
    def run():
        return _client.get_object(Bucket=BUCKET, Key=key)["Body"].read()
    return await asyncio.to_thread(run)


async def upload_file(path: Path, key: str, content_type: str) -> None:
    await asyncio.to_thread(_client.upload_file, str(path), BUCKET, key, ExtraArgs={"ContentType": content_type})


async def download_file(key: str, path: Path) -> None:
    await asyncio.to_thread(_client.download_file, BUCKET, key, str(path))


async def delete(key: str) -> None:
    try:
        await asyncio.to_thread(_client.delete_object, Bucket=BUCKET, Key=key)
    except ClientError:
        pass


def presign_get(key: str, filename: str | None = None, download: bool = False, expires: int = 600) -> str:
    """Vaqtinchalik o'qish havolasi. download=True bo'lsa brauzer faylni yuklab oladi, aks holda ochadi."""
    params = {"Bucket": BUCKET, "Key": key}
    if filename:
        disposition = "attachment" if download else "inline"
        params["ResponseContentDisposition"] = f"{disposition}; filename*=UTF-8''{quote(filename)}"
    return _public(_client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires))


# ---------- Katta fayllar (video): bo'laklab yuklash ----------

async def create_multipart(key: str, content_type: str) -> str:
    resp = await asyncio.to_thread(_client.create_multipart_upload, Bucket=BUCKET, Key=key, ContentType=content_type)
    return resp["UploadId"]


def presign_part(key: str, upload_id: str, part_number: int, expires: int = 6 * 3600) -> str:
    return _public(_client.generate_presigned_url(
        "upload_part",
        Params={"Bucket": BUCKET, "Key": key, "UploadId": upload_id, "PartNumber": part_number},
        ExpiresIn=expires,
    ))


async def complete_multipart(key: str, upload_id: str, parts: list[tuple[int, str]]) -> None:
    await asyncio.to_thread(
        _client.complete_multipart_upload,
        Bucket=BUCKET, Key=key, UploadId=upload_id,
        MultipartUpload={"Parts": [{"PartNumber": n, "ETag": etag} for n, etag in sorted(parts)]},
    )


async def abort_multipart(key: str, upload_id: str) -> None:
    try:
        await asyncio.to_thread(_client.abort_multipart_upload, Bucket=BUCKET, Key=key, UploadId=upload_id)
    except ClientError:
        pass
