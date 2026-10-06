import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { confirmDialog, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { BottomBar, Button, Card, Content, Header, PasswordField, useTelegramBack } from '../../components/ui.jsx';

function Rule({ ok, children }) {
  return (
    <p className={`rule ${ok ? 'rule-ok' : ''}`}>
      {ok ? <Icon name="check" size={16} /> : <span className="rule-dot" />}{children}
    </p>
  );
}

export default function Password() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, applySession } = useAuth();
  const back = useCallback(() => navigate('/profile'), [navigate]);
  useTelegramBack(back);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const longEnough = next.length >= 8;
  const hasDigit = /\d/.test(next);
  const same = next.length > 0 && next === repeat;
  const ready = longEnough && hasDigit && same && (!user.has_password || current);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const r = await api('/me/password', {
        method: 'POST', body: { current_password: user.has_password ? current : null, new_password: next },
      });
      applySession(r); // parol o'zgarganda boshqa qurilmalar chiqariladi, bu qurilmaga yangi token
      toast(user.has_password ? 'Parol almashtirildi' : "Parol o'rnatildi");
      back();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) { setError('Parolni olib tashlash uchun joriy parolni kiriting'); return; }
    if (!(await confirmDialog("Parol olib tashlansinmi? Ilova ochilganda parol so'ralmaydi."))) return;
    setBusy(true);
    try {
      applySession(await api('/me/password', { method: 'DELETE', body: { current_password: current } }));
      toast('Parol olib tashlandi');
      back();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <Header title={user.has_password ? 'Parolni almashtirish' : "Parol o'rnatish"} onBack={back} />
      <Content className="content-roomy">
        <div className="info-box"><Icon name="shield" size={22} />
          <p>Parol qo'yilsa, ilova har safar ochilganda so'raladi. Telefoningiz boshqa odam qo'liga tushsa ham profilingiz himoyada qoladi.</p>
        </div>
        {user.has_password && (
          <PasswordField label="Joriy parol" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        )}
        <PasswordField label="Yangi parol" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <PasswordField label="Yangi parolni takrorlang" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
        <Card>
          <Rule ok={longEnough}>Kamida 8 ta belgi</Rule>
          <Rule ok={hasDigit}>Kamida 1 ta raqam</Rule>
          <Rule ok={same}>Ikkala parol bir xil</Rule>
        </Card>
        {error && <p className="error-box">{error}</p>}
        <p className="muted small">Parolni unutsangiz, telefon raqamingizga keladigan SMS kod orqali tiklaysiz.
          Parol o'zgargach, boshqa qurilmalardagi seanslar yopiladi.</p>
        {user.has_password && (
          <button type="button" className="link-btn link-danger" onClick={remove} disabled={busy}>Parolni olib tashlash</button>
        )}
      </Content>
      <BottomBar>
        <Button onClick={save} loading={busy} disabled={!ready}>Parolni saqlash</Button>
      </BottomBar>
    </>
  );
}
