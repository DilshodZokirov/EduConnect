"""SMS yuborish. Test uchun "console", ishlab chiqarishda "eskiz" (notify.eskiz.uz).

Eskiz da SMS matn shablonlari odatda oldindan moderatsiyadan o'tishi kerak —
quyidagi matnlarni Eskiz kabinetida ro'yxatdan o'tkazing va API ni ularning
hujjatlari bilan solishtirib tekshiring.
"""
import logging

import httpx

from app.config import settings
from app.db import SessionLocal
from app.models import SmsLog

log = logging.getLogger("sms")

ESKIZ_BASE = "https://notify.eskiz.uz/api"


class SmsError(Exception):
    pass


class EskizClient:
    def __init__(self) -> None:
        self._token: str | None = None
        self._http = httpx.AsyncClient(timeout=15)

    async def _login(self) -> str:
        resp = await self._http.post(
            f"{ESKIZ_BASE}/auth/login",
            data={"email": settings.eskiz_email, "password": settings.eskiz_password},
        )
        resp.raise_for_status()
        self._token = resp.json()["data"]["token"]
        return self._token

    async def send(self, phone: str, text: str) -> None:
        token = self._token or await self._login()
        data = {"mobile_phone": phone.lstrip("+"), "message": text, "from": settings.eskiz_from}
        resp = await self._http.post(
            f"{ESKIZ_BASE}/message/sms/send", data=data, headers={"Authorization": f"Bearer {token}"}
        )
        if resp.status_code == 401:  # token eskirgan — qayta kirish
            token = await self._login()
            resp = await self._http.post(
                f"{ESKIZ_BASE}/message/sms/send", data=data, headers={"Authorization": f"Bearer {token}"}
            )
        if resp.status_code >= 400:
            raise SmsError(f"Eskiz {resp.status_code}: {resp.text[:300]}")


_eskiz = EskizClient() if settings.sms_provider == "eskiz" else None


async def send_sms(phone: str, text: str) -> bool:
    """SMS yuboradi va natijani sms_log jadvaliga yozadi. Xato bo'lsa False qaytaradi."""
    ok, error = True, None
    try:
        if _eskiz is None:
            log.warning("[SMS -> %s] %s", phone, text)
        else:
            await _eskiz.send(phone, text)
    except Exception as exc:  # noqa: BLE001 — SMS xatosi asosiy jarayonni to'xtatmasligi kerak
        ok, error = False, str(exc)
        log.exception("SMS yuborilmadi: %s", phone)

    async with SessionLocal() as session:
        session.add(SmsLog(phone=phone, text=text, ok=ok, error=error))
        await session.commit()
    return ok
