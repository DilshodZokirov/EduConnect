const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

/** Bugungi sana YYYY-MM-DD (mahalliy vaqt bo'yicha). */
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-02" -> "2-oktabr, payshanba" */
export function formatDate(iso, withWeekday = true) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const base = `${d}-${MONTHS[m - 1]}`;
  return withWeekday ? `${base}, ${WEEKDAYS[date.getDay()]}` : base;
}

/** ISO vaqt -> "12-oktabr, 18:00" (mahalliy vaqt) */
export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.getDate()}-${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Muddatgacha qolgan vaqt: "2 kun qoldi", "5 soat qoldi", "muddati o'tgan" */
export function timeLeft(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "muddati o'tgan";
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return `${Math.floor(h / 24)} kun qoldi`;
  if (h >= 1) return `${h} soat qoldi`;
  return `${Math.max(1, Math.floor(ms / 60000))} daqiqa qoldi`;
}

/** <input type="datetime-local"> uchun qiymat (mahalliy vaqt) */
export function toLocalInput(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
