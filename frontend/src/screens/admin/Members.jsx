import { useState } from 'react';
import { api, formatPhone, initials, ROLE_NAMES } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { confirmDialog, useApi, useDebounced, useToast } from '../../hooks.jsx';
import {
  Avatar, Card, Chip, Content, EmptyState, ErrorBox, Header, Loading, Pill, SearchField,
} from '../../components/ui.jsx';

const FILTERS = [
  { key: '', label: 'Hammasi' },
  { key: 'student', label: "O'quvchilar" },
  { key: 'mentor', label: 'Mentorlar' },
  { key: 'parent', label: 'Ota-onalar' },
  { key: 'admin', label: 'Adminlar' },
];

function MemberCard({ person, me, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isSelf = person.id === me.id;
  const protectedUser = person.role === 'superadmin' || (person.role === 'admin' && me.role !== 'superadmin');
  const canEdit = !isSelf && !protectedUser;
  const roles = ['student', 'mentor', 'parent', ...(me.role === 'superadmin' ? ['admin'] : [])];

  async function run(fn, okText) {
    setBusy(true);
    try {
      const updated = await fn();
      toast(okText);
      onChanged(updated);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(role) {
    if (role === person.role) return;
    if (!(await confirmDialog(`${person.first_name} ${person.last_name} roli «${ROLE_NAMES[role]}» ga o'zgartirilsinmi?`))) return;
    run(() => api(`/admin/users/${person.id}/role`, { method: 'POST', body: { role } }), 'Rol o\'zgartirildi');
  }

  async function toggleBlock() {
    const blocked = person.status === 'blocked';
    const text = blocked ? 'Blokdan chiqarilsinmi?' : `${person.first_name} ${person.last_name} bloklansinmi? U ilovadan foydalana olmaydi.`;
    if (!(await confirmDialog(text))) return;
    run(() => api(`/admin/users/${person.id}/${blocked ? 'unblock' : 'block'}`, { method: 'POST' }),
      blocked ? 'Blokdan chiqarildi' : 'Bloklandi');
  }

  return (
    <Card className={person.status === 'blocked' ? 'card-dim' : ''}>
      <button type="button" className="row row-btn" onClick={() => canEdit && setOpen((v) => !v)} aria-expanded={open}>
        <Avatar text={initials(person)} />
        <div className="grow">
          <h3 className="item-title">{person.first_name} {person.last_name}{isSelf && ' (siz)'}</h3>
          <p className="muted small">{formatPhone(person.phone)}</p>
        </div>
        <div className="pill-stack">
          {person.role && <Pill>{ROLE_NAMES[person.role]}</Pill>}
          {person.status === 'blocked' && <Pill tone="warn">Bloklangan</Pill>}
        </div>
      </button>
      {open && canEdit && (
        <>
          <p className="muted small">Rolni o'zgartirish:</p>
          <div className="chips">
            {roles.map((r) => (
              <Chip key={r} active={person.role === r} disabled={busy} onClick={() => changeRole(r)}>{ROLE_NAMES[r]}</Chip>
            ))}
          </div>
          <button type="button" className="link-btn link-danger" onClick={toggleBlock} disabled={busy}>
            {person.status === 'blocked' ? 'Blokdan chiqarish' : 'Bloklash'}
          </button>
        </>
      )}
    </Card>
  );
}

export default function Members() {
  const { user } = useAuth();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());

  const params = new URLSearchParams({ limit: '200' });
  if (role) params.set('role', role);
  if (term.length >= 2) params.set('q', term);
  const { data, error, loading, reload, setData } = useApi(`/admin/users?${params}`);
  const people = data?.filter((p) => p.status !== 'pending');

  return (
    <>
      <Header title="A'zolar" />
      <Content>
        <SearchField value={q} onChange={setQ} placeholder="Ism yoki telefon raqam" />
        <div className="chips chips-scroll">
          {FILTERS.map((f) => <Chip key={f.key} active={role === f.key} onClick={() => setRole(f.key)}>{f.label}</Chip>)}
        </div>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {people?.length === 0 && <EmptyState icon="user" title="Hech kim topilmadi" />}
        {people?.map((p) => (
          <MemberCard key={p.id} person={p} me={user}
            onChanged={(u) => setData((list) => list.map((x) => (x.id === u.id ? u : x)))} />
        ))}
      </Content>
    </>
  );
}
