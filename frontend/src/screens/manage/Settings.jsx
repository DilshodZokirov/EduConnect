import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiUpload } from '../../api.js';
import { useBranding } from '../../branding.jsx';
import { confirmDialog, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import Logo from '../../components/Logo.jsx';
import { Button, Card, Content, Field, Header, useTelegramBack } from '../../components/ui.jsx';

/** Markaz sozlamalari (faqat superadmin): nomi va logotipi. */
export default function Settings() {
  const navigate = useNavigate();
  const toast = useToast();
  const branding = useBranding();
  const back = useCallback(() => navigate('/manage'), [navigate]);
  useTelegramBack(back);
  const [name, setName] = useState(branding.name);
  const [busy, setBusy] = useState('');
  const fileRef = useRef();

  async function run(kind, fn, ok) {
    setBusy(kind);
    try { await fn(); await branding.reload(); toast(ok); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  return (
    <>
      <Header title="Markaz sozlamalari" onBack={back} />
      <Content className="content-roomy">
        <Card className="profile-card">
          <Logo size={96} />
          <h2 className="title-md">{branding.name}</h2>
          <p className="muted small">Ilovada shunday ko'rinadi</p>
        </Card>

        <Card>
          <Field label="Markaz nomi" value={name} onChange={(e) => setName(e.target.value)} />
          <Button loading={busy === 'name'} disabled={name.trim().length < 2 || name.trim() === branding.name}
            onClick={() => run('name', () => api('/admin/settings', { method: 'PUT', body: { name: name.trim() } }), 'Nomi saqlandi')}>
            Nomni saqlash
          </Button>
        </Card>

        <Card>
          <h3 className="item-title">Logotip</h3>
          <p className="muted small">Kvadrat rasm tavsiya etiladi (PNG yoki JPG, 5 MB gacha).</p>
          <label className="file-pick">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files[0];
                if (!f) return;
                const form = new FormData();
                form.append('file', f);
                run('logo', () => apiUpload('/admin/settings/logo', form), 'Logotip yangilandi');
                fileRef.current.value = '';
              }} />
            <Icon name="upload" size={22} />
            <span>{busy === 'logo' ? 'Yuklanmoqda…' : 'Yangi logotip yuklash'}</span>
          </label>
          {branding.logoUrl && (
            <button type="button" className="link-btn link-danger"
              onClick={async () => {
                if (!(await confirmDialog("Logotip o'chirilsinmi? Standart belgi ko'rsatiladi."))) return;
                run('del', () => api('/admin/settings/logo', { method: 'DELETE' }), "Logotip o'chirildi");
              }}>
              Logotipni o'chirish
            </button>
          )}
        </Card>
        <p className="muted small">Bot ichidagi kutib olish rasmi alohida (bot/welcome.png) — uni ham markaz logotipi bilan almashtirish mumkin.</p>
      </Content>
    </>
  );
}
