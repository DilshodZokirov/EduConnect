import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastProvider } from './hooks.jsx';
import { BrandingProvider } from './branding.jsx';
import './styles.css';
import './theme.js'; // mavzu ilova chizilishidan oldin qo'llanadi

// Guruh havolasi: bot Web App'ni ?join=<token> bilan ochadi — tokenni saqlab, manzildan olib tashlaymiz
try {
  const params = new URLSearchParams(window.location.search);
  const join = params.get('join');
  if (join) sessionStorage.setItem('join.token', join);
  // To'g'ridan-to'g'ri havola: t.me/<bot>?startapp=g_<token> — ilova darhol ochiladi
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param || params.get('tgWebAppStartParam');
  if (startParam && startParam.startsWith('g_')) sessionStorage.setItem('join.token', startParam.slice(2));
  // Darsni yozish: bot tugmasi ?record=<guruh>.<dars>, brauzer havolasi qo'shimcha ?code=<bir martalik kod>
  const record = params.get('record');
  if (record && /^\d+\.\d+$/.test(record)) sessionStorage.setItem('record.target', record);
  const code = params.get('code');
  if (code) sessionStorage.setItem('login.code', code);
  if (join || record || code) {
    ['join', 'record', 'code'].forEach((k) => params.delete(k));
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }
} catch { /* */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/app">
      <ToastProvider>
        <BrandingProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrandingProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
