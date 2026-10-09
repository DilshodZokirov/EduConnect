import logging

import httpx

from app.config import settings

log = logging.getLogger("telegram")
_http = httpx.AsyncClient(timeout=10)


async def send_message(chat_id: int, text: str, reply_markup: dict | None = None) -> bool:
    """Bot nomidan xabar yuboradi (foydalanuvchi botni bloklagan bo'lsa False)."""
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        resp = await _http.post(f"https://api.telegram.org/bot{settings.bot_token}/sendMessage", json=payload)
        if resp.status_code != 200:
            log.warning("Telegram %s: %s", resp.status_code, resp.text[:200])
            return False
        return True
    except httpx.HTTPError:
        log.exception("Telegram xabari yuborilmadi")
        return False


class TelegramError(Exception):
    pass


async def upload_document(chat_id: int, filename: str, content: bytes, caption: str = "") -> str:
    """Faylni bot orqali chatga yuboradi va Telegram'dagi file_id ni qaytaradi.

    Fayl Telegram serverlarida saqlanadi — bizning serverda joy egallamaydi. Limit: 50 MB.
    """
    async with httpx.AsyncClient(timeout=120) as client:  # katta fayllar uchun uzoqroq kutish
        resp = await client.post(
            f"https://api.telegram.org/bot{settings.bot_token}/sendDocument",
            data={"chat_id": str(chat_id), "caption": caption, "parse_mode": "HTML"},
            files={"document": (filename, content)},
        )
    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    if not data.get("ok"):
        raise TelegramError(data.get("description") or f"Telegram {resp.status_code}")
    return data["result"]["document"]["file_id"]


async def send_document(chat_id: int, file_id: str, caption: str = "") -> None:
    """Saqlangan faylni (file_id) foydalanuvchiga yuboradi."""
    resp = await _http.post(
        f"https://api.telegram.org/bot{settings.bot_token}/sendDocument",
        json={"chat_id": chat_id, "document": file_id, "caption": caption, "parse_mode": "HTML"},
    )
    data = resp.json()
    if not data.get("ok"):
        raise TelegramError(data.get("description") or f"Telegram {resp.status_code}")


_bot_username: str | None = None


async def bot_username() -> str | None:
    """Botning @username'i (havolalar uchun) — bir marta so'raladi."""
    global _bot_username
    if _bot_username is None:
        try:
            resp = await _http.get(f"https://api.telegram.org/bot{settings.bot_token}/getMe")
            _bot_username = resp.json()["result"]["username"]
        except Exception:  # noqa: BLE001
            return None
    return _bot_username
