import { useEffect, useState } from 'react';
import { api, joinToken, tg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useBranding } from '../branding.jsx';
import Logo from '../components/Logo.jsx';
import InviteCard from '../components/InviteCard.jsx';
import { BottomBar, Button, Chip, Content, Field, Screen, Select } from '../components/ui.jsx';

export default function Register() {
  const { register } = useAuth();
  const { name: centerName, branches } = useBranding();
  const tgUser = tg?.initDataUnsafe?.user ?? {};
  const [form, setForm] = useState({
    first_name: tgUser.first_name ?? '',
    last_name: tgUser.last_name ?? '',
    phone: '+998 ',
    branch_id: '',
  });
  const [errors, setErrors] = useState({});
  const token = joinToken.get();
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [joinAs, setJoinAs] = useState(null);
  const [wants, setWants] = useState(null); // havolasiz: mentor | admin

  useEffect(() => {
    if (!token) return;
    api(`/public/invite/${token}`, { auth: false })
      .then(setInvite)
      .catch((e) => { setInviteError(e.message); joinToken.clear(); });
  }, [token]);
  const [loading, setLoading] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const next = {};
    if (!form.first_name.trim()) next.first_name = 'Ismingizni kiriting';
    if (!form.last_name.trim()) next.last_name = 'Familiyangizni kiriting';
    if (form.phone.replace(/\D/g, '').length !== 12) next.phone = 'Raqamni to\'liq kiriting: +998 90 123 45 67';
    if (invite && !joinAs) next.join_as = "O'quvchi yoki ota-ona ekaningizni tanlang";
    if (!invite && branches.length && !form.branch_id) next.branch_id = 'Filialni tanlang';
    if (!invite && !wants) next.wants = 'Kim sifatida ishlamoqchisiz — tanlang';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await register(invite
        ? { ...form, branch_id: null, invite_token: token, join_as: joinAs }
        : { ...form, branch_id: form.branch_id ? Number(form.branch_id) : null, requested_role: wants });
      if (invite && joinAs === 'student') joinToken.clear(); // o'quvchi darhol guruhga qo'shildi
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
            <h1 className="title-xl">{centerName}</h1>
            <p className="muted">O'quv markazimizga xush kelibsiz! Davom etish uchun ro'yxatdan o'ting.</p>
          </div>
          <Field label="Ism" placeholder="Ismingiz" autoComplete="given-name"
            value={form.first_name} onChange={set('first_name')} error={errors.first_name} />
          <Field label="Familiya" placeholder="Familiyangiz" autoComplete="family-name"
            value={form.last_name} onChange={set('last_name')} error={errors.last_name} />
          <Field label="Telefon raqam" placeholder="+998 90 123 45 67" inputMode="tel" autoComplete="tel"
            value={form.phone} onChange={set('phone')} error={errors.phone} />
          {invite && (
            <>
              <InviteCard info={invite} />
              <div className="field">
                <span className="field-label">Siz kimsiz?</span>
                <div className="chips">
                  <Chip active={joinAs === 'student'} onClick={() => setJoinAs('student')}>🎒 O'quvchiman</Chip>
                  <Chip active={joinAs === 'parent'} onClick={() => setJoinAs('parent')}>👨‍👩‍👧 Ota-onaman</Chip>
                </div>
                {errors.join_as && <span className="field-error">{errors.join_as}</span>}
                {joinAs === 'parent' && <span className="field-hint">Keyingi qadamda farzandingizni guruh ro'yxatidan tanlaysiz.</span>}
              </div>
            </>
          )}
          {inviteError && <p className="error-box">{inviteError}</p>}
          {!invite && branches.length > 0 && (
            <>
              <Select label="Filial" value={form.branch_id} onChange={set('branch_id')}>
                <option value="">Filialni tanlang</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.address ? ` — ${b.address}` : ''}</option>)}
              </Select>
              {errors.branch_id && <span className="field-error">{errors.branch_id}</span>}
            </>
          )}
          {!invite && !token && (
            <div className="field">
              <span className="field-label">Kim sifatida ishlamoqchisiz?</span>
              <div className="chips">
                <Chip active={wants === 'mentor'} onClick={() => setWants('mentor')}>👨‍🏫 Mentor (o'qituvchi)</Chip>
                <Chip active={wants === 'admin'} onClick={() => setWants('admin')}>🛡 Admin</Chip>
              </div>
              {errors.wants && <span className="field-error">{errors.wants}</span>}
              {wants === 'mentor' && <span className="field-hint">So'rovingizni filial admini tasdiqlaydi.</span>}
              {wants === 'admin' && <span className="field-hint">So'rovingizni filialning hududiy menejeri tasdiqlaydi.</span>}
            </div>
          )}
          {!invite && (
            <p className="muted small">
              O'quvchi yoki ota-ona bo'lsangiz, o'qituvchingiz bergan guruh havolasi orqali kiring.
            </p>
          )}
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
