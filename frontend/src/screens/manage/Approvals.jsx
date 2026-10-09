import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatPhone, initials } from '../../api.js';
import { confirmDialog, timeAgo, useApi, useToast } from '../../hooks.jsx';
import {
  Avatar, Button, Card, Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';

export default function Approvals() {
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate('/manage'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload, setData } = useApi('/admin/approvals');
  const [busy, setBusy] = useState(null);

  async function decide(u, decision) {
    const text = decision === 'approve'
      ? `${u.first_name} ${u.last_name} «${u.branch_name}» filialiga admin etib tayinlansinmi?`
      : "Taklif rad etilsinmi? So'rov filial adminlariga qaytadi.";
    if (!(await confirmDialog(text))) return;
    setBusy(u.id);
    try {
      await api(`/admin/approvals/${u.id}/${decision}`, { method: 'POST' });
      toast(decision === 'approve' ? 'Admin tasdiqlandi — unga xabar yuborildi' : 'Rad etildi');
      setData((list) => list.filter((x) => x.id !== u.id));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Header title="Adminlarni tasdiqlash" onBack={back} />
      <Content>
        <p className="muted small">Filial adminlari "admin" rolini bergan foydalanuvchilar. Siz tasdiqlagandan keyingina ular admin bo'ladi.</p>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="shield" title="Tasdiqlash kutayotganlar yo'q" />}
        {data?.map((u) => (
          <Card key={u.id}>
            <div className="row">
              <Avatar text={initials(u)} />
              <div className="grow">
                <h3 className="item-title">{u.first_name} {u.last_name}</h3>
                <p className="muted small">{formatPhone(u.phone)} · {timeAgo(u.created_at)}</p>
              </div>
              <Pill>{u.branch_name ?? 'Filialsiz'}</Pill>
            </div>
            <div className="row">
              <Button onClick={() => decide(u, 'approve')} loading={busy === u.id}>Tasdiqlash</Button>
              <Button variant="outline" onClick={() => decide(u, 'reject')} disabled={busy === u.id}>Rad etish</Button>
            </div>
          </Card>
        ))}
      </Content>
    </>
  );
}
