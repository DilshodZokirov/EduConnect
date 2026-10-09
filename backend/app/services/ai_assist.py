"""Mentorga topshiriq tuzishda AI yordamchi: qisqa tavsifdan to'liq qoralama tayyorlaydi.
Qoralama faqat taklif — mentor tahrirlaydi va o'zi e'lon qiladi."""
import json
import re

import httpx

from app.config import settings
from app.services.ai_grader import API_URL, GraderError, enabled

LANGUAGE_NAMES = {
    "python": "Python 3", "javascript": "JavaScript (Node.js)", "cpp": "C++", "c": "C", "csharp": "C#",
    "java": "Java (Main klassi)", "go": "Go", "php": "PHP", "html": "HTML/CSS",
}

BASE = """Sen o'quv markazidagi tajribali metodistsan. Mentorning qisqa tavsifi asosida o'quvchilar uchun aniq, \
tushunarli topshiriq qoralamasini tayyorla. Hamma matn o'zbek tilida (lotin yozuvida). FAQAT JSON qaytar, boshqa hech narsa yozma."""

SCHEMAS = {
    "text": """{"title": "...", "description": "o'quvchi uchun to'liq topshiriq matni", \
"criteria": "baholash mezonlari: har biri yangi qatorda, ballari bilan, jami 100 ball", \
"expected": "kutilgan natija qisqacha", "suggested_minutes": <bajarish uchun taxminiy daqiqa>, \
"suggested_days": <tavsiya etilgan muddat, kun>, "tips": ["mentorga 1-3 ta qisqa maslahat"]}""",
    "code": """{"title": "...", "description": "masala sharti: nima berilishi (stdin), nima chiqarilishi kerak (stdout), cheklovlar", \
"criteria": "baholash mezonlari (jami 100 ball): to'g'rilik, kod sifati, talablarga rioya", \
"expected": "kutilgan natija qisqacha", "starter_code": "o'quvchiga boshlang'ich kod shabloni (yechimsiz!)", \
"test_cases": [{"input": "stdin", "output": "aniq kutilgan stdout", "hidden": false}], \
"suggested_minutes": <daqiqa>, "suggested_days": <kun>, "tips": ["..."]}
Kamida 4 ta misol tuz: 2 tasi ochiq (hidden=false), 2 tasi yashirin chegaraviy holatlar (hidden=true). \
Misollar natijasi aniq va bir ma'noli bo'lsin — dastur aynan shu matnni chiqarishi kerak.""",
    "test": """{"title": "...", "description": "o'quvchilar uchun qisqa ko'rsatma", "suggested_minutes": <test vaqti, daqiqa>, \
"suggested_days": <necha kun ochiq tursin>, "questions": [{"kind": "single|multiple|short", "text": "savol", "points": <1-10>, \
"options": [{"id": "a", "text": "..."}], "correct": ["a"]}], "tips": ["..."]}
single — bitta to'g'ri javob, multiple — bir nechta, short — qisqa javob (options bo'sh, correct — qabul qilinadigan javoblar). \
Variantlar 4 ta, aldamchi lekin aniq noto'g'ri bo'lsin.""",
}


async def draft(kind: str, brief: str, expected: str | None, requirements: str | None, language: str | None,
                question_count: int) -> dict:
    if not enabled():
        raise GraderError("AI ulanmagan (ANTHROPIC_API_KEY yo'q)")
    parts = [f"TOPSHIRIQ TURI: {'uy vazifasi' if kind == 'text' else 'kod yozish' if kind == 'code' else 'test'}",
             f"MENTOR TAVSIFI: {brief}"]
    if expected:
        parts.append(f"NIMA CHIQISHI KERAK: {expected}")
    if requirements:
        parts.append(f"TALABLAR: {requirements}")
    if kind == "code" and language:
        parts.append(f"DASTURLASH TILI: {LANGUAGE_NAMES.get(language, language)}")
    if kind == "test":
        parts.append(f"SAVOLLAR SONI: {question_count}")
    parts.append(f"JAVOB FORMATI:\n{SCHEMAS[kind]}")

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(API_URL, headers={
            "x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }, json={"model": settings.ai_model, "max_tokens": 6000, "system": BASE,
                 "messages": [{"role": "user", "content": "\n\n".join(parts)}]})
    if resp.status_code != 200:
        raise GraderError(f"AI xizmati {resp.status_code}: {resp.text[:300]}")
    text = "".join(b.get("text", "") for b in resp.json().get("content", []) if b.get("type") == "text")
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise GraderError("AI qoralamasini o'qib bo'lmadi, qayta urinib ko'ring")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise GraderError("AI qoralamasini o'qib bo'lmadi, qayta urinib ko'ring") from exc
    return data
