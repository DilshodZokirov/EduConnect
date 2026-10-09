import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, initials, money } from '../../api.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import { useAuth } from '../../auth.jsx';
import {
  Avatar, Button, Card, Chip, Content, EmptyState, ErrorBox, Field, Header, IconButton, Loading, MoneyField, Pill,
  useTelegramBack,
} from '../../components/ui.jsx';
import StudentPicker from './StudentPicker.jsx';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const monthName = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const size = (d) => (d.kind === 'percent' ? `${d.value}%` : `${money(d.value)} so'm`);
const duration = (d) => (d.months ? `${d.months} oy` : 'Muddatsiz');

/** O'quvchilarni belgilash + qaysi oydan boshlanishi. */
function StudentsChooser({ picked, onPicked, start, onStart, exclude = [] }) {
  const { user } = useAuth();
  const { gid } = useParams();
  // O'qituvchi — faqat shu guruh o'quvchilari; admin — filial o'quvchilari
  const students = useApi(user.role === 'mentor' ? `/mentor/groups/${gid}/students` : '/admin/users?role=student&status=active&limit=200');
  return (
    <div className="stack">
      <div className="kv"><span className="field-label">O'quvchilarni tanlang</span><Pill>Tanlandi: {picked.length}</Pill></div>
      {students.loading && !students.data ? <Loading /> : (
        <StudentPicker students={students.data ?? []} selected={picked} onChange={onPicked} exclude={exclude} />
      )}
      <div className="chips">
        <Chip active={start === 'current'} onClick={() => onStart('current')}>Joriy oydan</Chip>
        <Chip active={start === 'next'} onClick={() => onStart('next')}>Keyingi oydan</Chip>
      </div>
    </div>
  );
}

