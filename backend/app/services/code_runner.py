"""O'quvchi kodini xavfsiz ishga tushirish — o'z serverimizdagi Piston (izolyatsiyalangan muhit, vaqt cheklovi, internet yo'q).

HTML/CSS bu yerga kelmaydi — ular brauzerda ko'rinish sifatida ochiladi.
"""
import time
from collections import defaultdict, deque

import httpx

from app.config import settings

# Bizdagi til kaliti -> (Piston tili, fayl nomi, o'rnatiladigan paket)
LANGUAGES = {
    "python": ("python", "main.py", "python"),
    "javascript": ("javascript", "main.js", "node"),
    "cpp": ("c++", "main.cpp", "gcc"),
    "c": ("c", "main.c", "gcc"),
    "csharp": ("csharp", "Main.cs", "mono"),
    "java": ("java", "Main.java", "java"),
    "go": ("go", "main.go", "go"),
    "php": ("php", "main.php", "php"),
}
BROWSER_LANGUAGES = {"html"}  # brauzerda preview
ALL_LANGUAGES = set(LANGUAGES) | BROWSER_LANGUAGES

_versions: dict[str, str] = {}
_runs: dict[int, deque] = defaultdict(deque)


class RunError(Exception):
    pass


def check_rate(user_id: int) -> None:
    """Bir foydalanuvchi daqiqasiga ko'pi bilan N marta ishga tushira oladi."""
    now = time.monotonic()
    q = _runs[user_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.code_runs_per_minute:
        raise RunError("Juda ko'p urinish. Bir daqiqadan keyin qayta urinib ko'ring")
    q.append(now)


async def _version(client: httpx.AsyncClient, language: str) -> str:
    if language not in _versions:
        resp = await client.get(f"{settings.piston_url}/api/v2/runtimes")
        resp.raise_for_status()
        for rt in resp.json():
            names = {rt["language"], *rt.get("aliases", [])}
            if language in names:
                _versions[language] = rt["version"]  # o'rnatilgan oxirgisi
        if language not in _versions:
            raise RunError(f"Serverda «{language}» tili o'rnatilmagan. Administrator runtime'larni o'rnatishi kerak")
    return _versions[language]


def normalize_output(text: str) -> str:
    return "\n".join(line.rstrip() for line in (text or "").strip().splitlines())


async def run(language: str, code: str, stdin: str = "") -> dict:
    """{stdout, stderr, exit_code, timed_out, compile_error}"""
    if language not in LANGUAGES:
        raise RunError("Bu til serverda ishga tushirilmaydi")
    if not settings.piston_url:
        raise RunError("Kodni ishga tushirish o'chirilgan")
    lang, filename, _ = LANGUAGES[language]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            version = await _version(client, lang)
            resp = await client.post(f"{settings.piston_url}/api/v2/execute", json={
                "language": lang, "version": version,
                "files": [{"name": filename, "content": code}],
                "stdin": stdin or "",
                "run_timeout": settings.code_run_timeout_ms,
                "compile_timeout": 10000,
                "run_memory_limit": 256 * 1024 * 1024,
            })
    except httpx.HTTPError as exc:
        raise RunError("Kod ishga tushiruvchi xizmat javob bermadi. Birozdan keyin urinib ko'ring") from exc
    if resp.status_code != 200:
        raise RunError(f"Ishga tushirib bo'lmadi: {resp.text[:200]}")
    data = resp.json()
    compile_ = data.get("compile") or {}
    run_ = data.get("run") or {}
    if compile_ and compile_.get("code") not in (0, None):
        return {"stdout": "", "stderr": "", "exit_code": compile_.get("code"), "timed_out": False,
                "compile_error": (compile_.get("output") or compile_.get("stderr") or "")[:5000]}
    return {
        "stdout": (run_.get("stdout") or "")[:10000],
        "stderr": (run_.get("stderr") or "")[:5000],
        "exit_code": run_.get("code"),
        "timed_out": run_.get("signal") == "SIGKILL",
        "compile_error": None,
    }


async def run_tests(language: str, code: str, cases: list[dict], include_hidden: bool) -> list[dict]:
    """Mentor bergan misollar bo'yicha sinash: chiqish kutilgan natija bilan solishtiriladi."""
    results = []
    for case in cases:
        if case.get("hidden") and not include_hidden:
            continue
        r = await run(language, code, case.get("input", ""))
        got = r["compile_error"] or r["stdout"]
        passed = not r["compile_error"] and not r["timed_out"] and normalize_output(r["stdout"]) == normalize_output(case.get("output", ""))
        results.append({
            "passed": passed, "hidden": bool(case.get("hidden")),
            "input": None if case.get("hidden") else case.get("input", ""),
            "expected": None if case.get("hidden") else case.get("output", ""),
            "got": None if case.get("hidden") else got[:2000],
            "error": "Vaqt tugadi" if r["timed_out"] else ("Kompilyatsiya xatosi" if r["compile_error"] else (r["stderr"][:500] or None)),
        })
    return results
