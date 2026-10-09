"""Test baholash: variantli savollar darhol, qisqa javoblar — avval aniq moslik, keyin kerak bo'lsa AI."""
import random
import re
from datetime import datetime, timezone

from app.models import Test, TestAttempt


def now() -> datetime:
    return datetime.now(timezone.utc)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower().replace("‘", "'").replace("’", "'"))


def build_order(test: Test) -> dict:
    """Har bir o'quvchi uchun savollar va variantlar tartibini aralashtiradi."""
    questions = [q.id for q in test.questions]
    random.shuffle(questions)
    options = {}
    for q in test.questions:
        ids = [o["id"] for o in q.options]
        random.shuffle(ids)
        options[str(q.id)] = ids
    return {"questions": questions, "options": options}


def grade(test: Test, attempt: TestAttempt) -> list[dict]:
    """Baholaydi. Aniq tekshirib bo'lmagan qisqa javoblar ro'yxatini qaytaradi (AI uchun)."""
    results, pending = {}, []
    for q in test.questions:
        key = str(q.id)
        ans = attempt.answers.get(key)
        if q.kind in ("single", "multiple"):
            chosen = set(ans or []) if isinstance(ans, list) else set()
            ok = chosen == set(q.correct)
            results[key] = {"earned": q.points if ok else 0, "max": q.points, "correct": ok}
        else:
            text = ans if isinstance(ans, str) else ""
            if not text.strip():
                results[key] = {"earned": 0, "max": q.points, "correct": False}
            elif normalize(text) in {normalize(c) for c in q.correct}:
                results[key] = {"earned": q.points, "max": q.points, "correct": True}
            else:
                results[key] = {"earned": 0, "max": q.points, "correct": None}  # AI tekshiradi
                pending.append({"id": key, "question": q.text, "accepted": q.correct, "answer": text})
    attempt.results = results
    recalc_score(attempt)
    attempt.ai_pending = bool(pending)
    return pending


def recalc_score(attempt: TestAttempt) -> None:
    total = sum(r["max"] for r in attempt.results.values()) or 1
    earned = sum(r["earned"] for r in attempt.results.values())
    attempt.score = round(100 * earned / total)


def finish(test: Test, attempt: TestAttempt, reason: str) -> list[dict]:
    attempt.finished_at = now()
    attempt.finish_reason = reason
    return grade(test, attempt)