function DiscountForm({ initial, onSaved, onCancel }) {
  const toast = useToast();
  const { user } = useAuth();
  const { gid } = useParams();
  const isMentor = user.role === 'mentor';
  const groups = useApi(isMentor ? '/mentor/groups' : '/admin/groups');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [conditions, setConditions] = useState(initial?.conditions ?? '');
  const [kind, setKind] = useState(initial?.kind ?? null);
  const [value, setValue] = useState(initial?.value ?? 0);
  const [months, setMonths] = useState(initial ? initial.months : undefined);
  const [groupIds, setGroupIds] = useState(initial?.groups.map((g) => g.id) ?? (isMentor && gid ? [Number(gid)] : []));
  const [picked, setPicked] = useState([]);
  const [start, setStart] = useState('current');
  const [busy, setBusy] = useState(false);

  const percentError = kind === 'percent' && (value < 1 || value > 100) ? '1 dan 100 gacha' : undefined;
  const ready = name.trim().length >= 2 && kind && value && !percentError && months !== undefined
    && (!isMentor || groupIds.length > 0);

  async function save(isActive = true) {
    setBusy(true);
    try {
      const body = {
        name: name.trim(), description: description.trim() || null, conditions: conditions.trim() || null,
        kind, value, months, group_ids: groupIds,
      };
      let saved;
      if (initial) {
        saved = await api(`/admin/discounts/${initial.id}`, { method: 'PUT', body: { ...body, is_active: isActive } });
        toast(isActive ? 'Saqlandi' : 'Chegirma arxivlandi');
      } else {
        saved = await api('/admin/discounts', { method: 'POST', body });
        if (picked.length) {
          await api(`/admin/discounts/${saved.id}/assign-many`, { method: 'POST', body: { student_ids: picked, start } });
        }
        toast(picked.length ? `Chegirma yaratildi va ${picked.length} ta o'quvchiga berildi` : 'Chegirma yaratildi');
      }
      onSaved(saved);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  const toggleGroup = (id) => setGroupIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Card>
      <h3 className="item-title">{initial ? 'Chegirmani tahrirlash' : 'Yangi chegirma'}</h3>
      <Field label="Chegirma nomi" placeholder="Nomini yozing" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="field">
        <span className="field-label">Nima haqida (ixtiyoriy)</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Chegirma nima uchun joriy qilingani" />
      </label>
      <div className="field">
        <span className="field-label">Turi</span>
        <div className="chips">
          <Chip active={kind === 'percent'} onClick={() => { setKind('percent'); setValue(0); }}>Foiz</Chip>
          <Chip active={kind === 'fixed'} onClick={() => { setKind('fixed'); setValue(0); }}>Aniq summa</Chip>
        </div>
      </div>
      {kind === 'percent' && (
        <Field label="Foiz" type="number" min={1} max={100} placeholder="%" value={value || ''} error={value ? percentError : undefined}
          onChange={(e) => setValue(Number(e.target.value) || 0)} />
      )}
      {kind === 'fixed' && <MoneyField label="Summa (har oy)" value={value} onChange={setValue} />}
      <div className="field">
        <span className="field-label">Necha oy amal qiladi</span>
        <div className="chips">
          {[1, 3, 6, 12].map((n) => <Chip key={n} active={months === n} onClick={() => setMonths(n)}>{n} oy</Chip>)}
          <Chip active={months === null} onClick={() => setMonths(null)}>Muddatsiz</Chip>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Qaysi guruhlarga</span>
        <div className="chips">
          {!isMentor && <Chip active={groupIds.length === 0} onClick={() => setGroupIds([])}>Barcha guruhlar</Chip>}
          {groups.data?.map((g) => <Chip key={g.id} active={groupIds.includes(g.id)} onClick={() => toggleGroup(g.id)}>{g.name}</Chip>)}
        </div>
      </div>
      <label className="field">
        <span className="field-label">Shartlar (ixtiyoriy)</span>
        <textarea rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)}
          placeholder="Qanday shartlar asosida berilishi — keyin boshqa xodimlar ham tushunishi uchun" />
      </label>

      {!initial && (
        <div className="sub-panel">
          <StudentsChooser picked={picked} onPicked={setPicked} start={start} onStart={setStart} />
          <p className="muted small">O'quvchilarni hozir tanlamasangiz ham bo'ladi — keyin chegirma kartasidan qo'shasiz.</p>
        </div>
      )}
      {initial && <p className="muted small">O'zgarishlar faqat keyingi hisob-kitoblarga ta'sir qiladi. O'tgan oylar o'zgarmaydi.</p>}

      <div className="row">
        <Button variant="outline" onClick={onCancel}>Bekor qilish</Button>
        <Button onClick={() => save(true)} loading={busy} disabled={!ready}>
          {!initial && picked.length ? `Saqlash va ${picked.length} ta o'quvchiga berish` : 'Saqlash'}
        </Button>
      </div>
      {initial?.is_active && (
        <button type="button" className="link-btn link-danger" onClick={() => save(false)} disabled={busy}>
          Arxivlash (yangi o'quvchilarga berilmaydi)
        </button>
      )}
    </Card>
  );
}

