"""Piston'ga dasturlash tillarini o'rnatish (bir marta): docker compose exec backend python -m app.install_runtimes"""
import asyncio

import httpx

from app.config import settings
from app.services.code_runner import LANGUAGES


def _key(v: str) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in v.replace("-", ".").split("."))


async def main() -> None:
    wanted = sorted({pkg for _, _, pkg in LANGUAGES.values()})
    async with httpx.AsyncClient(timeout=1800) as client:
        packages = (await client.get(f"{settings.piston_url}/api/v2/packages")).json()
        for name in wanted:
            options = [p for p in packages if p["language"] == name]
            if not options:
                print(f"⚠ {name}: Piston paketlari orasida topilmadi — o'tkazib yuborildi")
                continue
            latest = max(options, key=lambda p: _key(p["language_version"]))
            if latest.get("installed"):
                print(f"✓ {name} {latest['language_version']} allaqachon o'rnatilgan")
                continue
            print(f"… {name} {latest['language_version']} o'rnatilmoqda (bir necha daqiqa olishi mumkin)")
            resp = await client.post(f"{settings.piston_url}/api/v2/packages",
                                     json={"language": name, "version": latest["language_version"]})
            print(("✓ " if resp.status_code == 200 else "✗ ") + f"{name}: {resp.text[:200]}")


if __name__ == "__main__":
    asyncio.run(main())
