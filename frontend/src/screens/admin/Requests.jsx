import { useState } from 'react';
import { api, formatPhone, initials, ROLE_NAMES } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { confirmDialog, timeAgo, useApi, useToast } from '../../hooks.jsx';
import {
  Avatar, Button, Card, Chip, Content, EmptyState, ErrorBox, Header, IconButton, Loading, Pill,
} from '../../components/ui.jsx';

function RequestCard({ person, roles, onDone }) {
  const toast = useToast();
  const [role, setRole] = useState(null);
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api(`/admin/users/${person.id}/role`, { method: 'POST', body: { role } });
      toast(`${person.first_name} ${person.last_name} — ${ROLE_NAMES[role].toLowerCase()} sifatida tasdiqlandi`);
      onDone(person.id);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function block() {
    if (!(await confirmDialog(`${person.first_name} ${person.last_name} bloklansinmi? U ilovadan foydalana olmaydi.`))) return;
    setBusy(true);
    try {
      await api(`/admin/users/${person.id}/block`, { method: 'POST' });
      toast('Foydalanuvchi bloklandi');
      onDone(person.id);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="row">
        <Avatar text={initials(person)} />
        <div className="grow">
          <h3 className="item-title">{person.first_name} {person.last_name}</h3>
          <p className="muted small">{formatPhone(person.phone)} · {timeAgo(person.created_at)}</p>
        </div>
      </div>
      <p className="muted small">Rolni belgilang:</p>
      <div className="chips">
        {roles.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)}>{ROLE_NAMES[r]}</Chip>)}
      </div>
      <Button onClick={approve} loading={busy} disabled={!role}>Tasdiqlash</Button>
      <button type="button" className="link-btn link-muted" onClick={block} disabled={busy}>Begona odam — bloklash</button>
    </Card>
  );
}

function PhoneRequests() {
  const toast = useToast();
  const { data, setData } = useApi('/admin/phone-requests');
  if (!data?.length) return null;

  async function decide(req, decision) {
    const text = decision === 'approve'
      ? `Raqam ${formatPhone(req.new_phone)} ga almashtirilsinmi? Shaxsni tekshirganingizga ishonch hosil qiling.`
      : "So'rov rad etilsinmi?";
    if (!(await confirmDialog(text))) return;
    try {
      await api(`/admin/phone-requests/${req.id}/${decision}`, { method: 'POST' });
      toast(decision === 'approve' ? 'Raqam almashtirildi' : "So'rov rad etildi");
      setData((list) => list.filter((r) => r.id !== req.id));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <h2 className="section-title">Raqamni almashtirish so'rovlari</h2>
      {data.map((req) => (
        <Card key={req.id}>
          <p className="muted small">Eski raqamga kirish imkoni yo'q, {timeAgo(req.created_at)}</p>
          <div className="kv"><span className="muted">Eski</span><b>{formatPhone(req.old_phone)}</b></div>
          <div className="kv"><span className="muted">Yangi</span><b>{formatPhone(req.new_phone)}</b></div>
          <div className="row">
            <Button onClick={() => decide(req, 'approve')}>Tasdiqlash</Button>
            <Button variant="outline" onClick={() => decide(req, 'reject')}>Rad etish</Button>
          </div>
        </Card>
      ))}
    </>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const { data, error, loading, reload, setData } = useApi('/admin/users?status=pending');
  const roles = ['student', 'mentor', 'parent', ...(user.role === 'superadmin' ? ['admin'] : [])];

  return (
    <>
      <Header title="Yangi so'rovlar"
        right={<>{data?.length > 0 && <Pill tone="warn">{data.length} ta</Pill>}<IconButton icon="refresh" label="Yangilash" onClick={reload} /></>} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && (
          <EmptyState icon="users" title="Yangi so'rov yo'q"
            text="Kimdir botda ro'yxatdan o'tsa, shu yerda paydo bo'ladi va sizga Telegram'da xabar keladi." />
        )}
        {data?.map((p) => (
          <RequestCard key={p.id} person={p} roles={roles}
            onDone={(id) => setData((list) => list.filter((x) => x.id !== id))} />
        ))}
        <PhoneRequests />
      </Content>
    </>
  );
}
