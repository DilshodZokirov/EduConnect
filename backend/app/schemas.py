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
    branch_id: int | None = None  # filiallar bo'lsa — majburiy (havolasiz ro'yxatdan o'tganda)
    invite_token: str | None = None  # guruh havolasi orqali kelganda
    join_as: str | None = Field(default=None, pattern=r"^(student|parent)$")
    requested_role: str | None = Field(default=None, pattern=r"^(mentor|admin)$")  # havolasiz: kim sifatida

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
    branch_id: int | None = None
    branch_name: str | None = None
    invite_token: str | None = None
    invite_active: bool = True
    awaiting_manager: bool = False
    requested_role: str | None = None
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
    branch_id: int | None = None  # admin uchun — o'z filiali avtomatik
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
    branch_id: int | None = None
    branch_name: str | None = None
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
    source: str = "upload"            # upload | recording
    expires_at: datetime | None = None  # ekrandan yozilgan video qachon o'chiriladi


class RecordingStartIn(BaseModel):
    content_type: str = Field(pattern=r"^video/(webm|mp4)(;.*)?$", max_length=100)
    name: str | None = Field(default=None, max_length=200)


class RecordingStartOut(BaseModel):
    material: "MaterialOut"
    part_size: int
    max_minutes: int


class UrlOut(BaseModel):
    url: str


class CodeLoginIn(BaseModel):
    code: str = Field(min_length=20, max_length=100)


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
    requested_by_parent: bool = False


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
    conditions: str | None = Field(default=None, max_length=500)  # izoh: qanday shartlar asosida (ixtiyoriy)
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


class AssignManyIn(BaseModel):
    student_ids: list[int] = Field(min_length=1, max_length=500)
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

class TestCaseIn(BaseModel):
    input: str = Field(default="", max_length=10000)
    output: str = Field(max_length=10000)
    hidden: bool = False  # yashirin misol: o'quvchi ko'rmaydi, faqat topshirganda tekshiriladi


class AssignmentIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(min_length=3, max_length=10000)
    criteria: str = Field(min_length=3, max_length=5000)
    due_at: datetime
    kind: str = Field(default="text", pattern=r"^(text|code)$")
    language: str | None = None
    starter_code: str | None = Field(default=None, max_length=20000)
    expected: str | None = Field(default=None, max_length=5000)
    test_cases: list[TestCaseIn] = Field(default=[], max_length=20)

    @model_validator(mode="after")
    def _code(self):
        if self.kind == "code" and not self.language:
            raise ValueError("Kod vazifasi uchun dasturlash tilini tanlang")
        return self


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
    kind: str = "text"
    language: str | None = None
    starter_code: str | None = None
    expected: str | None = None
    test_cases: list[dict] = []
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
    language: str | None = None
    test_results: list[dict] = []
    tests_passed: int | None = None
    tests_total: int | None = None
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
    language: str | None = None
    tests_passed: int | None = None
    tests_total: int | None = None
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
    kind: str = "text"
    language: str | None = None
    starter_code: str | None = None
    expected: str | None = None
    examples: list[dict] = []   # ochiq misollar (kirish -> natija)
    hidden_tests: int = 0
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


# ---------- Filiallar, menejerlar, markaz sozlamalari ----------

class BranchIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    address: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, max_length=40)
    is_active: bool = True

    @field_validator("city")
    @classmethod
    def _city(cls, v: str | None) -> str | None:
        from app.services.weather import CITIES  # noqa: PLC0415
        if v and v not in CITIES:
            raise ValueError("Shahar ro'yxatda yo'q")
        return v or None


class BranchOut(ORM):
    id: int
    name: str
    address: str | None
    city: str | None = None
    is_active: bool
    managers: list[UserShort] = []
    admins: list[UserShort] = []
    students: int = 0


class BranchShort(ORM):
    id: int
    name: str
    address: str | None


class ManagerBranchesIn(BaseModel):
    branch_ids: list[int]


class UserBranchIn(BaseModel):
    branch_id: int


class ManagerOut(BaseModel):
    user: UserShort
    phone: str
    branches: list[BranchShort]


class CenterSettingsIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class PublicInfoOut(BaseModel):
    name: str
    logo_url: str | None
    branches: list[BranchShort]


# ---------- Testlar ----------

class OptionIn(BaseModel):
    id: str = Field(min_length=1, max_length=5)
    text: str = Field(min_length=1, max_length=1000)


