import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, initials, money } from '../../api.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar, Button, Card, Content, EmptyState, ErrorBox, Header, Loading, MoneyField, Pill, Select, useTelegramBack,
} from '../../components/ui.jsx';
import { formatSchedule, parseSchedule, ScheduleEditor } from './schedule.jsx';
import StudentPicker from './StudentPicker.jsx';

function Settings({ group, onSaved }) {
  const toast = useToast();
  const mentors = useApi(`/admin/users?role=mentor&status=active&limit=200${group.branch_id ? `&branch_id=${group.branch_id}` : ''}`);
  const [mentorId, setMentorId] = useState(group.mentor?.id ? String(group.mentor.id) : '');
  const [schedule, setSchedule] = useState(parseSchedule(group.schedule ?? ''));
  const [price, setPrice] = useState(group.price ?? 0);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/admin/groups/${group.id}`, {
        method: 'PATCH',
        body: { mentor_id: mentorId ? Number(mentorId) : null, schedule: formatSchedule(schedule), price: price || null },
      });
      toast("O'zgarishlar saqlandi");
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="item-title">Sozlamalar</h3>
      <Select label="Mentor" value={mentorId} onChange={(e) => setMentorId(e.target.value)}>
        <option value="">Biriktirilmagan</option>
        {mentors.data?.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
      </Select>
      <ScheduleEditor value={schedule} onChange={setSchedule} />
      <MoneyField label="Oylik narx" value={price} onChange={setPrice} />
      <Button onClick={save} loading={busy}>Saqlash</Button>
    </Card>
  );
}

function AddStudents({ groupId, branchId, existing, onAdded, onCancel }) {
  const toast = useToast();
  const students = useApi(`/admin/users?role=student&status=active&limit=200${branchId ? `&branch_id=${branchId}` : ''}`);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await api(`/admin/groups/${groupId}/students`, { method: 'POST', body: { student_ids: picked } });
      toast(`${picked.length} ta o'quvchi qo'shildi`);
      onAdded();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="kv"><h3 className="item-title">O'quvchi qo'shish</h3><Pill>Tanlandi: {picked.length}</Pill></div>
      {students.loading ? <Loading /> : (
        <StudentPicker students={students.data ?? []} selected={picked} onChange={setPicked} exclude={existing} />
      )}
      <div className="row">
        <Button variant="outline" onClick={onCancel}>Bekor qilish</Button>
        <Button onClick={add} loading={busy} disabled={!picked.length}>Qo'shish</Button>
      </div>
    </Card>
  );
}

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate('/groups'), [navigate]);
  useTelegramBack(back);

  // Alohida guruh endpointi yo'q — ro'yxatdan topamiz
  const groups = useApi('/admin/groups');
  const students = useApi(`/mentor/groups/${id}/students`);
  const group = groups.data?.find((g) => String(g.id) === id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => { setAdding(false); }, [id]);

  if (groups.loading && !groups.data) return <><Header title="Guruh" onBack={back} /><Loading /></>;
  if (!group) {
    return (
      <>
        <Header title="Guruh" onBack={back} />
        <Content><ErrorBox text={groups.error ?? 'Guruh topilmadi'} onRetry={groups.reload} /></Content>
      </>
    );
  }

  return (
    <>
      <Header title={group.name} onBack={back} />
      <Content>
        <div className="hero-card">
          <h2 className="hero-title">{group.name}</h2>
          <p className="hero-sub">
            {group.mentor ? `Mentor: ${group.mentor.first_name} ${group.mentor.last_name}` : 'Mentor biriktirilmagan'}
          </p>
          <p className="hero-sub">{group.schedule || 'Jadval belgilanmagan'} · {group.student_count} o'quvchi</p>
          <p className="hero-sub">{group.price ? `Oylik narx: ${money(group.price)} so'm` : 'Narx belgilanmagan'}</p>
          {group.branch_name && <p className="hero-sub">Filial: {group.branch_name}</p>}
          <button type="button" className="hero-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Yopish' : 'Tahrirlash'}
          </button>
        </div>

        {editing && <Settings group={group} onSaved={() => { groups.reload(); setEditing(false); }} />}

        <div className="section-head">
          <h2 className="section-title">O'quvchilar</h2>
          {!adding && <button type="button" className="link-btn" onClick={() => setAdding(true)}>+ Qo'shish</button>}
        </div>

        {adding && (
          <AddStudents groupId={id} branchId={group.branch_id} existing={(students.data ?? []).map((s) => s.id)}
            onCancel={() => setAdding(false)}
            onAdded={() => { setAdding(false); students.reload(); groups.reload(); }} />
        )}

        {students.loading && !students.data && <Loading />}
        {students.error && <ErrorBox text={students.error} onRetry={students.reload} />}
        {students.data?.length === 0 && !adding && (
          <EmptyState icon="users" title="Guruhda o'quvchi yo'q"
            action={<Button onClick={() => setAdding(true)}>O'quvchi qo'shish</Button>} />
        )}
        {students.data?.length > 0 && (
          <Card className="card-flush">
            {students.data.map((s) => (
              <div key={s.id} className="list-row">
                <Avatar text={initials(s)} size={36} />
                <div className="grow">
                  <b>{s.first_name} {s.last_name}</b>
                  <p className="muted small">Bog'langan ota-ona: {s.confirmed_parents}</p>
                </div>
              </div>
            ))}
          </Card>
        )}
      </Content>
    </>
  );
}
