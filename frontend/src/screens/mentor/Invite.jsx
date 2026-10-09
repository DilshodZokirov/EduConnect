import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, tg } from '../../api.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import InviteCard from '../../components/InviteCard.jsx';
import { Button, Card, Content, ErrorBox, Header, Loading, useTelegramBack } from '../../components/ui.jsx';

/** Guruh havolasi: bitta havola butun guruh uchun. O'quvchi darhol qo'shiladi, ota-ona farzandini tanlaydi. */
export default function Invite() {
  const { gid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload, setData } = useApi(`/mentor/groups/${gid}/invite`);
  const [busy, setBusy] = useState('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.url);
      toast('Havola nusxalandi');
    } catch {
      toast("Nusxalab bo'lmadi — havolani qo'lda belgilab oling", 'error');
    }
  }

  function share() {
    const text = `«${data.group_name}» guruhiga qo'shilish uchun havola. O'quvchi yoki ota-ona sifatida kiring:`;
    const link = `https://t.me/share/url?url=${encodeURIComponent(data.url)}&text=${encodeURIComponent(text)}`;
    try { tg.openTelegramLink(link); } catch { window.open(link, '_blank'); }
  }

  async function run(kind, path, ok, confirmText) {
    if (confirmText && !(await confirmDialog(confirmText))) return;
    setBusy(kind);
    try { setData(await api(path, { method: 'POST' })); toast(ok); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  if (loading && !data) return <><Header title="Guruh havolasi" onBack={back} /><Loading /></>;
  if (error) return <><Header title="Guruh havolasi" onBack={back} /><Content><ErrorBox text={error} onRetry={reload} /></Content></>;

  return (
    <>
      <Header title="Guruh havolasi" onBack={back} />
      <Content>
        <p className="muted small">Bitta havola butun guruh uchun. Havolani bosgan odam shu kartochkani ko'radi va o'quvchi yoki ota-ona sifatida qo'shiladi.</p>
        <InviteCard info={data} />

        <Card>
          {data.url ? <p className="link-box">{data.url}</p> : <p className="error-box">Bot nomini aniqlab bo'lmadi — BOT_TOKEN ni tekshiring.</p>}
          {!data.active && <p className="error-box">Havola o'chirilgan — hozir hech kim qo'shila olmaydi.</p>}
          <div className="row">
            <Button variant="outline" onClick={copy} disabled={!data.url}>Nusxalash</Button>
            <Button onClick={share} disabled={!data.url || !data.active}>Ulashish</Button>
          </div>
        </Card>

        <Card className="card-flush">
          <button type="button" className="setting-row" onClick={() => navigate(`/g/${gid}/settings`)}>
            <span className="setting-icon"><Icon name="edit" size={20} /></span>
            <span className="setting-text"><b>Guruh sozlamalari</b><span className="muted small">Nomi, jadvali, narxi</span></span>
            <Icon name="right" size={18} />
          </button>
          <button type="button" className="setting-row" disabled={!!busy}
            onClick={() => run('toggle', `/mentor/groups/${gid}/invite/active?active=${!data.active}`,
              data.active ? "Havola o'chirildi" : 'Havola yoqildi')}>
            <span className="setting-icon"><Icon name="lock" size={20} /></span>
            <span className="setting-text"><b>{data.active ? "Havolani vaqtincha o'chirish" : 'Havolani yoqish'}</b>
              <span className="muted small">Guruh to'lganda yoki qabul yopilganda</span></span>
          </button>
          <button type="button" className="setting-row setting-danger" disabled={!!busy}
            onClick={() => run('reset', `/mentor/groups/${gid}/invite/reset`, 'Yangi havola yaratildi — eskisi ishlamaydi',
              "Yangi havola yaratilsinmi? Eski havola darhol ishlamay qoladi (begona joyga tarqalgan bo'lsa).")}>
            <span className="setting-icon"><Icon name="refresh" size={20} /></span>
            <span className="setting-text"><b>Yangi havola yaratish</b><span className="muted small">Eskisi bekor qilinadi</span></span>
          </button>
        </Card>
      </Content>
    </>
  );
}
