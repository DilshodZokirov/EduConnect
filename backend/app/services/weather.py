"""Ob-havo (Open-Meteo — bepul, kalit kerak emas). Har bir shahar uchun 15 daqiqa keshlanadi."""
import logging
import time

import httpx

log = logging.getLogger("weather")

# O'zbekiston viloyat markazlari: kalit -> (nomi, kenglik, uzunlik)
CITIES = {
    "toshkent": ("Toshkent", 41.3111, 69.2797),
    "samarqand": ("Samarqand", 39.6542, 66.9597),
    "buxoro": ("Buxoro", 39.7681, 64.4556),
    "andijon": ("Andijon", 40.7821, 72.3442),
    "namangan": ("Namangan", 40.9983, 71.6726),
    "fargona": ("Farg'ona", 40.3864, 71.7864),
    "qoqon": ("Qo'qon", 40.5286, 70.9425),
    "qarshi": ("Qarshi", 38.8606, 65.7891),
    "termiz": ("Termiz", 37.2242, 67.2783),
    "jizzax": ("Jizzax", 40.1158, 67.8422),
    "guliston": ("Guliston", 40.4897, 68.7842),
    "navoiy": ("Navoiy", 40.0844, 65.3792),
    "urganch": ("Urganch", 41.5500, 60.6333),
    "xiva": ("Xiva", 41.3783, 60.3639),
    "nukus": ("Nukus", 42.4531, 59.6103),
    "nurafshon": ("Nurafshon", 41.0167, 69.3667),
}
DEFAULT_CITY = "toshkent"

# WMO ob-havo kodlari -> (tavsif, kunduzgi belgi, tungi belgi)
CODES = {
    0: ("Ochiq havo", "☀️", "🌙"), 1: ("Asosan ochiq", "🌤", "🌙"), 2: ("Qisman bulutli", "⛅", "☁️"),
    3: ("Bulutli", "☁️", "☁️"), 45: ("Tuman", "🌫", "🌫"), 48: ("Tuman", "🌫", "🌫"),
    51: ("Mayda yomg'ir", "🌦", "🌧"), 53: ("Mayda yomg'ir", "🌦", "🌧"), 55: ("Yomg'ir", "🌧", "🌧"),
    61: ("Yomg'ir", "🌧", "🌧"), 63: ("Yomg'ir", "🌧", "🌧"), 65: ("Kuchli yomg'ir", "🌧", "🌧"),
    66: ("Muzli yomg'ir", "🌧", "🌧"), 67: ("Muzli yomg'ir", "🌧", "🌧"),
    71: ("Qor", "🌨", "🌨"), 73: ("Qor", "🌨", "🌨"), 75: ("Kuchli qor", "❄️", "❄️"), 77: ("Qor", "🌨", "🌨"),
    80: ("Jala", "🌦", "🌧"), 81: ("Jala", "🌧", "🌧"), 82: ("Kuchli jala", "⛈", "⛈"),
    85: ("Qor", "🌨", "🌨"), 86: ("Kuchli qor", "❄️", "❄️"),
    95: ("Momaqaldiroq", "⛈", "⛈"), 96: ("Do'l", "⛈", "⛈"), 99: ("Do'l", "⛈", "⛈"),
}

_cache: dict[str, tuple[float, dict]] = {}
_TTL = 15 * 60


async def current(city_key: str | None) -> dict | None:
    key = city_key if city_key in CITIES else DEFAULT_CITY
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < _TTL:
        return cached[1]
    name, lat, lon = CITIES[key]
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get("https://api.open-meteo.com/v1/forecast", params={
                "latitude": lat, "longitude": lon, "current": "temperature_2m,weather_code,is_day",
                "timezone": "Asia/Tashkent",
            })
        r.raise_for_status()
        cur = r.json()["current"]
    except Exception:  # noqa: BLE001 — ob-havo bo'lmasa ilova baribir ishlaydi
        log.warning("Ob-havo olinmadi (%s)", key)
        return cached[1] if cached else None
    text, day_icon, night_icon = CODES.get(int(cur.get("weather_code", 0)), ("", "🌡", "🌡"))
    data = {
        "city": name,
        "temp": round(float(cur["temperature_2m"])),
        "text": text,
        "icon": day_icon if cur.get("is_day", 1) else night_icon,
    }
    _cache[key] = (time.monotonic(), data)
    return data
