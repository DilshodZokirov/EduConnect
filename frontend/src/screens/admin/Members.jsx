import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatPhone, GRANTABLE, initials, isManager, ROLE_NAMES } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { confirmDialog, useApi, useDebounced, useToast } from '../../hooks.jsx';
import {
  Avatar, Card, Chip, Content, EmptyState, ErrorBox, Header, Loading, Pill, SearchField, Select, useTelegramBack,
} from '../../components/ui.jsx';

const FILTERS = [
  { key: '', label: 'Hammasi' },
  { key: 'student', label: "O'quvchilar" },
  { key: 'mentor', label: 'Mentorlar' },
  { key: 'parent', label: 'Ota-onalar' },
  { key: 'admin', label: 'Adminlar' },
  { key: 'regional_manager', label: 'Hududiy menejerlar', managers: true },
  { key: 'general_manager', label: 'Umumiy menejerlar', managers: true },
];
const LEVEL = { superadmin: 5, general_manager: 4, regional_manager: 3, admin: 2 };
const level = (r) => (r ? LEVEL[r] ?? 1 : 0);

function MemberCard({ person, me, branches, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isSelf = person.id === me.id;
  const canEdit = !isSelf && level(person.role) < level(me.role);
  const roles = GRANTABLE[me.role] ?? [];

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

  async function changeBranch(branchId) {
    if (!branchId || Number(branchId) === person.branch_id) return;
    const b = branches.find((x) => x.id === Number(branchId));
    if (!(await confirmDialog(`${person.first_name} ${person.last_name} «${b?.name}» filialiga o'tkazilsinmi?`))) return;
    run(() => api(`/admin/users/${person.id}/branch`, { method: 'PATCH', body: { branch_id: Number(branchId) } }), "Filial o'zgartirildi");
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
          <p className="muted small">{formatPhone(person.phone)}{person.branch_name ? ` · ${person.branch_name}` : ''}</p>
        </div>
        <div className="pill-stack">
          {person.role && <Pill>{ROLE_NAMES[person.role]}</Pill>}
          {person.status === 'blocked' && <Pill tone="warn">Bloklangan</Pill>}
          {person.awaiting_manager && <Pill tone="warn">Menejer tasdiqlaydi</Pill>}
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
          {isManager(me.role) && branches.length > 0 && (
            <Select label="Filial" value={person.branch_id ?? ''} onChange={(e) => changeBranch(e.target.value)} disabled={busy}>
              <option value="">Filial tanlanmagan</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
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
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/manage'), [navigate]);
  useTelegramBack(back);
  const branchesApi = useApi('/admin/branches');
  const branches = (branchesApi.data ?? []).filter((b) => b.is_active);
  const [branchFilter, setBranchFilter] = useState('');
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());

  const params = new URLSearchParams({ limit: '200' });
  if (role) params.set('role', role);
  if (term.length >= 2) params.set('q', term);
  if (branchFilter) params.set('branch_id', branchFilter);
  const { data, error, loading, reload, setData } = useApi(`/admin/users?${params}`);
  const people = data?.filter((p) => p.status !== 'pending');

  return (
    <>
      <Header title="A'zolar" onBack={back} />
      <Content>
        <SearchField value={q} onChange={setQ} placeholder="Ism yoki telefon raqam" />
        <div className="chips chips-scroll">
          {FILTERS.filter((f) => !f.managers || isManager(user.role))
            .map((f) => <Chip key={f.key} active={role === f.key} onClick={() => setRole(f.key)}>{f.label}</Chip>)}
        </div>
        {isManager(user.role) && branches.length > 1 && (
          <div className="chips chips-scroll">
            <Chip active={!branchFilter} onClick={() => setBranchFilter('')}>Barcha filiallar</Chip>
            {branches.map((b) => <Chip key={b.id} active={branchFilter === String(b.id)} onClick={() => setBranchFilter(String(b.id))}>{b.name}</Chip>)}
          </div>
        )}
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {people?.length === 0 && <EmptyState icon="user" title="Hech kim topilmadi" />}
        {people?.map((p) => (
          <MemberCard key={p.id} person={p} me={user} branches={branches}
            onChanged={(u) => setData((list) => list.map((x) => (x.id === u.id ? u : x)))} />
        ))}
      </Content>
    </>
  );
}
