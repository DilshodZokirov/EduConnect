"""EduConnect Telegram boti: /start da kutib olish xabari va Web App tugmasi."""
import asyncio
import html
import logging
import os
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    BotCommand, FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bot")

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ.get("WEBAPP_URL", "").strip()
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
    "2. Birinchi marta kirsangiz, ism va telefon raqamingiz bilan ro'yxatdan o'ting.\n"
    "3. Admin sizga rol beradi: o'quvchi, mentor yoki ota-ona. Tasdiqlanganda shu yerga xabar keladi.\n\n"
    "Ilovani istalgan vaqtda pastki chap burchakdagi «Ochish» tugmasi orqali ham ochishingiz mumkin."
)


def open_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="📱 Ochish", web_app=WebAppInfo(url=WEBAPP_URL)),
    ]])


dp = Dispatcher()


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