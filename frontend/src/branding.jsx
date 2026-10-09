import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const BrandingContext = createContext({ name: 'EduConnect', logoUrl: null, branches: [], reload: () => {} });

/** Markaz nomi, logotipi va filiallar ro'yxati (avtorizatsiyasiz yuklanadi). */
export function BrandingProvider({ children }) {
  const [info, setInfo] = useState({ name: 'EduConnect', logoUrl: null, branches: [] });

  const reload = useCallback(async () => {
    try {
      const r = await api('/public/info', { auth: false });
      setInfo({ name: r.name, logoUrl: r.logo_url, branches: r.branches });
      document.title = r.name;
    } catch { /* standart brend qoladi */ }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return <BrandingContext.Provider value={{ ...info, reload }}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);
