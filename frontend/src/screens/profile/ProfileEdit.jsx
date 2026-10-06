import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatPhone, initials } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useToast } from '../../hooks.jsx';
import { Avatar, BottomBar, Button, Content, Field, Header, useTelegramBack } from '../../components/ui.jsx';

export default function ProfileEdit() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const back = useCallback(() => navigate('/profile'), [navigate]);
  useTelegramBack(back);

  const [first, setFirst] = useState(user.first_name);
  const [last, setLast] = useState(user.last_name);
  const [busy, setBusy] = useState(false);
  const changed = first.trim() !== user.first_name || last.trim() !== user.last_name;

  async function save() {
    setBusy(true);
    try {
      await api('/me', { method: 'PATCH', body: { first_name: first.trim(), last_name: last.trim() } });
      await refreshUser();
      toast('Saqlandi');
      back();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <Header title="Profilni tahrirlash" onBack={back} />
      <Content className="content-roomy">
        <div className="intro center"><Avatar text={initials({ first_name: first, last_name: last })} size={80} /></div>
        <Field label="Ism" value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name"
          error={!first.trim() ? 'Ismni kiriting' : undefined} />
        <Field label="Familiya" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name"
          error={!last.trim() ? 'Familiyani kiriting' : undefined} />
        <div className="field">
          <span className="field-label">Telefon raqam</span>
          <div className="readonly-field">
            <span>{formatPhone(user.phone)}</span>
            <button type="button" className="link-btn" onClick={() => navigate('/profile/phone')}>O'zgartirish</button>
          </div>
          <span className="field-hint">Raqam faqat SMS tasdiq orqali almashtiriladi.</span>
        </div>
      </Content>
      <BottomBar>
        <Button onClick={save} loading={busy} disabled={!changed || !first.trim() || !last.trim()}>Saqlash</Button>
      </BottomBar>
    </>
  );
}
