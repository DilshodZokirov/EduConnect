import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatPhone, initials, ROLE_NAMES } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { confirmDialog, useApi, useDebounced, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar, Button, Card, Chip, Content, EmptyState, ErrorBox, Header, Loading, Pill, SearchField, Select, useTelegramBack,
} from '../../components/ui.jsx';

const ROLE_FILTERS = [
  { key: '', label: 'Hammasi' },
  { key: 'mentor', label: 'Mentorlar' },
  { key: 'admin', label: 'Adminlar' },
  { key: 'regional_manager', label: 'Hududiy menejerlar' },
];
const ROLE_HINT = {
  student: "Guruhga havola orqali qo'shiladi",
  parent: 'Farzandini kuzatadi',
  mentor: "Guruh ochadi, istalgan filialda dars beradi",
  admin: "Faqat bitta filialda ishlaydi, mentor so'rovlarini tasdiqlaydi",
  regional_manager: "Biriktirilgan filiallar, admin so'rovlarini tasdiqlaydi",
  general_manager: "Barcha filiallar, hududiy menejerlarni tayinlaydi",
};

function roleLabel(p) {
  if (p.role) return ROLE_NAMES[p.role];
  if (p.status === 'pending') return p.requested_role === 'admin' ? "Admin bo'lmoqchi" : "Mentor bo'lmoqchi";
  return 'Rolsiz';
}

/** «Ishga tayinlash»: ro'yxatdan o'tganlar bo'yicha umumiy qidiruv. */
export function StaffSearch() {
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/manage'), [navigate]);
  useTelegramBack(back);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const term = useDebounced(q.trim(), 300);
  const params = new URLSearchParams();
  if (term.length >= 2) params.set('q', term);
  if (role) params.set('role', role);
  const list = useApi(`/admin/staff?${params}`);

  return (
    <>
      <Header title="Ishga tayinlash" onBack={back} />
      <Content>
        <SearchField value={q} onChange={setQ} placeholder="Ism, familiya yoki telefon" />
        <div className="chips chips-scroll">
          {ROLE_FILTERS.map((f) => <Chip key={f.key} active={role === f.key} onClick={() => setRole(f.key)}>{f.label}</Chip>)}
        </div>
        {list.loading && !list.data && <Loading />}
        {list.error && <ErrorBox text={list.error} onRetry={list.reload} />}
        {list.data?.length === 0 && <EmptyState icon="search" title="Hech kim topilmadi" text="Boshqa ism yoki raqam bilan qidirib ko'ring." />}
        {list.data && list.data.length > 0 && (
          <Card className="card-flush">
            {list.data.map((p) => (
              <button key={p.id} type="button" className="list-row list-row-btn" onClick={() => navigate(`/manage/staff/${p.id}`)}>
                <Avatar text={initials(p)} size={40} />
                <span className="grow">
                  <b>{p.first_name} {p.last_name}</b>
                  <span className="muted small block">{formatPhone(p.phone)}{p.branch_name ? ` · ${p.branch_name}` : ''}</span>
                </span>
                <Pill tone={p.role ? 'blue' : 'warn'}>{roleLabel(p)}</Pill>
                <Icon name="right" size={18} />
              </button>
            ))}
          </Card>
        )}
      </Content>
    </>
  );
}

