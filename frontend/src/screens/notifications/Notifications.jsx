import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useToast } from '../../hooks.jsx';
import { refreshUnread, setUnread } from '../../notificationsStore.js';
import Icon from '../../components/Icon.jsx';
import { Button, Content, EmptyState, ErrorBox, Header, Loading, useTelegramBack } from '../../components/ui.jsx';

const KIND_ICON = {
  attendance: 'checksq', payment: 'wallet', homework: 'test', reminder: 'clock', test: 'test',
  video: 'video', rating: 'trophy', announce: 'bell', account: 'user',
};
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function dayLabel(d) {
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'Bugun';
  if (diff === 1) return 'Kecha';
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`;
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function Notifications() {
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBack(back);

  const [items, setItems] = useState([]);
  const [unread, setUnreadLocal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (beforeId) => {
    try {
      const r = await api(`/notifications${beforeId ? `?before_id=${beforeId}` : ''}`);
      setItems((prev) => (beforeId ? [...prev, ...r.items] : r.items));
      setUnreadLocal(r.unread);
      setUnread(r.unread);
      setHasMore(r.has_more);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function open(n) {
    if (!n.read_at) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnreadLocal((c) => Math.max(0, c - 1));
      setUnread(unread - 1);
      api(`/notifications/${n.id}/read`, { method: 'POST' }).then(refreshUnread).catch(() => {});
    }
    if (n.link) navigate(n.link);
  }

  async function readAll() {
    setBusy(true);
    try {
      await api('/notifications/read-all', { method: 'POST' });
      const now = new Date().toISOString();
      setItems((list) => list.map((x) => ({ ...x, read_at: x.read_at || now })));
      setUnreadLocal(0);
      setUnread(0);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <Header title="Bildirishnomalar" onBack={back}
      right={<button type="button" className="icon-btn" aria-label="Xabar sozlamalari" title="Xabar sozlamalari"
        onClick={() => navigate('/profile/notifications')}><Icon name="settings" size={20} /></button>} />
  );
  if (loading) return <>{header}<Loading /></>;

  let lastDay = '';
  return (
    <>
      {header}
      <Content>
        {error && <ErrorBox text={error} onRetry={() => load()} />}
        {items.length > 0 && (
          <div className="notif-head">
            <span className="muted small">{unread ? `${unread} ta o'qilmagan` : "Hammasi o'qilgan"}</span>
            <button type="button" className="link-btn" disabled={!unread || busy} onClick={readAll}>
              <Icon name="check" size={16} /> Barchasini o'qildi
            </button>
          </div>
        )}
        {!error && items.length === 0 && (
          <EmptyState icon="bell" title="Hozircha xabar yo'q" text="Yangi vazifa, baho, to'lov va boshqa muhim xabarlar shu yerda paydo bo'ladi." />
        )}
        {items.length > 0 && (
          <div className="notif-list">
            {items.map((n) => {
              const d = new Date(n.created_at);
              const label = dayLabel(d);
              const showDay = label !== lastDay;
              lastDay = label;
              return (
                <div key={n.id}>
                  {showDay && <p className="notif-day">{label}</p>}
                  <button type="button" className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
                    <span className={`notif-icon kind-${n.kind}`}><Icon name={KIND_ICON[n.kind] ?? 'bell'} size={18} /></span>
                    <span className="notif-text">
                      <b>{n.title}</b>
                      {n.body && <span className="notif-body">{n.body}</span>}
                      <span className="notif-time">{hhmm(d)}{n.read_at ? " · o'qilgan" : ''}</span>
                    </span>
                    {!n.read_at && <span className="notif-dot" aria-label="O'qilmagan" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {hasMore && <Button variant="outline" onClick={() => load(items[items.length - 1].id)}>Yana ko'rsatish</Button>}
      </Content>
    </>
  );
}
