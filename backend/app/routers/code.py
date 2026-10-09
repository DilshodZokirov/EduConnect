"""Kodni ishga tushirish (Run) va mentorga AI yordamchi."""
from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import MentorUser, StudentUser, get_current_user
from app.models import Role, User, UserStatus
from app.schemas import DraftIn, DraftOut, RunIn, RunOut
from app.services import ai_assist, code_runner
from app.services.ai_grader import GraderError

router = APIRouter(tags=["Kod va AI"])


@router.post("/code/run", response_model=RunOut)
async def run_code(data: RunIn, user: User = Depends(get_current_user)):
    """Kodni izolyatsiyalangan muhitda ishga tushirish (o'quvchi va xodimlar)."""
    if user.status != UserStatus.active or user.role == Role.parent:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ruxsat yo'q")
    try:
        code_runner.check_rate(user.id)
        return RunOut(**await code_runner.run(data.language, data.code, data.stdin))
    except code_runner.RunError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("/code/languages")
async def languages(user: User = Depends(get_current_user)):
    return [{"key": k, "name": ai_assist.LANGUAGE_NAMES.get(k, k), "browser": k in code_runner.BROWSER_LANGUAGES}
            for k in ["python", "javascript", "cpp", "c", "csharp", "java", "go", "php", "html"]]


@router.post("/mentor/ai/draft", response_model=DraftOut)
async def ai_draft(data: DraftIn, user: User = MentorUser):
    """Qisqa tavsifdan topshiriq qoralamasi: matn, mezonlar, muddat, misollar yoki test savollari."""
    try:
        raw = await ai_assist.draft(data.kind, data.brief, data.expected, data.requirements, data.language,
                                    data.question_count)
    except GraderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    def as_int(v):
        try:
            return max(1, int(v))
        except (TypeError, ValueError):
            return None

    cases = [{"input": str(c.get("input", "")), "output": str(c.get("output", "")), "hidden": bool(c.get("hidden"))}
             for c in raw.get("test_cases") or [] if isinstance(c, dict)][:20]
    questions = []
    for q in raw.get("questions") or []:
        if not isinstance(q, dict) or q.get("kind") not in ("single", "multiple", "short"):
            continue
        questions.append({"kind": q["kind"], "text": str(q.get("text", "")),
                          "points": max(1, min(100, as_int(q.get("points")) or 1)),
                          "options": [{"id": str(o.get("id")), "text": str(o.get("text", ""))}
                                      for o in q.get("options") or [] if isinstance(o, dict)],
                          "correct": [str(c) for c in q.get("correct") or []]})
    return DraftOut(
        title=str(raw.get("title", ""))[:200], description=str(raw.get("description", "")),
        criteria=str(raw.get("criteria", "")), expected=raw.get("expected"),
        suggested_minutes=as_int(raw.get("suggested_minutes")), suggested_days=as_int(raw.get("suggested_days")),
        starter_code=raw.get("starter_code"), test_cases=cases, questions=questions[:30],
        tips=[str(t) for t in raw.get("tips") or []][:5],
    )