/** Bitta odam: rol, filial, rolni olib qo'yish, vakolatni topshirish. */
export function StaffDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, applySession } = useAuth();
  const back = useCallback(() => navigate('/manage/staff'), [navigate]);
  useTelegramBack(back);
  const person = useApi(`/admin/staff/${id}`);
  const branches = useApi('/admin/branches');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');
  const [branchIds, setBranchIds] = useState([]);
  const [busy, setBusy] = useState('');
  const [keep, setKeep] = useState('regional_manager');
  const p = person.data;

  useEffect(() => {
    if (!p) return;
    setRole(p.role ?? '');
    setBranchId(p.branch_id ? String(p.branch_id) : '');
    setBranchIds(p.manager_branches.map((b) => b.id));
  }, [p]);

  async function run(kind, fn, okText) {
    setBusy(kind);
    try {
      const r = await fn();
      if (r && r.allowed_roles) person.setData(r);
      toast(okText);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const save = () => run('save', () => api(`/admin/staff/${id}`, {
    method: 'PUT', body: { role, branch_id: branchId ? Number(branchId) : null, branch_ids: branchIds },
  }), 'Saqlandi. Ilovani qayta ochganda yangi rol bilan kiradi');

  async function revoke() {
    if (!(await confirmDialog(`${p.first_name} ${p.last_name}ning roli olib qo'yilsinmi? U «kutilmoqda» holatiga qaytadi.`))) return;
    run('revoke', () => api(`/admin/staff/${id}/revoke`, { method: 'POST' }), "Rol olib qo'yildi");
  }

  async function transfer() {
    const text = keep === 'regional_manager'
      ? `Umumiy menejer vakolati ${p.first_name} ${p.last_name}ga topshirilsinmi? Siz hududiy menejer bo'lib qolasiz.`
      : `Umumiy menejer vakolati ${p.first_name} ${p.last_name}ga topshirilsinmi? Sizning rolingiz butunlay olib qo'yiladi.`;
    if (!(await confirmDialog(text))) return;
    setBusy('transfer');
    try {
      const r = await api(`/admin/staff/${id}/transfer`, { method: 'POST', body: { keep } });
      applySession(r);
      toast('Vakolat topshirildi');
      navigate('/', { replace: true });
    } catch (e) {
      toast(e.message, 'error');
      setBusy('');
    }
  }

  if (person.loading && !p) return <><Header title="Xodim" onBack={back} /><Loading /></>;
  if (person.error) return <><Header title="Xodim" onBack={back} /><Content><ErrorBox text={person.error} onRetry={person.reload} /></Content></>;

  const editable = p.allowed_roles.length > 0;
  const needsBranch = role === 'admin' || role === 'mentor';
  const branchLocked = role === 'admin' && p.role === 'admin' && !p.can_change_branch;
  const changed = role !== (p.role ?? '') || branchId !== (p.branch_id ? String(p.branch_id) : '')
    || (role === 'regional_manager' && JSON.stringify([...branchIds].sort()) !== JSON.stringify(p.manager_branches.map((b) => b.id).sort()));

  return (
    <>
      <Header title="Xodim" onBack={back} />
      <Content>
        <Card className="profile-card">
          <Avatar text={initials(p)} size={64} />
          <h2 className="title-md">{p.first_name} {p.last_name}</h2>
          <div className="chips chips-center"><Pill tone={p.role ? 'blue' : 'warn'}>{roleLabel(p)}</Pill></div>
          <p className="muted">{formatPhone(p.phone)}{p.branch_name ? ` · ${p.branch_name}` : ''}</p>
          {p.manager_branches.length > 0 && (
            <p className="muted small">Filiallari: {p.manager_branches.map((b) => b.name).join(', ')}</p>
          )}
        </Card>

        {!editable && (
          <p className="muted small center">
            {p.id === user.id ? "Bu sizning profilingiz." : "Bu odamning rolini o'zgartirishga ruxsatingiz yo'q."}
          </p>
        )}

        {editable && (
          <Card>
            <h3 className="item-title">Rol berish</h3>
            <div className="chips">
              {p.allowed_roles.map((r) => <Chip key={r} active={role === r} onClick={() => setRole(r)}>{ROLE_NAMES[r]}</Chip>)}
            </div>
            {role && <p className="muted small">{ROLE_HINT[role]}</p>}

            {needsBranch && (
              <Select label={role === 'admin' ? 'Qaysi filialda ishlaydi' : 'Asosiy filial'} value={branchId}
                disabled={branchLocked} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Filialni tanlang</option>
                {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
            {branchLocked && <p className="muted small">Adminning filialini faqat umumiy menejer o'zgartiradi.</p>}
            {role === 'mentor' && <p className="muted small">Mentor guruh ochayotganda istalgan filialni o'zi tanlaydi.</p>}

            {role === 'regional_manager' && (
              <div className="field">
                <span className="field-label">Biriktirilgan filiallar</span>
                <div className="chips">
                  {(branches.data ?? []).map((b) => {
                    const on = branchIds.includes(b.id);
                    return (
                      <Chip key={b.id} active={on}
                        onClick={() => setBranchIds((l) => (on ? l.filter((x) => x !== b.id) : [...l, b.id]))}>{b.name}</Chip>
                    );
                  })}
                </div>
              </div>
            )}

            <Button onClick={save} loading={busy === 'save'} disabled={!role || !changed || (role === 'admin' && !branchId)}>
              Saqlash
            </Button>
          </Card>
        )}

        {p.can_transfer && (
          <Card className="card-warn">
            <h3 className="item-title">Vakolatni topshirish</h3>
            <p className="muted small">Umumiy menejer vakolati shu odamga o'tadi. O'zingiz uchun tanlang:</p>
            <div className="chips">
              <Chip active={keep === 'regional_manager'} onClick={() => setKeep('regional_manager')}>Hududiy menejer bo'lib qolaman</Chip>
              <Chip active={keep === 'none'} onClick={() => setKeep('none')}>Rolni butunlay topshiraman</Chip>
            </div>
            <Button variant="outline" onClick={transfer} loading={busy === 'transfer'}>Vakolatni topshirish</Button>
          </Card>
        )}

        {p.can_revoke && (
          <button type="button" className="link-btn link-danger" onClick={revoke} disabled={!!busy}>Rolni olib qo'yish</button>
        )}
      </Content>
    </>
  );
}