class QuestionIn(BaseModel):
    kind: str = Field(pattern=r"^(single|multiple|short)$")
    text: str = Field(min_length=1, max_length=4000)
    points: int = Field(ge=1, le=100)
    options: list[OptionIn] = []
    correct: list[str] = Field(min_length=1)  # variant id lari yoki qabul qilinadigan javoblar

    @model_validator(mode="after")
    def _check(self):
        if self.kind in ("single", "multiple"):
            ids = {o.id for o in self.options}
            if len(self.options) < 2:
                raise ValueError("Kamida 2 ta javob varianti kerak")
            if not set(self.correct) <= ids:
                raise ValueError("To'g'ri javob variantlar orasida bo'lishi kerak")
            if self.kind == "single" and len(self.correct) != 1:
                raise ValueError("Bitta to'g'ri javobli savolda aynan bitta to'g'ri javob bo'ladi")
        return self


class TestIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    lesson_id: int | None = None
    time_limit_min: int = Field(ge=1, le=300)
    opens_at: datetime
    closes_at: datetime
    show_answers: bool = True
    max_leaves: int = Field(default=3, ge=1, le=10)
    max_points: int = Field(default=100, ge=1, le=100)  # testning ball qiymati (haftalik jami ≤ 100)
    questions: list[QuestionIn] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _window(self):
        if self.closes_at <= self.opens_at:
            raise ValueError("Yopilish vaqti ochilish vaqtidan keyin bo'lishi kerak")
        return self


class QuestionOut(ORM):
    id: int
    position: int
    kind: str
    text: str
    points: int
    options: list[dict]
    correct: list[str]


class TestOut(ORM):
    id: int
    group_id: int
    lesson_id: int | None
    title: str
    description: str | None
    time_limit_min: int
    opens_at: datetime
    closes_at: datetime
    show_answers: bool
    max_leaves: int
    max_points: int = 100
    question_count: int = 0
    total: int = 0       # guruhdagi o'quvchilar
    finished: int = 0    # topshirganlar
    average: int | None = None


class AttemptSummary(BaseModel):
    id: int
    student: UserShort
    attempt_no: int
    started_at: datetime
    finished_at: datetime | None
    finish_reason: str | None
    leaves: int
    points: float | None = None  # olgan ball (natija% × testning ball qiymati)
    score: int | None
    ai_pending: bool
    retake_granted: bool = False


class QuestionStat(BaseModel):
    question_id: int
    position: int
    text: str
    correct_rate: int | None  # foiz


class TestDetailOut(BaseModel):
    test: TestOut
    questions: list[QuestionOut]
    attempts: list[AttemptSummary]
    missing: list[UserShort]
    stats: list[QuestionStat]


class StudentQuestionOut(BaseModel):
    id: int
    kind: str
    text: str
    points: int
    options: list[dict]  # o'quvchi uchun aralashtirilgan, to'g'ri javobsiz


class AttemptStartOut(BaseModel):
    attempt_id: int
    test_title: str
    deadline_at: datetime
    server_now: datetime
    max_leaves: int
    leaves: int
    questions: list[StudentQuestionOut]
    answers: dict


class AnswersIn(BaseModel):
    answers: dict[str, list[str] | str]


class LeaveOut(BaseModel):
    leaves: int
    max_leaves: int
    finished: bool


class ResultQuestion(BaseModel):
    id: int
    kind: str
    text: str
    points: int
    options: list[dict]
    your_answer: list[str] | str | None
    earned: float
    is_correct: bool | None
    correct: list[str] | None = None  # show_answers bo'lsa


class AttemptResultOut(BaseModel):
    attempt_id: int
    test_id: int
    test_title: str
    max_points: int = 100
    points: float | None = None
    score: int | None
    ai_pending: bool
    finish_reason: str | None
    leaves: int
    answers_visible: bool
    questions: list[ResultQuestion]


class StudentTestOut(BaseModel):
    id: int
    title: str
    group_name: str
    time_limit_min: int
    question_count: int
    opens_at: datetime
    closes_at: datetime
    status: str  # upcoming | open | in_progress | done | missed
    max_points: int = 100
    points: float | None = None
    score: int | None = None
    attempt_id: int | None = None
    can_start: bool = False


class ChildTestOut(BaseModel):
    id: int
    title: str
    group_name: str
    closes_at: datetime
    status: str  # waiting | done | missed
    max_points: int = 100
    points: float | None = None
    score: int | None = None
    leaves: int = 0


# ---------- Kod va AI yordamchi ----------

class RunIn(BaseModel):
    language: str = Field(max_length=20)
    code: str = Field(max_length=50000)
    stdin: str = Field(default="", max_length=10000)


class RunOut(BaseModel):
    stdout: str
    stderr: str
    exit_code: int | None
    timed_out: bool
    compile_error: str | None


