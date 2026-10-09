"""EduConnect Telegram boti: /start da kutib olish xabari va Web App tugmasi."""
import asyncio
import hashlib
import html
import logging
import os
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    BotCommand, FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bot")

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ.get("WEBAPP_URL", "").strip()
BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8000")
WELCOME_IMAGE = Path(__file__).parent / "welcome.png"

# Botni ochmasdan oldin ko'rinadigan matn ("Bu bot nima qila oladi?")
DESCRIPTION = (
    "EduConnect — ta'lim sifatini oshirish va o'quvchining o'sishiga erishish uchun platforma.\n\n"
    "O'qituvchi, o'quvchi va ota-ona bir maqsad sari: bilim berish, rivojlanishni kuzatish "
    "va natijaga erishish.\n\n"
    "Boshlash uchun «Start» tugmasini bosing."
)
SHORT_DESCRIPTION = "O'quvchi o'sishi va ta'lim sifati uchun platforma: o'qituvchi, o'quvchi va ota-ona bir maqsad sari."

WELCOME = (
    "👋 Assalomu alaykum, <b>{name}</b>!\n\n"
    "<b>EduConnect</b> — ta'lim sifatini oshirish va o'quvchining o'sishiga erishish uchun yaratilgan platforma.\n\n"
    "📈 O'quvchi o'z rivojlanishini ko'radi va yangi natijalarga intiladi\n"
    "👨‍🏫 O'qituvchi bilim berishga ko'proq vaqt ajratadi\n"
    "👨‍👩‍👧 Ota-ona farzandining o'qishini doimiy kuzatib boradi\n\n"
    "O'qituvchi, o'quvchi va ota-ona — bir maqsad sari.\n\n"
    "Boshlash uchun <b>«Ochish»</b> tugmasini bosing 👇"
)

HELP = (
    "ℹ️ <b>Qanday foydalaniladi</b>\n\n"
    "1. «Ochish» tugmasini bosing.\n"
    "2. O'quvchi yoki ota-ona bo'lsangiz — o'qituvchingiz bergan guruh havolasini oching: "
    "ro'yxatdan o'tasiz va darhol guruhga qo'shilasiz.\n"
    "3. O'qituvchi yoki xodim bo'lsangiz — filialni tanlab ro'yxatdan o'ting, filial admini tasdiqlagach "
    "shu yerga xabar keladi.\n\n"
    "Ilovani istalgan vaqtda pastki chap burchakdagi «Ochish» tugmasi orqali ham ochishingiz mumkin."
)


def open_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="📱 Ochish", web_app=WebAppInfo(url=WEBAPP_URL)),
    ]])


dp = Dispatcher()


async def invite_info(token: str) -> dict | None:
    """Guruh havolasi ma'lumoti (backend'dan): markaz, filial, guruh, o'qituvchi, jadval."""
    import aiohttp  # aiogram bilan birga o'rnatilgan

    try:
        async with aiohttp.ClientSession() as http, http.get(f"{BACKEND_URL}/api/public/invite/{token}", timeout=10) as r:
            return await r.json() if r.status == 200 else None
    except Exception:  # noqa: BLE001
        return None


async def remember_invite(telegram_id: int, token: str) -> None:
    """Havolani backendda eslab qolamiz: foydalanuvchi ilovani pastdagi «Ochish» tugmasidan ochsa ham guruh topiladi."""
    import aiohttp  # aiogram bilan birga o'rnatilgan

    key = hashlib.sha256(BOT_TOKEN.encode()).hexdigest()
    try:
        async with aiohttp.ClientSession() as http, http.post(
            f"{BACKEND_URL}/api/bot/pending-invite", json={"telegram_id": telegram_id, "token": token},
            headers={"X-Bot-Key": key}, timeout=10,
        ) as r:
            if r.status != 204:
                log.warning("Havola eslab qolinmadi: %s", r.status)
    except Exception:  # noqa: BLE001
        log.exception("Havola eslab qolinmadi")


async def start_from_invite(message: Message, token: str) -> None:
    info = await invite_info(token)
    if not info:
        await message.answer("⚠️ Bu havola eskirgan yoki o'chirilgan. O'qituvchingizdan yangi havola so'rang.")
        return
    await remember_invite(message.from_user.id, token)
    lines = [f"🏫 <b>{html.escape(info['center_name'])}</b>"]
    if info.get("branch_name"):
        addr = f" ({html.escape(info['branch_address'])})" if info.get("branch_address") else ""
        lines.append(f"📍 Filial: {html.escape(info['branch_name'])}{addr}")
    lines.append(f"👥 Guruh: <b>{html.escape(info['group_name'])}</b>")
    if info.get("mentor_name"):
        lines.append(f"👨‍🏫 O'qituvchi: {html.escape(info['mentor_name'])}")
    if info.get("schedule"):
        lines.append(f"🕒 Jadval: {html.escape(info['schedule'])}")
    lines.append("\nMa'lumotlar to'g'ri bo'lsa, «✅ Guruhga qo'shilish» tugmasini bosing va <b>o'quvchi</b> yoki "
                 "<b>ota-ona</b> sifatida qo'shiling 👇\n\n<i>Pastdagi «Ochish» tugmasi ham shu guruhga olib kiradi.</i>")
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Guruhga qo'shilish", web_app=WebAppInfo(url=f"{WEBAPP_URL}?join={token}")),
    ]])
    await message.answer("\n".join(lines), reply_markup=kb)


@dp.message(CommandStart(deep_link=True))
async def start_deep(message: Message, command: CommandObject) -> None:
    """t.me/<bot>?start=g_<token> — guruh havolasi."""
    args = command.args or ""
    if args.startswith("g_"):
        await start_from_invite(message, args[2:])
    else:
        await start(message)


@dp.message(CommandStart())
async def start(message: Message) -> None:
    name = html.escape(message.from_user.first_name or "do'stim")
    text = WELCOME.format(name=name)
    if WELCOME_IMAGE.exists():
        await message.answer_photo(FSInputFile(WELCOME_IMAGE), caption=text, reply_markup=open_keyboard())
    else:
        await message.answer(text, reply_markup=open_keyboard())


@dp.message(Command("help"))
async def help_(message: Message) -> None:
    await message.answer(HELP, reply_markup=open_keyboard())


@dp.message()
async def fallback(message: Message) -> None:
    await message.answer("Ilovani ochish uchun pastdagi tugmani bosing 👇", reply_markup=open_keyboard())


async def setup(bot: Bot) -> None:
    """Bot profilini sozlaydi: buyruqlar, tavsif va pastki «Ochish» menyu tugmasi."""
    await bot.set_my_commands([
        BotCommand(command="start", description="Botni ishga tushirish"),
        BotCommand(command="help", description="Yordam"),
    ])
    await bot.set_my_description(DESCRIPTION)
    await bot.set_my_short_description(SHORT_DESCRIPTION)
    # Har safar ngrok manzili o'zgarganda BotFather'ga kirish shart emas — bot o'zi yangilaydi
    await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Ochish", web_app=WebAppInfo(url=WEBAPP_URL)))
    log.info("Web App manzili: %s", WEBAPP_URL)


async def main() -> None:
    if not WEBAPP_URL.startswith("https://"):
        raise SystemExit("WEBAPP_URL https:// bilan boshlanishi kerak, masalan https://xxxx.ngrok-free.app/app")
    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    await setup(bot)
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
