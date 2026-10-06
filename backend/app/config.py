from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://edu:edu@localhost:5432/educonnect"

    bot_token: str
    jwt_secret: str
    jwt_ttl_minutes: int = 60 * 12
    init_data_max_age_seconds: int = 60 * 60 * 24

    superadmin_telegram_ids: list[int] = []
    cors_origins: list[str] = ["*"]

    sms_provider: str = "console"  # console | eskiz
    eskiz_email: str = ""
    eskiz_password: str = ""
    eskiz_from: str = "4546"

    otp_ttl_seconds: int = 300
    otp_resend_seconds: int = 60
    otp_max_attempts: int = 5

    login_max_attempts: int = 5
    login_lock_minutes: int = 15

    # Fayl ombori (S3). Sinovda RustFS, real ishda Cloudflare R2 / AWS S3 va h.k.
    s3_endpoint_url: str = "http://rustfs:9000"
    s3_access_key: str = "EDUCONNECT01"
    s3_secret_key: str = "educonnect-local-secret"
    s3_bucket: str = "educonnect"
    s3_region: str = "us-east-1"
    # Vaqtinchalik havolalardagi ombor manzili shu prefiksga almashtiriladi (nginx /storage/ ni RustFS ga uzatadi).
    # R2 / S3 da bo'sh qoldiring — havolalar to'g'ridan-to'g'ri omborga boradi.
    s3_public_base: str = "/storage"
    max_file_mb: int = 100
    max_video_mb: int = 2048

    # AI (uy vazifasini tekshirish). Kalit bo'lmasa — vazifalarni mentor o'zi baholaydi.
    anthropic_api_key: str = ""
    ai_model: str = "claude-haiku-4-5-20251001"  # tez va arzon; sifat yetmasa kuchliroq modelga almashtiring
    homework_max_images: int = 5
    homework_max_image_mb: int = 10

    # To'lovlar
    timezone: str = "Asia/Tashkent"
    payment_due_day: int = 10        # oxirgi muddat; undan keyin o'quvchi va ota-ona ilovasi qulflanadi
    late_join_due_days: int = 3      # muddatdan keyin qo'shilganlar necha kun ichida to'laydi
    support_phone: str = ""          # qulflangan ekranda ko'rsatiladigan administrator telefoni

    # MVP uchun: jadvallarni ishga tushganda yaratish. Keyinchalik Alembic ga o'tish tavsiya etiladi.
    create_tables_on_startup: bool = True


settings = Settings()