class CheckIn(BaseModel):
    code: str = Field(max_length=50000)


class DraftIn(BaseModel):
    kind: str = Field(pattern=r"^(text|code|test)$")
    brief: str = Field(min_length=5, max_length=3000)        # topshiriq nima haqida
    expected: str | None = Field(default=None, max_length=3000)      # nima chiqishi kerak
    requirements: str | None = Field(default=None, max_length=3000)  # talablar
    language: str | None = None
    question_count: int = Field(default=10, ge=1, le=30)


class DraftOut(BaseModel):
    title: str
    description: str
    criteria: str = ""
    expected: str | None = None
    suggested_minutes: int | None = None   # taxminiy bajarish vaqti
    suggested_days: int | None = None      # tavsiya etilgan muddat (kun)
    starter_code: str | None = None
    test_cases: list[dict] = []
    questions: list[dict] = []
    tips: list[str] = []                   # mentorga maslahatlar


# ---------- Guruh havolalari ----------

class InviteInfoOut(BaseModel):
    center_name: str
    group_name: str
    branch_name: str | None
    branch_address: str | None
    mentor_name: str | None
    schedule: str | None
    active: bool


class InviteOut(InviteInfoOut):
    token: str
    url: str | None          # https://t.me/<bot>?start=g_<token>


class JoinIn(BaseModel):
    join_as: str = Field(pattern=r"^(student|parent)$")
    child_ids: list[int] = Field(default=[], max_length=10)


class JoinOut(BaseModel):
    joined_as: str
    group_name: str
    pending_children: int = 0  # o'qituvchi tasdiqlashi kerak bo'lgan farzandlar


class ClassmateOut(BaseModel):
    id: int
    label: str  # "Jasur K." — to'liq ism ko'rsatilmaydi


class MentorGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    schedule: str | None = Field(default=None, max_length=200)
    price: int | None = Field(default=None, ge=0, le=100_000_000)
    branch_id: int | None = None  # mentor istalgan filialda guruh ocha oladi (tanlanmasa — o'z filiali)


class MentorRoleIn(BaseModel):
    role: str = Field(pattern=r"^(student|parent)$")
    group_id: int | None = None  # ota-onani o'quvchiga aylantirganda — qaysi guruhga


class WeekBudgetOut(BaseModel):
    week_start: date
    week_end: date
    used: int    # shu haftadagi boshqa testlar ball qiymatlari yig'indisi
    left: int    # qolgan (100 - used)
    tests: list[dict] = []


# ---------- Reyting ----------

class RatingRow(BaseModel):
    student: UserShort
    rank: int
    points: float
    homework_points: float
    test_points: float
    prev_rank: int | None = None
    delta: int | None = None     # +2 — ikki o'ringa ko'tarildi
    medals: int = 0              # oylik 1–3-o'rinlar soni


class RatingOut(BaseModel):
    group_id: int
    group_name: str
    period: str                  # week | month
    period_start: date
    period_end: date
    max_points: float            # shu davrda olish mumkin bo'lgan eng ko'p ball
    homework_count: int
    pending: int                 # hali baholanmagan javoblar (ball keyin qo'shiladi)
    rows: list[RatingRow]
    last_month: str = ""                              # "sentabr"
    last_month_heroes: list["RatingHero"] = []        # o'tgan oy faxri (1-o'rin)


class RatingHero(BaseModel):
    student: UserShort
    points: float


InvoiceOut.model_rebuild()
RatingOut.model_rebuild()


# ---------- Bildirishnomalar ----------

class NotificationOut(ORM):
    id: int
    kind: str
    title: str
    body: str | None
    link: str | None
    read_at: datetime | None
    created_at: datetime


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread: int
    has_more: bool


class NotifyPrefsIn(BaseModel):
    prefs: dict[str, bool]


class WeatherOut(BaseModel):
    city: str
    temp: int
    text: str
    icon: str


# ---------- Profillar ----------

class ProfileOut(BaseModel):
    id: int
    role: Role | None
    status: UserStatus
    requested_role: str | None
    awaiting_manager: bool
    branch_name: str | None
    has_password: bool
    current: bool


class ProfileSwitchIn(BaseModel):
    profile_id: int
    password: str | None = None


class ProfileCreateIn(BaseModel):
    requested_role: str = Field(pattern=r"^(mentor|admin)$")
    branch_id: int | None = None


class JoinNewProfileIn(BaseModel):
    join_as: str = Field(pattern=r"^(student|parent)$")
    child_ids: list[int] = Field(default=[], max_length=10)
