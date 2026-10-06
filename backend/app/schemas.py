from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import AttendanceStatus, LinkStatus, PhoneChangeStatus, Role, UserStatus
from app.security import normalize_phone


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth ----------

class RegisterIn(BaseModel):
    init_data: str
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)
    phone: str

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("first_name", "last_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Bo'sh bo'lmasligi kerak")
        return v


class LoginIn(BaseModel):
    init_data: str
    password: str | None = None


class PasswordResetStartIn(BaseModel):
    init_data: str


class PasswordResetFinishIn(BaseModel):
    init_data: str
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=64)


class UserOut(ORM):
    id: int
    telegram_id: int
    first_name: str
    last_name: str
    phone: str
    role: Role | None
    status: UserStatus
    has_password: bool
    self_guardian: bool = False
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Profil ----------

class ProfileUpdateIn(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=64)
    last_name: str | None = Field(default=None, min_length=1, max_length=64)


class PasswordSetIn(BaseModel):
    current_password: str | None = None
    new_password: str = Field(min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def _strength(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("Parolda kamida 1 ta raqam bo'lishi kerak")
        return v


class PasswordRemoveIn(BaseModel):
    current_password: str


class PhoneChangeStartIn(BaseModel):
    new_phone: str

    @field_validator("new_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class CodeIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class PhoneChangeOut(ORM):
    id: int
    old_phone: str
    new_phone: str
    status: PhoneChangeStatus
    created_at: datetime


# ---------- Admin ----------

class RoleAssignIn(BaseModel):
    role: Role


class GroupCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    mentor_id: int | None = None
    schedule: str | None = Field(default=None, max_length=200)
    price: int | None = Field(default=None, ge=0, le=100_000_000)


class GroupUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    mentor_id: int | None = None
    schedule: str | None = Field(default=None, max_length=200)
    price: int | None = Field(default=None, ge=0, le=100_000_000)
    is_active: bool | None = None


class StudentIdsIn(BaseModel):
    student_ids: list[int] = Field(min_length=1)


class UserShort(ORM):
    id: int
    first_name: str
    last_name: str


class GroupOut(ORM):
    id: int
    name: str
    schedule: str | None
    price: int | None = None
    is_active: bool
    mentor: UserShort | None
    student_count: int = 0


# ---------- Mentor ----------

class LessonCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    lesson_date: date


class LessonUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    lesson_date: date | None = None


class LinkIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=500, pattern=r"^https?://")


class MaterialOut(ORM):
    id: int
    name: str
    kind: str
    status: str
    url: str | None  # faqat havolalar uchun
    content_type: str | None
    size_bytes: int | None
    duration_seconds: int | None
    error: str | None


class VideoStartIn(BaseModel):
    filename: str = Field(min_length=1, max_length=300)
    size: int = Field(gt=0)
    content_type: str | None = None
    name: str | None = Field(default=None, max_length=200)


class UploadPart(BaseModel):
    part_number: int
    url: str


class VideoStartOut(BaseModel):
    material: MaterialOut
    part_size: int
    parts: list[UploadPart]


class CompletedPart(BaseModel):
    part_number: int = Field(ge=1)
    etag: str


class VideoCompleteIn(BaseModel):
    parts: list[CompletedPart] = Field(min_length=1)


class MaterialUrlOut(BaseModel):
    url: str
    expires_in: int
    filename: str | None = None


class ProgressIn(BaseModel):
    position: float = Field(ge=0)
    duration: float = Field(gt=0)


class VideoViewOut(BaseModel):
    student: "UserShort"
    percent: int
    updated_at: datetime | None


class LessonOut(ORM):
    id: int
    group_id: int
    title: str
    description: str | None
    lesson_date: date
    materials: list[MaterialOut] = []


class AttendanceItemIn(BaseModel):
    student_id: int
    status: AttendanceStatus


class AttendanceIn(BaseModel):
    items: list[AttendanceItemIn] = Field(min_length=1)


class AttendanceOut(ORM):
    student_id: int
    status: AttendanceStatus
    parents_notified: bool


class StudentInGroupOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    confirmed_parents: int
    self_guardian: bool = False
    attendance_percent: int | None = None  # keldi + kechikdi / belgilangan darslar; yo'qlama bo'lmasa None


class ParentSearchOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    phone_masked: str
    children_count: int


class LinkParentIn(BaseModel):
    parent_id: int


class ParentLinkOut(BaseModel):
    id: int
    parent: UserShort
    student: UserShort
    status: LinkStatus
    created_at: datetime


# ---------- Ota-ona / o'quvchi ----------

class ChildOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    groups: list[str]


class AttendanceHistoryOut(BaseModel):
    lesson_id: int
    lesson_title: str
    lesson_date: date
    group_name: str
    status: AttendanceStatus


class VideoProgressOut(BaseModel):
    material_id: int
    percent: int


# ---------- To'lovlar ----------

class InvoiceOut(BaseModel):
    id: int
    student: UserShort
    group_id: int
    group_name: str
    period: date
    base_amount: int | None = None
    amount: int
    paid_amount: int
    due_date: date
    status: str          # unpaid | partial | paid
    overdue: bool
    lessons_count: int | None
    lessons_total: int | None
    note: str | None
    payer_missing: bool = False  # ota-ona bog'lanmagan va "o'zi vasiy" emas — eslatma hech kimga bormaydi
    discounts: list["InvoiceDiscountOut"] = []
    payments: list["PaymentOut"] = []


class PaymentIn(BaseModel):
    amount: int = Field(gt=0, le=100_000_000)
    method: str = Field(pattern=r"^(cash|card|transfer)$")
    note: str | None = Field(default=None, max_length=300)


class InvoiceUpdateIn(BaseModel):
    amount: int | None = Field(default=None, ge=0, le=100_000_000)
    due_date: date | None = None  # muhlat berish
    note: str = Field(min_length=2, max_length=300)  # o'zgartirish sababi majburiy


class PaymentOut(ORM):
    id: int
    amount: int
    method: str
    note: str | None
    created_at: datetime


class DebtOut(BaseModel):
    student_name: str
    group_name: str
    period: date
    left: int
    due_date: date


class LockOut(BaseModel):
    locked: bool
    show_amounts: bool = True  # farzandga (vasiy emas) summa ko'rsatilmaydi
    debts: list[DebtOut] = []
    support_phone: str | None = None


class SelfGuardianIn(BaseModel):
    value: bool


class PrepayIn(BaseModel):
    student_id: int
    group_id: int
    months: int = Field(ge=1, le=12)
    method: str = Field(pattern=r"^(cash|card|transfer)$")
    note: str | None = Field(default=None, max_length=300)


# ---------- Chegirmalar ----------

class InvoiceDiscountOut(ORM):
    name: str
    kind: str
    value: int
    amount: int


class GroupShort(ORM):
    id: int
    name: str


class DiscountIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    conditions: str = Field(min_length=3, max_length=500)  # kimlarga beriladi — admin majburiy yozadi
    kind: str = Field(pattern=r"^(percent|fixed)$")
    value: int = Field(gt=0, le=100_000_000)
    months: int | None = Field(default=None, ge=1, le=60)
    group_ids: list[int] = []  # bo'sh — barcha guruhlar

    @model_validator(mode="after")
    def _percent(self):
        if self.kind == "percent" and self.value > 100:
            raise ValueError("Foiz 100 dan oshmasligi kerak")
        return self


class DiscountUpdateIn(DiscountIn):
    is_active: bool = True


class DiscountOut(ORM):
    id: int
    name: str
    description: str | None
    conditions: str | None
    kind: str
    value: int
    months: int | None
    all_groups: bool
    is_active: bool
    groups: list[GroupShort]
    active_count: int = 0


class AssignDiscountIn(BaseModel):
    student_id: int
    start: str = Field(pattern=r"^(current|next)$")
    note: str | None = Field(default=None, max_length=300)


class StudentDiscountOut(BaseModel):
    id: int
    discount: DiscountOut
    student: UserShort
    start_period: date
    end_period: date | None
    note: str | None
    active: bool


# ---------- Uy vazifasi ----------

class AssignmentIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(min_length=3, max_length=10000)
    criteria: str = Field(min_length=3, max_length=5000)
    due_at: datetime


class AssignmentUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, min_length=3, max_length=10000)
    criteria: str | None = Field(default=None, min_length=3, max_length=5000)
    due_at: datetime | None = None


class AssignmentOut(ORM):
    id: int
    lesson_id: int
    group_id: int
    title: str
    description: str
    criteria: str
    due_at: datetime
    file_name: str | None
    created_at: datetime
    total: int = 0
    submitted: int = 0
    to_review: int = 0   # mentor ko'rishi kerak (AI ishonchsiz / xato / AI o'chiq)
    to_approve: int = 0  # AI baholagan, mentor hali tasdiqlamagan
    graded: int = 0


class SubmissionFileOut(ORM):
    id: int
    content_type: str
    size_bytes: int


class SubmissionOut(BaseModel):
    id: int
    student: UserShort
    text: str | None
    is_code: bool
    submitted_at: datetime
    late: bool
    attempt: int
    ai_status: str
    ai_score: int | None
    ai_feedback: str | None
    ai_criteria: list[dict] = []
    final_score: int | None
    mentor_comment: str | None
    graded_at: datetime | None
    files: list[SubmissionFileOut] = []


class AssignmentDetailOut(BaseModel):
    assignment: AssignmentOut
    submissions: list[SubmissionOut]
    missing: list[UserShort]  # hali topshirmaganlar


class GradeIn(BaseModel):
    score: int = Field(ge=0, le=100)
    comment: str | None = Field(default=None, max_length=4000)


class MySubmissionOut(BaseModel):
    text: str | None
    is_code: bool
    submitted_at: datetime
    late: bool
    attempt: int
    ai_status: str
    ai_feedback: str | None          # izoh darhol ko'rinadi
    ai_comments: list[dict] = []     # mezonlar bo'yicha izohlar (ballarsiz — baho mentor tasdiqlagach)
    final_score: int | None
    mentor_comment: str | None
    files: list[SubmissionFileOut] = []


class StudentAssignmentOut(BaseModel):
    id: int
    title: str
    description: str
    criteria: str
    due_at: datetime
    file_name: str | None
    group_name: str
    lesson_title: str
    status: str  # new | submitted | graded | overdue
    submission: MySubmissionOut | None = None


class ChildHomeworkOut(BaseModel):
    id: int
    title: str
    group_name: str
    due_at: datetime
    status: str  # waiting | submitted | graded | missing
    late: bool = False
    final_score: int | None = None
    mentor_comment: str | None = None


InvoiceOut.model_rebuild()
