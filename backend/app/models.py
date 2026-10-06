import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Role(str, enum.Enum):
    superadmin = "superadmin"
    admin = "admin"
    mentor = "mentor"
    student = "student"
    parent = "parent"


class UserStatus(str, enum.Enum):
    pending = "pending"      # ro'yxatdan o'tgan, admin rol bermagan
    active = "active"
    blocked = "blocked"


class AttendanceStatus(str, enum.Enum):
    present = "present"      # keldi
    absent = "absent"        # kelmadi
    late = "late"            # kechikdi


class LinkStatus(str, enum.Enum):
    pending = "pending"      # ota-ona tasdiqlashi kutilmoqda
    confirmed = "confirmed"
    rejected = "rejected"


class OtpPurpose(str, enum.Enum):
    phone_new = "phone_new"
    phone_old = "phone_old"
    password_reset = "password_reset"


class PhoneChangeStatus(str, enum.Enum):
    awaiting_new = "awaiting_new"      # yangi raqamga kod yuborildi
    awaiting_old = "awaiting_old"      # eski raqamdan rozilik kutilmoqda
    awaiting_admin = "awaiting_admin"  # eski raqam yo'q, admin tasdiqlaydi
    done = "done"
    rejected = "rejected"
    cancelled = "cancelled"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(64))
    last_name: Mapped[str] = mapped_column(String(64))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    role: Mapped[Role | None] = mapped_column(Enum(Role, name="user_role"), nullable=True)
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status"), default=UserStatus.pending
    )

    password_hash: Mapped[str | None] = mapped_column(String(100), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Oshirilsa, barcha eski tokenlar bekor bo'ladi ("barcha qurilmalardan chiqish")
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    # Ustoz belgilaydi: o'quvchi o'zi o'ziga vasiy — to'lov xabarlari ota-onaga emas, o'ziga boradi
    self_guardian: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    @property
    def has_password(self) -> bool:
        return self.password_hash is not None


class Group(TimestampMixin, Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    mentor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    schedule: Mapped[str | None] = mapped_column(String(200))
    price: Mapped[int | None] = mapped_column(Integer)  # oylik narx, so'mda
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    mentor: Mapped[User | None] = relationship(lazy="joined")


class GroupStudent(Base):
    __tablename__ = "group_students"

    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ParentLink(TimestampMixin, Base):
    """Ota-ona <-> farzand: ko'pga-ko'p. Bitta ota-onaning bir nechta farzandi bo'lishi mumkin."""
    __tablename__ = "parent_links"
    __table_args__ = (UniqueConstraint("parent_id", "student_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[LinkStatus] = mapped_column(Enum(LinkStatus, name="link_status"), default=LinkStatus.pending)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Lesson(TimestampMixin, Base):
    __tablename__ = "lessons"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    lesson_date: Mapped[date] = mapped_column(Date)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    materials: Mapped[list["LessonMaterial"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="LessonMaterial.id"
    )


class MaterialKind:
    file = "file"          # hujjat/rasm — bizning omborda
    link = "link"          # tashqi havola
    video = "video"        # yuklangan dars videosi — omborda, siqilgan holda
    telegram = "telegram"  # eski: faqat Telegram'da saqlangan fayl


class MaterialStatus:
    uploading = "uploading"    # video omborga yuklanmoqda
    processing = "processing"  # navbatda, siqilishini kutmoqda
    encoding = "encoding"      # hozir siqilmoqda
    ready = "ready"
    failed = "failed"


class LessonMaterial(Base):
    __tablename__ = "lesson_materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default=MaterialKind.file, server_default=MaterialKind.file)
    status: Mapped[str] = mapped_column(String(20), default=MaterialStatus.ready, server_default=MaterialStatus.ready)
    url: Mapped[str | None] = mapped_column(String(500))
    storage_key: Mapped[str | None] = mapped_column(String(500))
    upload_id: Mapped[str | None] = mapped_column(String(300))
    content_type: Mapped[str | None] = mapped_column(String(150))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    # Telegram'ga bir marta yuborilgan fayl nusxasi (keyingi yuborishlar tez bo'lishi uchun)
    telegram_file_id: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VideoView(Base):
    """O'quvchi videoni qancha ko'rgani (faqat o'quvchilar hisoblanadi)."""
    __tablename__ = "video_views"

    material_id: Mapped[int] = mapped_column(ForeignKey("lesson_materials.id", ondelete="CASCADE"), primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    max_position: Mapped[int] = mapped_column(Integer, default=0)
    percent: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("lesson_id", "student_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[AttendanceStatus] = mapped_column(Enum(AttendanceStatus, name="attendance_status"))
    marked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    marked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    parents_notified: Mapped[bool] = mapped_column(Boolean, default=False)


class Otp(TimestampMixin, Base):
    __tablename__ = "otps"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    phone: Mapped[str] = mapped_column(String(20))
    purpose: Mapped[OtpPurpose] = mapped_column(Enum(OtpPurpose, name="otp_purpose"))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class PhoneChangeRequest(TimestampMixin, Base):
    __tablename__ = "phone_change_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    old_phone: Mapped[str] = mapped_column(String(20))
    new_phone: Mapped[str] = mapped_column(String(20))
    status: Mapped[PhoneChangeStatus] = mapped_column(
        Enum(PhoneChangeStatus, name="phone_change_status"), default=PhoneChangeStatus.awaiting_new
    )
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class SmsLog(TimestampMixin, Base):
    """Har bir SMS yoziladi — xarajatni nazorat qilish uchun."""
    __tablename__ = "sms_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(Text)


class Invoice(TimestampMixin, Base):
    """O'quvchining bitta guruh uchun bir oylik to'lovi."""
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("student_id", "group_id", "period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    period: Mapped[date] = mapped_column(Date, index=True)  # oyning 1-sanasi
    base_amount: Mapped[int | None] = mapped_column(Integer)  # chegirmalargacha bo'lgan summa
    amount: Mapped[int] = mapped_column(Integer)              # to'lanishi kerak (chegirmalar ayirilgan)
    paid_amount: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date] = mapped_column(Date)
    lessons_count: Mapped[int | None] = mapped_column(Integer)   # oy o'rtasida kelganda: hisoblangan darslar
    lessons_total: Mapped[int | None] = mapped_column(Integer)   # shu oydagi jami darslar
    note: Mapped[str | None] = mapped_column(String(300))
    reminder_stage: Mapped[int] = mapped_column(Integer, default=0)  # 1: yumshoq, 2: jiddiy, 3: qulflandi

    discounts: Mapped[list["InvoiceDiscount"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", order_by="InvoiceDiscount.id",
    )


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String(20))  # cash | card | transfer (keyin: click, payme)
    note: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Discount(TimestampMixin, Base):
    """Chegirma — tayyor chegirmalar yo'q, hammasini o'quv markaz admini o'zi yaratadi."""
    __tablename__ = "discounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(300))   # nima haqida
    conditions: Mapped[str | None] = mapped_column(String(500))    # kimlarga, qanday shartlar asosida beriladi
    kind: Mapped[str] = mapped_column(String(10))       # percent | fixed
    value: Mapped[int] = mapped_column(Integer)         # foiz (1–100) yoki so'm
    months: Mapped[int | None] = mapped_column(Integer)  # necha oy amal qiladi; None — muddatsiz
    all_groups: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # arxivlangan turni yangi o'quvchiga berib bo'lmaydi
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    groups: Mapped[list[Group]] = relationship(secondary="discount_groups", lazy="selectin")


class DiscountGroup(Base):
    __tablename__ = "discount_groups"

    discount_id: Mapped[int] = mapped_column(ForeignKey("discounts.id", ondelete="CASCADE"), primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)


class StudentDiscount(TimestampMixin, Base):
    """O'quvchiga berilgan chegirma: qaysi oydan qaysi oygacha."""
    __tablename__ = "student_discounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    discount_id: Mapped[int] = mapped_column(ForeignKey("discounts.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    start_period: Mapped[date] = mapped_column(Date)
    end_period: Mapped[date | None] = mapped_column(Date)  # shu oy ham kiradi; None — muddatsiz
    note: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    discount: Mapped[Discount] = relationship(lazy="joined")


class InvoiceDiscount(Base):
    """Oylik to'lovga qo'llangan chegirma — o'sha paytdagi holatda saqlanadi."""
    __tablename__ = "invoice_discounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    student_discount_id: Mapped[int | None] = mapped_column(ForeignKey("student_discounts.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(10))
    value: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer)  # ayirilgan so'm


class Assignment(TimestampMixin, Base):
    """Uy vazifasi — darsga biriktiriladi."""
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    criteria: Mapped[str] = mapped_column(Text)   # baholash mezonlari — AI shu bo'yicha tekshiradi
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    file_key: Mapped[str | None] = mapped_column(String(500))
    file_name: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)    # muddatdan 1 kun oldin
    overdue_notified: Mapped[bool] = mapped_column(Boolean, default=False)  # muddat o'tgach ota-onaga


class SubmissionStatus:
    pending = "pending"    # AI navbatida
    checking = "checking"  # AI tekshirmoqda
    done = "done"          # AI ishonch bilan baholadi
    review = "review"      # AI ishonchsiz — mentor ko'rishi kerak
    failed = "failed"      # AI xatosi
    manual = "manual"      # AI o'chirilgan — mentor o'zi baholaydi


class Submission(TimestampMixin, Base):
    """O'quvchi javobi (har bir vazifa uchun bitta; qayta topshirilsa yangilanadi)."""
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    text: Mapped[str | None] = mapped_column(Text)
    is_code: Mapped[bool] = mapped_column(Boolean, default=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    late: Mapped[bool] = mapped_column(Boolean, default=False)
    attempt: Mapped[int] = mapped_column(Integer, default=1)

    ai_status: Mapped[str] = mapped_column(String(20), default=SubmissionStatus.pending)
    ai_score: Mapped[int | None] = mapped_column(Integer)
    ai_feedback: Mapped[str | None] = mapped_column(Text)
    ai_details: Mapped[str | None] = mapped_column(Text)  # mezonlar bo'yicha JSON
    ai_error: Mapped[str | None] = mapped_column(Text)

    final_score: Mapped[int | None] = mapped_column(Integer)  # yakuniy baho — faqat mentor qo'yadi
    mentor_comment: Mapped[str | None] = mapped_column(Text)
    graded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    files: Mapped[list["SubmissionFile"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", order_by="SubmissionFile.id",
    )


class SubmissionFile(Base):
    __tablename__ = "submission_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
