import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';
import { tg } from '../api.js';

export function Screen({ children }) {
  return <div className="screen">{children}</div>;
}

export function Header({ title, onBack, right }) {
  return (
    <header className="header">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Orqaga"><Icon name="back" /></button>
      ) : <span className="header-gap" />}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Content({ children, className = '' }) {
  return <main className={`content ${className}`}>{children}</main>;
}

export function BottomBar({ children }) {
  return <div className="bottom-bar">{children}</div>;
}

export function Button({ children, variant = 'primary', loading, disabled, ...rest }) {
  return (
    <button className={`btn btn-${variant}`} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-label="Yuklanmoqda" /> : children}
    </button>
  );
}

export function Field({ label, hint, error, ...rest }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input className={error ? 'has-error' : ''} {...rest} />
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function PasswordField({ label, error, ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <span className="input-wrap">
        <span className="input-icon"><Icon name="lock" size={20} /></span>
        <input type={shown ? 'text' : 'password'} className={`with-icon with-action ${error ? 'has-error' : ''}`} {...rest} />
        <button type="button" className="input-action" onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Parolni yashirish' : "Parolni ko'rsatish"}>
          <Icon name={shown ? 'eyeOff' : 'eye'} size={20} />
        </button>
      </span>
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Pill({ children, tone = 'blue' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Avatar({ text, size = 44 }) {
  return <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.34 }}>{text}</div>;
}

export function Card({ children, className = '', ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}

export function BottomNav({ items }) {
  return (
    <nav className="bottom-nav">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Icon name={it.icon} />
          <span>{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Splash() {
  return <div className="splash"><span className="spinner spinner-lg" aria-label="Yuklanmoqda" /></div>;
}

/** Telegram'ning tizim "Orqaga" tugmasini ko'rsatadi. */
export function useTelegramBack(onBack) {
  useEffect(() => {
    if (!tg?.BackButton || !onBack) return undefined;
    tg.BackButton.show();
    tg.BackButton.onClick(onBack);
    return () => {
      tg.BackButton.offClick(onBack);
      tg.BackButton.hide();
    };
  }, [onBack]);
}

// Kompyuterdagi Telegram ilovalari (telefonda ilova o'zi to'liq ekranda ochiladi)
const DESKTOP_PLATFORMS = ['tdesktop', 'macos', 'weba', 'webk', 'web', 'unigram'];

/** Kompyuterda ilovani to'liq ekranga kattalashtirish / kichiklashtirish tugmasi. */
export function FullscreenToggle() {
  const supported = !!tg && DESKTOP_PLATFORMS.includes(tg.platform) && !!tg.isVersionAtLeast?.('8.0');
  const [on, setOn] = useState(!!tg?.isFullscreen);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supported) return undefined;
    const changed = () => setOn(!!tg.isFullscreen);
    const fail = (e) => {
      if (e?.error === 'ALREADY_FULLSCREEN') setOn(true);
      else setFailed(true); // bu Telegram versiyasida ishlamaydi — tugmani yashiramiz
    };
    tg.onEvent('fullscreenChanged', changed);
    tg.onEvent('fullscreenFailed', fail);
    return () => {
      tg.offEvent('fullscreenChanged', changed);
      tg.offEvent('fullscreenFailed', fail);
    };
  }, [supported]);

  const visible = supported && !failed;
  useEffect(() => {
    document.body.classList.toggle('has-fs-toggle', visible);
  }, [visible]);

  if (!visible) return null;
  const label = on ? 'Kichiklashtirish' : 'Kattalashtirish';
  return (
    <button className="fs-toggle" title={label} aria-label={label}
      onClick={() => { try { on ? tg.exitFullscreen() : tg.requestFullscreen(); } catch { setFailed(true); } }}>
      <Icon name={on ? 'minimize' : 'maximize'} size={20} />
    </button>
  );
}

export function Chip({ children, active, ...rest }) {
  return <button type="button" className={`chip ${active ? 'chip-active' : ''}`} aria-pressed={!!active} {...rest}>{children}</button>;
}

export function IconButton({ icon, label, ...rest }) {
  return <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}><Icon name={icon} /></button>;
}

export function SearchField({ value, onChange, placeholder = 'Qidirish...' }) {
  return (
    <label className="field">
      <span className="input-wrap">
        <span className="input-icon"><Icon name="search" size={20} /></span>
        <input className="with-icon" type="search" value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

export function Select({ label, children, ...rest }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <span className="input-wrap">
        <select className="select" {...rest}>{children}</select>
        <span className="select-chevron"><Icon name="chev" size={20} /></span>
      </span>
    </label>
  );
}

export function CheckRow({ checked, onChange, title, sub }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`check-box ${checked ? 'on' : ''}`} aria-hidden="true">{checked && <Icon name="check" size={16} />}</span>
      <span className="check-text"><b>{title}</b>{sub && <span className="muted small">{sub}</span>}</span>
    </label>
  );
}

export function EmptyState({ icon = 'users', title, text, action }) {
  return (
    <div className="empty">
      <div className="status-circle"><Icon name={icon} size={36} /></div>
      <h2 className="title-md">{title}</h2>
      {text && <p className="muted narrow">{text}</p>}
      {action}
    </div>
  );
}

export function Loading() {
  return <div className="loading"><span className="spinner spinner-lg" aria-label="Yuklanmoqda" /></div>;
}

export function ErrorBox({ text, onRetry }) {
  return (
    <div className="error-box error-row">
      <span>{text}</span>
      {onRetry && <button type="button" className="link-btn" onClick={onRetry}>Qayta urinish</button>}
    </div>
  );
}

/** So'mda summa kiritish: yozilganda bo'shliq bilan ajratiladi (890 000). */
export function MoneyField({ label, value, onChange, hint, error }) {
  const shown = value ? value.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') : '';
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <span className="input-wrap">
        <input inputMode="numeric" value={shown} placeholder="0" className={`with-suffix ${error ? 'has-error' : ''}`}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />
        <span className="input-suffix">so'm</span>
      </span>
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
