export const tg = window.Telegram?.WebApp;

let token = null;
export const setToken = (t) => { token = t; };

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function errorText(data, status) {
  if (data && typeof data.detail === 'string') return data.detail;
  if (data && Array.isArray(data.detail)) {
    return data.detail.map((e) => e.msg.replace(/^Value error, /, '')).join('; ');
  }
  if (status >= 500) return "Serverda xatolik. Birozdan keyin urinib ko'ring.";
  return `Xatolik (${status})`;
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Internet aloqasini tekshiring", 0);
  }

  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { /* bo'sh javob */ }
  }
  if (res.status === 423 && data?.detail === 'payment_locked') {
    window.dispatchEvent(new Event('payment-locked')); // ilova qulf ekraniga o'tadi
  }
  if (!res.ok) throw new ApiError(errorText(data, res.status), res.status, data?.detail);
  return data;
}

/** Fayl yuklash (multipart/form-data). */
export async function apiUpload(path, formData) {
  const headers = { 'ngrok-skip-browser-warning': '1' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers, body: formData });
  } catch {
    throw new ApiError('Internet aloqasini tekshiring', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  if (res.status === 413) throw new ApiError('Fayl juda katta (50 MB gacha)', 413);
  if (!res.ok) throw new ApiError(errorText(data, res.status), res.status, data?.detail);
  return data;
}

export const ROLE_NAMES = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  mentor: 'Mentor',
  student: "O'quvchi",
  parent: 'Ota-ona',
};

export function maskPhone(phone = '') {
  const d = phone.replace(/\D/g, '');
  return d.length === 12 ? `+${d.slice(0, 3)} ${d.slice(3, 5)} *** ** ${d.slice(-2)}` : phone;
}

export function formatPhone(phone = '') {
  const d = phone.replace(/\D/g, '');
  if (d.length !== 12) return phone;
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
}

export const initials = (u) => `${u?.first_name?.[0] ?? ''}${u?.last_name?.[0] ?? ''}`.toUpperCase();

/** 890000 -> "890 000" */
export const money = (x) => (x ?? 0).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');

/** "890 000 so'm" kiritilgan matndan raqam */
export const parseMoney = (text) => Number(String(text).replace(/\D/g, '')) || 0;
