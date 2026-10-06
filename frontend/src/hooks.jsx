import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, tg } from './api.js';

/** Ma'lumotni yuklaydi: { data, error, loading, reload, setData } */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  const load = useCallback(async () => {
    if (!path) { setState({ data: null, error: null, loading: false }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      setState({ data, error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e.message, loading: false });
    }
  }, [path]);

  useEffect(() => { load(); }, [load]);

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }));
  }, []);

  return { ...state, reload: load, setData };
}

// ---------- Qisqa xabarlar (toast) ----------

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const show = useCallback((text, tone = 'ok') => {
    setToast({ text, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3000);
    try { tg?.HapticFeedback?.notificationOccurred(tone === 'error' ? 'error' : 'success'); } catch { /* */ }
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <div className={`toast toast-${toast.tone}`} role="status">{toast.text}</div>}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Telegram'ning tasdiqlash oynasi ("Ha / Yo'q"). */
export function confirmDialog(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(message, (ok) => resolve(!!ok));
    else resolve(window.confirm(message));
  });
}

/** "5 daqiqa oldin" ko'rinishidagi vaqt. */
export function timeAgo(iso) {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'hozirgina';
  if (sec < 3600) return `${Math.floor(sec / 60)} daqiqa oldin`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} soat oldin`;
  const days = Math.floor(sec / 86400);
  return days === 1 ? 'kecha' : `${days} kun oldin`;
}

/** Qiymat o'zgarishini biroz kechiktiradi (qidiruv uchun). */
export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
