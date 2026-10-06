from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


# create_all mavjud jadvallarga yangi ustun qo'shmaydi. Alembic'ga o'tguncha shu yerda qo'shamiz.
SCHEMA_PATCHES = [
    "ALTER TABLE discounts ADD COLUMN IF NOT EXISTS conditions VARCHAR(500)",
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS base_amount INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS self_guardian BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS price INTEGER",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'file'",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ready'",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS storage_key VARCHAR(500)",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS upload_id VARCHAR(300)",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS content_type VARCHAR(150)",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS size_bytes BIGINT",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS duration_seconds INTEGER",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS error TEXT",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()",
    "UPDATE lesson_materials SET kind = 'link' WHERE url IS NOT NULL AND kind = 'file'",
    "UPDATE lesson_materials SET kind = 'telegram' WHERE telegram_file_id IS NOT NULL AND storage_key IS NULL AND kind = 'file'",
]
