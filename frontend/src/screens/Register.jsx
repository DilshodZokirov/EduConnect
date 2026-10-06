import { useState } from 'react';
import { tg } from '../api.js';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';
import { BottomBar, Button, Content, Field, Screen } from '../components/ui.jsx';

export default function Register() {
  const { register } = useAuth();
  const tgUser = tg?.initDataUnsafe?.user ?? {};
  const [form, setForm] = useState({
    first_name: tgUser.first_name ?? '',
    last_name: tgUser.last_name ?? '',
    phone: '+998 ',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const next = {};
    if (!form.first_name.trim()) next.first_name = 'Ismingizni kiriting';
    if (!form.last_name.trim()) next.last_name = 'Familiyangizni kiriting';
    if (form.phone.replace(/\D/g, '').length !== 12) next.phone = 'Raqamni to\'liq kiriting: +998 90 123 45 67';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await register(form);
    } catch (err) {
      setErrors(err.message.toLowerCase().includes('telefon') ? { phone: err.message } : { form: err.message });
      setLoading(false);
    }
  }

  return (
    <Screen>
      <form className="screen-form" onSubmit={submit} noValidate>
        <Content className="content-roomy">
          <div className="intro">
            <Logo size={64} />
            <h1 className="title-xl">EduConnect</h1>
            <p className="muted">O'quv markazimizga xush kelibsiz! Davom etish uchun ro'yxatdan o'ting.</p>
          </div>
          <Field label="Ism" placeholder="Ismingiz" autoComplete="given-name"
            value={form.first_name} onChange={set('first_name')} error={errors.first_name} />
          <Field label="Familiya" placeholder="Familiyangiz" autoComplete="family-name"
            value={form.last_name} onChange={set('last_name')} error={errors.last_name} />
          <Field label="Telefon raqam" placeholder="+998 90 123 45 67" inputMode="tel" autoComplete="tel"
            value={form.phone} onChange={set('phone')} error={errors.phone} />
          <p className="muted small">Ro'yxatdan o'tganingizdan so'ng admin sizga rol beradi.</p>
          {errors.form && <p className="error-box">{errors.form}</p>}
        </Content>
        <BottomBar>
          <Button type="submit" loading={loading}>Ro'yxatdan o'tish</Button>
          <p className="muted small center">Muhim xabarlar telefon raqamingizga SMS orqali ham yuboriladi.</p>
        </BottomBar>
      </form>
    </Screen>
  );
}
