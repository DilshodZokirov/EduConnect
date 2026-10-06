import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatPhone } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Card, Content, Field, Header, Loading, useTelegramBack } from '../../components/ui.jsx';

const RESEND_SECONDS = 60;

function Stepper({ step }) {
  const item = (n, label) => {
    const done = step > n;
    const on = step === n;
    return (
      <div className="step">
        <span className={`step-num ${done || on ? 'on' : ''}`}>{done ? <Icon name="check" size={16} /> : n}</span>
        <span className={on ? 'step-label on' : 'step-label'}>{label}</span>
      </div>
    );
  };
  return (
    <div className="stepper">
      {item(1, 'Yangi raqam')}
      <span className={`step-line ${step > 1 ? 'on' : ''}`} />
      {item(2, 'Eski raqam roziligi')}
    </div>
  );
}

function CodeForm({ phone, onSubmit, onResend, busy, error, children }) {
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(RESEND_SECONDS);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  return (
    <Card>
      <p className="small"><Icon name="chat" size={16} /> Kod <b>{phone}</b> raqamiga yuborildi</p>
      <input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
        aria-label="SMS kod" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      {error && <p className="error-box">{error}</p>}
      <Button onClick={() => onSubmit(code)} loading={busy} disabled={code.length !== 6}>Tasdiqlash</Button>
      <button type="button" className="link-btn" disabled={wait > 0 || busy}
        onClick={async () => { if (await onResend()) { setWait(RESEND_SECONDS); setCode(''); } }}>
        {wait > 0 ? `Kodni qayta yuborish: 0:${String(wait).padStart(2, '0')}` : 'Kodni qayta yuborish'}
      </button>
      {children}
    </Card>
  );
}

export default function PhoneChange() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const back = useCallback(() => navigate('/profile'), [navigate]);
  useTelegramBack(back);

  const current = useApi('/me/phone'); // tugallanmagan jarayon bo'lsa — o'sha joydan davom etamiz
  const [req, setReq] = useState(null);
  const [newPhone, setNewPhone] = useState('+998 ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (current.data !== undefined) setReq(current.data); }, [current.data]);

  async function run(fn) {
    setBusy(true);
    setError('');
    try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  }

  const start = () => run(async () => setReq(await api('/me/phone/start', { method: 'POST', body: { new_phone: newPhone } })));
  const verifyNew = (code) => run(async () => setReq(await api('/me/phone/verify-new', { method: 'POST', body: { code } })));
  const verifyOld = (code) => run(async () => {
    await api('/me/phone/verify-old', { method: 'POST', body: { code } });
    await refreshUser();
    toast('Telefon raqam almashtirildi');
    back();
  });
  const resend = async () => (await run(async () => { await api('/me/phone/resend', { method: 'POST' }); return true; })) === true;
  const toAdmin = () => run(async () => setReq(await api('/me/phone/request-admin', { method: 'POST' })));
  const cancel = () => run(async () => { await api('/me/phone/cancel', { method: 'POST' }); setReq(null); setNewPhone('+998 '); });

  if (current.loading && !current.data) return <><Header title="Raqamni o'zgartirish" onBack={back} /><Loading /></>;

  const status = req?.status;
  const step = status === 'awaiting_old' || status === 'awaiting_admin' ? 2 : 1;

  return (
    <>
      <Header title="Raqamni o'zgartirish" onBack={back} />
      <Content className="content-roomy">
        <Stepper step={step} />
        <p className="muted small">Hozirgi raqam: <b>{formatPhone(user.phone)}</b></p>

        {!status && (
          <>
            <Field label="Yangi telefon raqam" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67"
              value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            {error && <p className="error-box">{error}</p>}
            <Button onClick={start} loading={busy} disabled={newPhone.replace(/\D/g, '').length !== 12}>Kod yuborish</Button>
          </>
        )}

        {status === 'awaiting_new' && (
          <CodeForm phone={formatPhone(req.new_phone)} onSubmit={verifyNew} onResend={resend} busy={busy} error={error} />
        )}

        {status === 'awaiting_old' && (
          <>
            <CodeForm phone={formatPhone(req.old_phone)} onSubmit={verifyOld} onResend={resend} busy={busy} error={error}>
              <p className="muted small">Bu raqam haqiqatan sizniki ekanini tasdiqlash uchun eski raqamingizga ham kod yuborildi.</p>
            </CodeForm>
            <Card>
              <h3 className="item-title">Eski raqam qo'lingizda yo'qmi?</h3>
              <p className="muted small">So'rov administratorga yuboriladi. U shaxsingizni tekshirib, raqamni o'zi almashtiradi.</p>
              <Button variant="outline" onClick={toAdmin} loading={busy}>Administrator orqali tasdiqlash</Button>
            </Card>
          </>
        )}

        {status === 'awaiting_admin' && (
          <Card className="card-warn">
            <h3 className="item-title">So'rov administratorga yuborildi</h3>
            <p className="small">Yangi raqam: <b>{formatPhone(req.new_phone)}</b>. Administrator tasdiqlagach, raqamingiz almashadi
              va Telegram'da xabar olasiz.</p>
          </Card>
        )}

        {status && (
          <button type="button" className="link-btn link-muted" onClick={cancel} disabled={busy}>Jarayonni bekor qilish</button>
        )}
        <p className="muted small">Raqam almashgach, ikkala raqamga ham xabar yuboriladi.</p>
      </Content>
    </>
  );
}
