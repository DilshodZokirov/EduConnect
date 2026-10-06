import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from app.config import settings
from sqlalchemy import text

from app.db import SCHEMA_PATCHES, Base, engine
from app.services import storage
from app.routers import admin, auth, billing, discounts, homework, learn, materials, me, mentor, parent, student

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.create_tables_on_startup:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            for statement in SCHEMA_PATCHES:
                await conn.execute(text(statement))
    await storage.ensure_bucket()
    yield
    await engine.dispose()


app = FastAPI(title="EduConnect API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, me.router, admin.router, mentor.router, student.router, parent.router, materials.router,
          learn.router, discounts.router, billing.router, homework.router):
    app.include_router(r, prefix="/api")


@app.get("/health", tags=["Tizim"])
async def health():
    return {"status": "ok"}


TEST_PAGE = Path(__file__).parent / "static" / "test.html"


@app.get("/test", include_in_schema=False)
async def test_web_app():
    """Oddiy sinov sahifasi (frontend tayyor bo'lmaganda ishlatilgan)."""
    return HTMLResponse(TEST_PAGE.read_text(encoding="utf-8"))
