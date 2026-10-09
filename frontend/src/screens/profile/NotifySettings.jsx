import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Card, Content, ErrorBox, Header, Loading, useTelegramBack } from '../../components/ui.jsx';

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}><span /></button>
  );
}

export default function NotifySettings() {
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBack(back);
  const prefs = useApi('/me/notify-prefs');
  const [saving, setSaving] = useState('');

  async function change(key, value) {
    const next = Object.fromEntries(prefs.data.optional.map((o) => [o.key, o.key === key ? value : o.enabled]));
    prefs.setData((d) => ({ ...d, optional: d.optional.map((o) => (o.key === key ? { ...o, enabled: value } : o)) }));
    setSaving(key);
    try {
      prefs.setData(await api('/me/notify-prefs', { method: 'PUT', body: { prefs: next } }));
    } catch (e) {
      toast(e.message, 'error');
      prefs.reload();
    } finally {
      setSaving('');
    }
  }

  return (
    <>
      <Header title="Xabar sozlamalari" onBack={back} />
      {prefs.loading && !prefs.data && <Loading />}
      {prefs.error && <Content><ErrorBox text={prefs.error} onRetry={prefs.reload} /></Content>}
      {prefs.data && (
        <Content>
          <p className="muted small">Telegram'ga qaysi xabarlar kelishini tanlang. O'chirilgan xabarlar ham ilovadagi 🔔 bo'limida saqlanib turadi.</p>
          <Card className="card-flush">
            {prefs.data.optional.map((o) => (
              <div key={o.key} className="list-row">
                <span className="grow"><b>{o.label}</b></span>
                <Toggle on={o.enabled} label={o.label} onChange={(v) => saving !== o.key && change(o.key, v)} />
              </div>
            ))}
          </Card>
          <h2 className="section-title">Har doim yuboriladi</h2>
          <Card className="card-flush">
            {prefs.data.mandatory.map((o) => (
              <div key={o.key} className="list-row">
                <span className="setting-icon"><Icon name="lock" size={18} /></span>
                <span className="grow"><b>{o.label}</b></span>
              </div>
            ))}
          </Card>
          <p className="muted small">Bu xabarlar muhim — farzandingiz darsga kelmagani yoki to'lov muddati haqida o'z vaqtida bilishingiz uchun o'chirilmaydi.</p>
        </Content>
      )}
    </>
  );
}
