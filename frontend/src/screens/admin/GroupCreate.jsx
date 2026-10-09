import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isManager } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useApi, useToast } from '../../hooks.jsx';
import {
  BottomBar, Button, Card, Content, ErrorBox, Field, Header, Loading, MoneyField, Pill, Select, useTelegramBack,
} from '../../components/ui.jsx';
import { formatSchedule, ScheduleEditor } from './schedule.jsx';
import StudentPicker from './StudentPicker.jsx';

export default function GroupCreate() {
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate('/groups'), [navigate]);
  useTelegramBack(back);

  const { user } = useAuth();
  const branches = useApi(isManager(user.role) ? '/admin/branches' : null);
  const activeBranches = (branches.data ?? []).filter((b) => b.is_active);
  const [branchId, setBranchId] = useState('');
  const branchQuery = branchId ? `&branch_id=${branchId}` : '';
  const mentors = useApi(`/admin/users?role=mentor&status=active&limit=200${branchQuery}`);
  const students = useApi(`/admin/users?role=student&status=active&limit=200${branchQuery}`);

  const [name, setName] = useState('');
  const [mentorId, setMentorId] = useState('');
  const [schedule, setSchedule] = useState({ days: [], start: '14:00', end: '16:00' });
  const [price, setPrice] = useState(0);
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { setError('Guruh nomini kiriting'); return; }
    setBusy(true);
    setError('');
    try {
      const group = await api('/admin/groups', {
        method: 'POST',
        body: {
          name: name.trim(), mentor_id: mentorId ? Number(mentorId) : null,
          branch_id: branchId ? Number(branchId) : null,
          schedule: formatSchedule(schedule), price: price || null,
        },
      });
      if (picked.length) {
        await api(`/admin/groups/${group.id}/students`, { method: 'POST', body: { student_ids: picked } });
      }
      toast(`«${group.name}» guruhi yaratildi`);
      navigate(`/groups/${group.id}`, { replace: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <Header title="Yangi guruh" onBack={back} />
      <Content>
        <Field label="Guruh nomi" placeholder="Masalan: Frontend-12" value={name}
          onChange={(e) => setName(e.target.value)} />
        {activeBranches.length > 0 && (
          <Select label="Filial" value={branchId} onChange={(e) => { setBranchId(e.target.value); setMentorId(''); setPicked([]); }}>
            <option value="">Filialni tanlang</option>
            {activeBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <Select label="Mentor" value={mentorId} onChange={(e) => setMentorId(e.target.value)}>
          <option value="">Keyinroq tanlayman</option>
          {mentors.data?.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
        </Select>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <MoneyField label="Oylik narx" value={price} onChange={setPrice}
          hint="To'lov har oyning 10-sanasigacha. Oy o'rtasida qo'shilganlar faqat qolgan darslar uchun to'laydi." />
        <Card>
          <div className="kv"><h3 className="item-title">O'quvchilar</h3><Pill>Tanlandi: {picked.length}</Pill></div>
          {students.loading ? <Loading /> : (
            <StudentPicker students={students.data ?? []} selected={picked} onChange={setPicked} />
          )}
        </Card>
        {error && <ErrorBox text={error} />}
      </Content>
      <BottomBar>
        <Button onClick={submit} loading={busy}>Guruh yaratish</Button>
      </BottomBar>
    </>
  );
}
