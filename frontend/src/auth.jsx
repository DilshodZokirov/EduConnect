import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, joinToken, loginCode, setToken, tg } from './api.js';

const AuthContext = createContext(null);

// phase: loading | no-telegram | register | password | ready | error
export function AuthProvider({ children }) {
  const [state, setState] = useState({ phase: 'loading', user: null, error: null });

  const applySession = useCallback((r) => {
    setToken(r.access_token);
    setState({ phase: 'ready', user: r.user, error: null });
  }, []);

  const login = useCallback(async (password) => {
    if (!tg?.initData) {
      // Telegram'dan tashqarida (masalan, Chrome'da darsni yozish uchun) — bir martalik kod bilan kirish
      const code = loginCode.take();
      if (code) {
        try {
          applySession(await api('/auth/code-login', { method: 'POST', auth: false, body: { code } }));
        } catch (e) {
          setState({ phase: 'error', user: null, error: e.message });
        }
        return;
      }
      setState({ phase: 'no-telegram', user: null, error: null });
      return;
    }
    // Bot guruh havolasini ko'rsatgan bo'lsa — ilova pastdagi «Ochish»dan ochilsa ham o'sha guruh qo'llanadi
    if (password === undefined && !joinToken.get()) {
      try {
        const p = await api('/auth/pending-invite', { method: 'POST', auth: false, body: { init_data: tg.initData } });
        if (p?.token) sessionStorage.setItem('join.token', p.token);
      } catch { /* muhim emas */ }
    }
    try {
      const r = await api('/auth/login', { method: 'POST', auth: false, body: { init_data: tg.initData, password } });
      applySession(r);
    } catch (e) {
      if (e.status === 404) setState({ phase: 'register', user: null, error: null });
      else if (e.status === 401 && e.detail === 'password_required') setState({ phase: 'password', user: null, error: null });
      else if ((e.status === 401 || e.status === 423) && password !== undefined) setState({ phase: 'password', user: null, error: e.message });
      else setState({ phase: 'error', user: null, error: e.message });
    }
  }, [applySession]);

  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
      // Telefonda ilova butun ekranni egallaydi (Telegram 8.0+)
      const isPhone = ['android', 'ios'].includes(tg.platform);
      if (isPhone && tg.isVersionAtLeast?.('8.0')) {
        try { tg.requestFullscreen(); } catch { /* qo'llab-quvvatlanmaydi */ }
        try { tg.disableVerticalSwipes(); } catch { /* eski Telegram */ }
      }
    }
    login();
  }, [login]);

  const register = useCallback(async (form) => {
    const r = await api('/auth/register', { method: 'POST', auth: false, body: { init_data: tg.initData, ...form } });
    applySession(r);
  }, [applySession]);

  const refreshUser = useCallback(async () => {
    const user = await api('/me');
    setState((s) => ({ ...s, user }));
    return user;
  }, []);

  /** Bir Telegram hisobidagi boshqa profilga o'tish (masalan, superadmin ↔ mentor). */
  const switchProfile = useCallback(async (profileId) => {
    const r = await api('/me/profiles/switch', { method: 'POST', body: { profile_id: profileId } });
    applySession(r);
    window.history.replaceState(null, '', '/app/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    return r.user;
  }, [applySession]);

  const value = { ...state, login, register, refreshUser, applySession, switchProfile };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
