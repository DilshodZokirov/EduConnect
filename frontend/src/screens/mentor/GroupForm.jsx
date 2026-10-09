import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, useToast } from '../../hooks.jsx';
import { BottomBar, Button, Content, Field, Header, Loading, MoneyField, Select, useTelegramBack } from '../../components/ui.jsx';
import { useAuth } from '../../auth.jsx';
import { useBranding } from '../../branding.jsx';
import { formatSchedule, parseSchedule, ScheduleEditor } from '../admin/schedule.jsx';

/** O'qituvchi guruhni o'zi yaratadi yoki tahrirlaydi: nomi, jadvali, oylik narxi. */
export default function GroupForm() {
  const { gid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(gid ? `/g/${gid}/invite` : '/'), [navigate, gid]);
  useTelegramBack(back);
  const groups = useApi(gid ? '/mentor/groups' : null);
  const group = groups.data?.find((g) => String(g.id) === gid);

  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState({ days: [], start: '14:00', end: '16:00' });
  const [price, setPrice] = useState(0);
  const { user } = useAuth();
  const { branches } = useBranding();
  const [branchId, setBranchId] = useState(String(user.branch_id ?? ''));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setSchedule(parseSchedule(group.schedule ?? ''));
    setPrice(group.price ?? 0);
    if (group.branch_id) setBranchId(String(group.branch_id));
  }, [group]);

  // Filial tanlanmagan bo'lsa va bitta filial bo'lsa — o'zi tanlanadi
  useEffect(() => {
    if (!branchId && branches.length === 1) setBranchId(String(branches[0].id));
  }, [branches, branchId]);

  async function save() {
    setBusy(true);
    try {
      const body = { name: name.trim(), schedule: formatSchedule(schedule), price: price || null, branch_id: branchId ? Number(branchId) : null };
      const g = gid
        ? await api(`/mentor/groups/${gid}`, { method: 'PATCH', body })
        : await api('/mentor/groups', { method: 'POST', body });
      try { localStorage.setItem('mentor.group', String(g.id)); } catch { /* */ }
      toast(gid ? 'Saqlandi' : "Guruh yaratildi. Endi havolani o'quvchilarga yuboring");
      navigate(`/g/${g.id}/invite`, { replace: true });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  if (gid && groups.loading && !groups.data) return <><Header title="Guruh" onBack={back} /><Loading /></>;

  return (
    <>
      <Header title={gid ? 'Guruh sozlamalari' : 'Yangi guruh'} onBack={back} />
      <Content>
        <Field label="Guruh nomi" placeholder="Guruh nomi" value={name} onChange={(e) => setName(e.target.value)} />
        {branches.length > 0 ? (
          <Select label="Filial" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {!branchId && <option value="">Filialni tanlang</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{String(b.id) === String(user.branch_id) ? ' (asosiy)' : ''}</option>)}
          </Select>
        ) : (
          <p className="muted small">Hali filial qo'shilmagan. Filialni menejer «Boshqaruv → Filiallar» bo'limida qo'shadi.</p>
        )}
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <MoneyField label="Oylik narx" value={price} onChange={setPrice}
          hint="Oy o'rtasida qo'shilganlar faqat qolgan darslar uchun to'laydi." />
      </Content>
      <BottomBar>
        <Button onClick={save} loading={busy} disabled={!name.trim() || (branches.length > 0 && !branchId)}>{gid ? 'Saqlash' : 'Guruh yaratish'}</Button>
      </BottomBar>
    </>
  );
}
