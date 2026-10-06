import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatPhone, money } from '../../api.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button, Card, Chip, Content, EmptyState, ErrorBox, Field, Header, IconButton, Loading, MoneyField, Pill,
  SearchField, useTelegramBack,
} from '../../components/ui.jsx';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const monthName = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const size = (d) => (d.kind === 'percent' ? `${d.value}%` : `${money(d.value)} so'm`);
const duration = (d) => (d.months ? `${d.months} oy` : 'Muddatsiz');

function DiscountForm({ initial, onSaved, onCancel }) {
  const toast = useToast();
  const groups = useApi('/admin/groups');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [conditions, setConditions] = useState(initial?.conditions ?? '');
  const [kind, setKind] = useState(initial?.kind ?? null);          // admin o'zi tanlaydi
  const [value, setValue] = useState(initial?.value ?? 0);
  const [months, setMonths] = useState(initial ? initial.months : undefined); // undefined — hali tanlanmagan
  const [groupIds, setGroupIds] = useState(initial?.groups.map((g) => g.id) ?? []);
  const [busy, setBusy] = useState(false);

  const percentError = kind === 'percent' && (value < 1 || value > 100) ? '1 dan 100 gacha' : undefined;

  async function save(isActive = true) {
    setBusy(true);
    try {
      const body = {
        name: name.trim(), description: description.trim() || null, conditions: conditions.trim(),
        kind, value, months, group_ids: groupIds,
      };
      const saved = initial
        ? await api(`/admin/discounts/${initial.id}`, { method: 'PUT', body: { ...body, is_active: isActive } })
        : await api('/admin/discounts', { method: 'POST', body });
      toast(initial ? (isActive ? 'Saqlandi' : 'Chegirma arxivlandi') : 'Chegirma yaratildi');
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
      <label className="field">
        <span className="field-label">Kimlarga beriladi</span>
        <textarea rows={3} value={conditions} onChange={(e) => setConditions(e.target.value)}
          placeholder="Qaysi o'quvchilarga va qanday shartlar asosida berilishi" />
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
          <Chip active={groupIds.length === 0} onClick={() => setGroupIds([])}>Barcha guruhlar</Chip>
          {groups.data?.map((g) => <Chip key={g.id} active={groupIds.includes(g.id)} onClick={() => toggleGroup(g.id)}>{g.name}</Chip>)}
        </div>
      </div>
      {initial && <p className="muted small">O'zgarishlar faqat keyingi hisob-kitoblarga ta'sir qiladi. O'tgan oylar o'zgarmaydi.</p>}
      <div className="row">
        <Button variant="outline" onClick={onCancel}>Bekor qilish</Button>
        <Button onClick={() => save(true)} loading={busy}
          disabled={name.trim().length < 2 || conditions.trim().length < 3 || !kind || !value || !!percentError || months === undefined}>
          Saqlash
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

function AssignForm({ discount, onDone }) {
  const toast = useToast();
  const students = useApi('/admin/users?role=student&status=active&limit=200');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [start, setStart] = useState('current');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (students.data ?? []).filter((s) => !t || `${s.first_name} ${s.last_name} ${s.phone}`.toLowerCase().includes(t)).slice(0, 8);
  }, [students.data, q]);

  async function assign() {
    setBusy(true);
    try {
      await api(`/admin/discounts/${discount.id}/assign`, {
        method: 'POST', body: { student_id: picked.id, start, note: note.trim() || null },
      });
      toast(`${picked.first_name} ${picked.last_name}ga «${discount.name}» berildi`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="stack sub-panel">
      {discount.conditions && <p className="small info-note"><b>Shart:</b> {discount.conditions}</p>}
      {picked ? (
        <div className="kv">
          <b>{picked.first_name} {picked.last_name}</b>
          <button type="button" className="link-btn" onClick={() => setPicked(null)}>Boshqasini tanlash</button>
        </div>
      ) : (
        <>
          <SearchField value={q} onChange={setQ} placeholder="O'quvchi ismi yoki telefoni" />
          {students.loading ? <Loading /> : (
            <div className="check-list">
              {list.map((s) => (
                <button key={s.id} type="button" className="list-row list-row-btn" onClick={() => setPicked(s)}>
                  <span className="grow"><b>{s.first_name} {s.last_name}</b><span className="muted small block">{formatPhone(s.phone)}</span></span>
                  <Icon name="right" size={18} />
                </button>
              ))}
              {list.length === 0 && <p className="muted small center pad">Topilmadi</p>}
            </div>
          )}
        </>
      )}
      <div className="chips">
        <Chip active={start === 'current'} onClick={() => setStart('current')}>Joriy oydan</Chip>
        <Chip active={start === 'next'} onClick={() => setStart('next')}>Keyingi oydan</Chip>
      </div>
      <Field placeholder="Izoh (ixtiyoriy)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button onClick={assign} loading={busy} disabled={!picked}>Chegirmani berish</Button>
      <p className="muted small">Shu oydan boshlab to'lanmagan to'lovlar darhol qayta hisoblanadi. Ota-onaga xabar boradi.</p>
    </div>
  );
}

function DiscountCard({ discount, onChanged }) {
  const [panel, setPanel] = useState(null); // assign | edit
  if (panel === 'edit') {
    return <DiscountForm initial={discount} onCancel={() => setPanel(null)} onSaved={() => { setPanel(null); onChanged(); }} />;
  }
  return (
    <Card className={discount.is_active ? '' : 'card-dim'}>
      <div className="kv">
        <div>
          <h3 className="item-title">{discount.name}</h3>
          {discount.description && <p className="muted small">{discount.description}</p>}
          {discount.conditions && <p className="small"><b>Kimlarga:</b> {discount.conditions}</p>}
        </div>
        <span className="discount-size">{size(discount)}</span>
      </div>
      <div className="chips">
        <Pill tone="grey">{duration(discount)}</Pill>
        <Pill tone="grey">{discount.all_groups ? 'Barcha guruhlar' : discount.groups.map((g) => g.name).join(', ')}</Pill>
        <Pill>{discount.active_count} o'quvchida</Pill>
        {!discount.is_active && <Pill tone="warn">Arxivlangan</Pill>}
      </div>
      <div className="chips">
        {discount.is_active && <Chip active={panel === 'assign'} onClick={() => setPanel(panel === 'assign' ? null : 'assign')}>O'quvchiga berish</Chip>}
        <Chip onClick={() => setPanel('edit')}>Tahrirlash</Chip>
      </div>
      {panel === 'assign' && <AssignForm discount={discount} onDone={() => { setPanel(null); onChanged(); }} />}
    </Card>
  );
}

export default function Discounts() {
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate('/payments'), [navigate]);
  useTelegramBack(back);
  const discounts = useApi('/admin/discounts');
  const assignments = useApi('/admin/discounts/assignments');
  const [creating, setCreating] = useState(false);

  const reloadAll = () => { discounts.reload(); assignments.reload(); };

  async function stop(a) {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const text = a.start_period > thisMonth
      ? `«${a.discount.name}» hali boshlanmagan — bekor qilinsinmi?`
      : `${a.student.first_name} ${a.student.last_name} uchun «${a.discount.name}» shu oy oxirida to'xtatilsinmi?`;
    if (!(await confirmDialog(text))) return;
    try {
      await api(`/admin/discounts/assignments/${a.id}/stop`, { method: 'POST' });
      toast("Chegirma to'xtatildi");
      reloadAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <Header title="Chegirmalar" onBack={back}
        right={!creating && <IconButton icon="plus" label="Yangi chegirma" onClick={() => setCreating(true)} />} />
      <Content>
        <p className="muted small">Bir o'quvchida bir nechta chegirma bo'lsa, ular qo'shiladi. Jami chegirma oylik summadan oshmaydi.</p>
        {creating && <DiscountForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); reloadAll(); }} />}
        {discounts.loading && !discounts.data && <Loading />}
        {discounts.error && <ErrorBox text={discounts.error} onRetry={discounts.reload} />}
        {discounts.data?.length === 0 && !creating && (
          <EmptyState icon="tag" title="Hali chegirma yo'q" text="Markazingizdagi chegirmalarni shu yerda yarating va o'quvchilarga bering."
            action={<Button onClick={() => setCreating(true)}>Chegirma yaratish</Button>} />
        )}
        {discounts.data?.map((d) => <DiscountCard key={d.id} discount={d} onChanged={reloadAll} />)}

        <h2 className="section-title">Amaldagi chegirmalar</h2>
        {assignments.data?.length === 0 && <p className="muted small">Hozircha hech kimda chegirma yo'q.</p>}
        {assignments.data?.length > 0 && (
          <Card className="card-flush">
            {assignments.data.map((a) => (
              <div key={a.id} className="list-row">
                <div className="grow">
                  <b>{a.student.first_name} {a.student.last_name}</b>
                  <p className="muted small">
                    {a.discount.name} · {size(a.discount)} · {monthName(a.start_period)}
                    {a.end_period ? ` – ${monthName(a.end_period)}` : ' dan, muddatsiz'}
                  </p>
                </div>
                <button type="button" className="mini-btn" onClick={() => stop(a)}>To'xtatish</button>
              </div>
            ))}
          </Card>
        )}
      </Content>
    </>
  );
}
