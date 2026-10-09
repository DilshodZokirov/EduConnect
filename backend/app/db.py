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
    # Bir Telegram hisobida bir nechta profil: telegram_id va telefon endi takrorlanishi mumkin
    "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_telegram_id_key",
    "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key",
    "DROP INDEX IF EXISTS ix_users_telegram_id",
    "DROP INDEX IF EXISTS ix_users_phone",
    "CREATE INDEX IF NOT EXISTS ix_users_tg ON users (telegram_id)",
    "CREATE INDEX IF NOT EXISTS ix_users_phone_nu ON users (phone)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS requested_role VARCHAR(20)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_prefs JSON NOT NULL DEFAULT '{}'",
    "ALTER TABLE branches ADD COLUMN IF NOT EXISTS city VARCHAR(40)",
    "CREATE INDEX IF NOT EXISTS ix_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'upload'",
    "ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ",
    "ALTER TABLE tests ADD COLUMN IF NOT EXISTS max_points INTEGER NOT NULL DEFAULT 100",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_token VARCHAR(40) UNIQUE",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_active BOOLEAN NOT NULL DEFAULT TRUE",
    "UPDATE groups SET invite_token = substr(md5(random()::text || id::text), 1, 16) WHERE invite_token IS NULL",
    "ALTER TABLE parent_links ADD COLUMN IF NOT EXISTS requested_by_parent BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'text'",
    "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS language VARCHAR(20)",
    "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS starter_code TEXT",
    "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS expected TEXT",
    "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS test_cases JSON DEFAULT '[]'",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS language VARCHAR(20)",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS test_results JSON DEFAULT '[]'",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS tests_passed INTEGER",
    "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS tests_total INTEGER",
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'general_manager'",
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'regional_manager'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS awaiting_manager BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
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
