import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

import bcrypt
import jwt

from app.config import settings


class InitDataError(Exception):
    pass


def validate_init_data(init_data: str) -> dict:
    """Telegram Web App initData ni tekshiradi va foydalanuvchi ma'lumotini qaytaradi.

    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError as exc:
        raise InitDataError("initData formati noto'g'ri") from exc

    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise InitDataError("hash topilmadi")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", settings.bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        raise InitDataError("imzo noto'g'ri")

    auth_date = int(pairs.get("auth_date", "0"))
    if time.time() - auth_date > settings.init_data_max_age_seconds:
        raise InitDataError("initData muddati o'tgan")

    try:
        user = json.loads(pairs["user"])
    except (KeyError, json.JSONDecodeError) as exc:
        raise InitDataError("user maydoni yo'q") from exc
    return user


# ---------- Parol ----------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


# ---------- JWT ----------

def create_access_token(user_id: int, token_version: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "tv": token_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_ttl_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


# ---------- OTP ----------

def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), code.encode(), hashlib.sha256).hexdigest()


# ---------- Telefon ----------

PHONE_RE = re.compile(r"^998\d{9}$")


def normalize_phone(raw: str) -> str:
    """'+998 90 123-45-67' yoki '901234567' -> '+998901234567'."""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 9:
        digits = "998" + digits
    if not PHONE_RE.match(digits):
        raise ValueError("Telefon raqam formati noto'g'ri. Namuna: +998 90 123 45 67")
    return "+" + digits


def mask_phone(phone: str) -> str:
    """'+998901234567' -> '+998 90 *** ** 67'."""
    d = phone.lstrip("+")
    return f"+{d[:3]} {d[3:5]} *** ** {d[-2:]}"
