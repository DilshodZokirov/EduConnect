import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken, tg } from './api.js';

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
      setState({ phase: 'no-telegram', user: null, error: null });
      return;
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
      try { tg.setHeaderColor('#ffffff'); tg.setBackgroundColor('#f4f5f7'); } catch { /* eski Telegram */ }
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

  const value = { ...state, login, register, refreshUser, applySession };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
