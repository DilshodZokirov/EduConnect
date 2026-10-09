import { useState } from 'react';
import { api, ROLE_NAMES } from '../api.js';
import { useAuth } from '../auth.jsx';
import { confirmDialog, useApi, useToast } from '../hooks.jsx';
import Icon from './Icon.jsx';
import { Card, Pill } from './ui.jsx';

const ROLE_ICON = {
  superadmin: 'shield', general_manager: 'shield', regional_manager: 'shield', admin: 'shield',
  mentor: 'book', student: 'user', parent: 'users',
};

function label(p) {
  if (p.role) return ROLE_NAMES[p.role];
  return p.requested_role === 'admin' ? "Admin (so'rov)" : "Mentor (so'rov)";
}

/** Bitta Telegram hisobidagi profillar: ular orasida o'tish va yangi xodim profili so'rash. */
export default function ProfileSwitcher({ compact = false }) {
  const { switchProfile, applySession } = useAuth();
  const toast = useToast();
  const profiles = useApi('/me/profiles');
  const [busy, setBusy] = useState(null);
  const list = profiles.data ?? [];
  if (compact && list.length < 2) return null;

  async function go(p) {
    if (p.current) return;
    setBusy(p.id);
    try {
      await switchProfile(p.id);
      toast(`${label(p)} profiliga o'tdingiz`);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(null);
    }
  }

  async function add(kind) {
    const text = kind === 'mentor'
      ? "Mentor profili ochilsinmi? Siz alohida profil bilan dars bera olasiz."
      : "Admin bo'lish uchun so'rov yuborilsinmi? Uni filialning hududiy menejeri tasdiqlaydi.";
    if (!(await confirmDialog(text))) return;
    setBusy(kind);
    try {
      const r = await api('/me/profiles', { method: 'POST', body: { requested_role: kind } });
      applySession(r);
      window.history.replaceState(null, '', '/app/');
      window.dispatchEvent(new PopStateEvent('popstate'));
      toast(r.user.status === 'active' ? 'Yangi profil ochildi' : "So'rov yuborildi");
    } catch (e) {
      toast(e.message, 'error');
      setBusy(null);
    }
  }

  const hasMentor = list.some((p) => p.role === 'mentor' || (p.status === 'pending' && p.requested_role === 'mentor'));
  const hasAdmin = list.some((p) => ['admin', 'regional_manager', 'general_manager', 'superadmin'].includes(p.role)
    || (p.status === 'pending' && p.requested_role === 'admin'));

  return (
    <Card className="card-flush">
      <h3 className="card-title">Profillarim</h3>
      {list.map((p) => (
        <button key={p.id} type="button" className={`setting-row ${p.current ? 'profile-current' : ''}`} onClick={() => go(p)}
          disabled={busy !== null}>
          <span className="setting-icon"><Icon name={ROLE_ICON[p.role] ?? 'clock'} size={20} /></span>
          <span className="setting-text">
            <b>{label(p)}</b>
            <span className="muted small">{p.branch_name ?? 'Filialsiz'}{p.status === 'pending' ? ' · kutilmoqda' : ''}</span>
          </span>
          {p.current ? <Pill>Hozirgi</Pill> : busy === p.id ? <span className="spinner" /> : <Icon name="right" size={18} />}
        </button>
      ))}
      {!compact && (
        <>
          {!hasMentor && (
            <button type="button" className="setting-row" onClick={() => add('mentor')} disabled={busy !== null}>
              <span className="setting-icon"><Icon name="plus" size={20} /></span>
              <span className="setting-text"><b>Mentor profili qo'shish</b><span className="muted small">Shu Telegram bilan dars berish uchun</span></span>
            </button>
          )}
          {!hasAdmin && (
            <button type="button" className="setting-row" onClick={() => add('admin')} disabled={busy !== null}>
              <span className="setting-icon"><Icon name="plus" size={20} /></span>
              <span className="setting-text"><b>Admin bo'lish uchun so'rov</b><span className="muted small">Hududiy menejer tasdiqlaydi</span></span>
            </button>
          )}
          <p className="muted small card-note">O'quvchi yoki ota-ona profili uchun guruh havolasini oching — alohida profil ochiladi.</p>
        </>
      )}
    </Card>
  );
}
