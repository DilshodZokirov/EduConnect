import { useCallback, useState } from 'react';
import { api, tg } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Logo from '../components/Logo.jsx';
import { Button, Content, Field, Header, PasswordField, Screen, useTelegramBack } from '../components/ui.jsx';

export default function PasswordLogin() {
  const [mode, setMode] = useState('login'); // login | reset
  return mode === 'login'
    ? <LoginForm onForgot={() => setMode('reset')} />
    : <ResetForm onDone={() => setMode('login')} />;
}

function LoginForm({ onForgot }) {
  const { login, error } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const name = tg?.initDataUnsafe?.user?.first_name;

  async function submit(e) {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    await login(password); // muvaffaqiyatli bo'lsa, ilova bosh sahifaga o'tadi
    setLoading(false);
    setPassword('');
  }

  return (
    <Screen>
      <form className="screen-form" onSubmit={submit}>
        <Content className="content-roomy">
          <div className="intro center intro-tall">
            <Logo size={72} />
            <h1 className="title-lg">{name ? `Xush kelibsiz, ${name}!` : 'Xush kelibsiz!'}</h1>
            <p className="muted">Davom etish uchun parolingizni kiriting.</p>
          </div>
          <PasswordField label="Parol" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" autoFocus error={error} />
          <Button type="submit" loading={loading} disabled={!password}>Kirish</Button>
          <button type="button" className="link-btn" onClick={onForgot}>Parolni unutdingizmi? SMS orqali tiklash</button>
          <div className="spacer" />
          <p className="muted small center row-center"><Icon name="lock" size={16} />5 marta noto'g'ri kiritilsa, kirish 15 daqiqaga bloklanadi.</p>
        </Content>
      </form>
    </Screen>
  );
}

function ResetForm({ onDone }) {
  const { applySession } = useAuth();
  const [step, setStep] = useState('start'); // start | code
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const back = useCallback(() => onDone(), [onDone]);
  useTelegramBack(back);

  async function sendCode() {
    setLoading(true);
    setError('');
    try {
      await api('/auth/password-reset/start', { method: 'POST', auth: false, body: { init_data: tg.initData } });
      setStep('code');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function finish(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await api('/auth/password-reset/finish', {
        method: 'POST', auth: false, body: { init_data: tg.initData, code, new_password: password },
      });
      applySession(r);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header title="Parolni tiklash" onBack={back} />
      {step === 'start' ? (
        <Content className="content-roomy">
          <div className="info-box"><Icon name="phone" size={22} />
            <p>Profilingizdagi telefon raqamga 6 xonali tasdiqlash kodi yuboriladi.</p></div>
          {error && <p className="error-box">{error}</p>}
          <Button onClick={sendCode} loading={loading}>Kod yuborish</Button>
        </Content>
      ) : (
        <form onSubmit={finish} className="screen-form">
          <Content className="content-roomy">
            <Field label="SMS kod" inputMode="numeric" maxLength={6} placeholder="000000" autoComplete="one-time-code"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <PasswordField label="Yangi parol" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" />
            <p className="muted small">Kamida 8 ta belgi va kamida 1 ta raqam.</p>
            {error && <p className="error-box">{error}</p>}
            <Button type="submit" loading={loading} disabled={code.length !== 6 || password.length < 8}>
              Parolni saqlash va kirish
            </Button>
            <button type="button" className="link-btn" onClick={sendCode} disabled={loading}>Kodni qayta yuborish</button>
          </Content>
        </form>
      )}
    </Screen>
  );
}
