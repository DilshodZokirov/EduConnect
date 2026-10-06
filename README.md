# EduConnect

```
educonnect/
├── backend/            FastAPI + PostgreSQL (API) va video ishchisi (worker)
│   ├── app/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env            ← sozlamalar (bot tokeni va h.k.)
├── bot/                Telegram bot (/start, «Ochish» tugmasi)
├── frontend/           React + Vite (Telegram Web App)
│   ├── src/
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
└── docker-compose.yml  hammasini birga ishga tushiradi
```

## Ishga tushirish

```bash
cp backend/.env.example backend/.env    # va to'ldiring
docker compose up --build
```

| Manzil | Nima |
|---|---|
| http://localhost:8000/app | Web App (frontend) |
| http://localhost:8001/docs | API hujjatlari (Swagger) |
| http://localhost:9001 | Fayl ombori paneli — MinIO (educonnect / educonnect-secret) |

Telegram uchun: `ngrok http 8000`, keyin `backend/.env` dagi `WEBAPP_URL` ga ngrok manzilini yozing va
`docker compose up -d --force-recreate bot`. Bot «Ochish» tugmasini o'zi yangilaydi.

## Faqat bittasini qayta yig'ish

```bash
docker compose up --build frontend   # faqat frontend o'zgarganda
docker compose up --build backend    # faqat backend o'zgarganda
```

## Frontendni tez ishlab chiqish rejimi (ixtiyoriy, Node.js kerak)

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173/app/ — o'zgarishlar darhol ko'rinadi
```
Telegram'da sinash uchun: `ngrok http 5173` va BotFather'da `https://<ngrok-manzil>/app/`
