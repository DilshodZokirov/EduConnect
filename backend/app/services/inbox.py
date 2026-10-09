"""Bildirishnomalar: har bir xabar ilova ichidagi «qo'ng'iroqcha»ga yoziladi va (sozlamaga ko'ra) Telegram'ga yuboriladi.

Majburiy turlar (davomat, to'lov, hisob) Telegram'da o'chirilmaydi — ota-ona muhim xabarni o'tkazib yubormasligi uchun.
"""
import html
import re

from app.db import SessionLocal
from app.models import Notification, User
from app.services.telegram import send_message

# Foydalanuvchi o'zi o'chira oladigan turlar (Telegram uchun)
OPTIONAL_KINDS = {
    "homework": "Uy vazifalari: yangi vazifa, baho",
    "reminder": "Eslatmalar: vazifa muddati, dars boshlanishi",
    "test": "Testlar: yangi test, qayta topshirish",
    "video": "Dars videolari tayyor bo'lganda",
    "rating": "Reyting va yutuqlar",
    "announce": "E'lonlar va jadval o'zgarishi",
}
# Har doim yuboriladi
MANDATORY_KINDS = {
    "attendance": "Darsga kelmaganlik",
    "payment": "To'lovlar va eslatmalar",
    "account": "Hisob, tasdiqlash va xavfsizlik",
}

_TAG = re.compile(r"<[^>]+>")


def _split(text: str) -> tuple[str, str | None]:
    plain = html.unescape(_TAG.sub("", text)).strip()
    first, _, rest = plain.partition("\n")
    return first[:300], (rest.strip() or None)


def telegram_allowed(user: User, kind: str) -> bool:
    if kind in MANDATORY_KINDS:
        return True
    return (user.notify_prefs or {}).get(kind, True)


async def deliver(user: User, text: str, *, kind: str, link: str | None = None, telegram: bool = True) -> None:
    """Xabarni ilova ichiga yozadi va Telegram'ga yuboradi."""
    title, body = _split(text)
    async with SessionLocal() as session:
        session.add(Notification(user_id=user.id, kind=kind, title=title, body=body, link=link))
        await session.commit()
    if telegram and user.telegram_id and telegram_allowed(user, kind):
        await send_message(user.telegram_id, text)