function DiscountCard({ discount, onChanged }) {
  const toast = useToast();
  const assignments = useApi(`/admin/discounts/assignments?discount_id=${discount.id}`);
  const [panel, setPanel] = useState(null); // add | edit
  const [picked, setPicked] = useState([]);
  const [start, setStart] = useState('current');
  const [busy, setBusy] = useState(false);
  const assignedIds = (assignments.data ?? []).map((a) => a.student.id);

  async function add() {
    setBusy(true);
    try {
      const created = await api(`/admin/discounts/${discount.id}/assign-many`, {
        method: 'POST', body: { student_ids: picked, start },
      });
      toast(`${created.length} ta o'quvchiga berildi`);
      setPicked([]);
      setPanel(null);
      assignments.reload();
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function stop(a) {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const text = a.start_period > thisMonth
      ? `${a.student.first_name} ${a.student.last_name} uchun hali boshlanmagan chegirma bekor qilinsinmi?`
      : `${a.student.first_name} ${a.student.last_name} uchun chegirma shu oy oxirida to'xtatilsinmi?`;
    if (!(await confirmDialog(text))) return;
    try {
      await api(`/admin/discounts/assignments/${a.id}/stop`, { method: 'POST' });
      toast("Chegirma to'xtatildi");
      assignments.reload();
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (panel === 'edit') {
    return <DiscountForm initial={discount} onCancel={() => setPanel(null)} onSaved={() => { setPanel(null); onChanged(); }} />;
  }

  return (
    <Card className={discount.is_active ? '' : 'card-dim'}>
      <div className="kv">
        <div>
          <h3 className="item-title">{discount.name}</h3>
          {discount.description && <p className="muted small">{discount.description}</p>}
        </div>
        <span className="discount-size">{size(discount)}</span>
      </div>
      <div className="chips">
        <Pill tone="grey">{duration(discount)}</Pill>
        <Pill tone="grey">{discount.all_groups ? 'Barcha guruhlar' : discount.groups.map((g) => g.name).join(', ')}</Pill>
        {!discount.is_active && <Pill tone="warn">Arxivlangan</Pill>}
      </div>
      {discount.conditions && <p className="small info-note"><b>Shartlar:</b> {discount.conditions}</p>}

      <div className="kv">
        <b className="small">Kimlarga amal qiladi ({assignedIds.length})</b>
        {discount.is_active && panel !== 'add' && (
          <button type="button" className="link-btn" onClick={() => setPanel('add')}>+ O'quvchi qo'shish</button>
        )}
      </div>
      {assignments.loading && !assignments.data && <Loading />}
      {assignments.data?.length === 0 && panel !== 'add' && <p className="muted small">Hali hech kimga berilmagan.</p>}
      {assignments.data?.length > 0 && (
        <div className="assignees">
          {assignments.data.map((a) => (
            <div key={a.id} className="list-row">
              <Avatar text={initials(a.student)} size={32} />
              <div className="grow">
                <b className="small">{a.student.first_name} {a.student.last_name}</b>
                <p className="muted small">{monthName(a.start_period)}{a.end_period ? ` – ${monthName(a.end_period)}` : ' dan, muddatsiz'}</p>
              </div>
              <button type="button" className="mini-btn" onClick={() => stop(a)}>To'xtatish</button>
            </div>
          ))}
        </div>
      )}

      {panel === 'add' && (
        <div className="sub-panel stack">
          <StudentsChooser picked={picked} onPicked={setPicked} start={start} onStart={setStart} exclude={assignedIds} />
          <div className="row">
            <Button variant="outline" onClick={() => { setPanel(null); setPicked([]); }}>Bekor qilish</Button>
            <Button onClick={add} loading={busy} disabled={!picked.length}>Berish ({picked.length})</Button>
          </div>
        </div>
      )}
      {panel !== 'add' && <button type="button" className="link-btn link-muted" onClick={() => setPanel('edit')}>Chegirmani tahrirlash</button>}
    </Card>
  );
}

export default function Discounts() {
  const navigate = useNavigate();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBack(back);
  const discounts = useApi('/admin/discounts');
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Header title="Chegirmalar" onBack={back}
        right={!creating && <IconButton icon="plus" label="Yangi chegirma" onClick={() => setCreating(true)} />} />
      <Content>
        <p className="muted small">Bir o'quvchida bir nechta chegirma bo'lsa, ular qo'shiladi. Jami chegirma oylik summadan oshmaydi.</p>
        {creating && <DiscountForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); discounts.reload(); }} />}
        {discounts.loading && !discounts.data && <Loading />}
        {discounts.error && <ErrorBox text={discounts.error} onRetry={discounts.reload} />}
        {discounts.data?.length === 0 && !creating && (
          <EmptyState icon="tag" title="Hali chegirma yo'q" text="Markazingizdagi chegirmalarni shu yerda yarating va o'quvchilarga bering."
            action={<Button onClick={() => setCreating(true)}>Chegirma yaratish</Button>} />
        )}
        {discounts.data?.map((d) => <DiscountCard key={d.id} discount={d} onChanged={discounts.reload} />)}
      </Content>
    </>
  );
}
