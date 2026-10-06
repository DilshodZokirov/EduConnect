import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money } from '../../api.js';
import { formatDate } from '../../dates.js';
import { useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import InvoiceBreakdown from '../../components/InvoiceBreakdown.jsx';
import {
  Button, Card, Chip, Content, EmptyState, ErrorBox, Field, Header, IconButton, Loading, MoneyField, Pill, SearchField,
} from '../../components/ui.jsx';

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const METHODS = [{ key: 'cash', label: 'Naqd' }, { key: 'card', label: 'Karta' }, { key: 'transfer', label: "O'tkazma" }];
const FILTERS = [{ key: '', label: 'Hammasi' }, { key: 'debt', label: 'Qarzdorlar' }, { key: 'paid', label: "To'langan" }];

export const STATUS = {
  paid: { text: "To'langan", tone: 'blue' },
  partial: { text: 'Qisman', tone: 'warn' },
  unpaid: { text: "To'lanmagan", tone: 'warn' },
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

function PaymentForm({ invoice, onSaved }) {
  const toast = useToast();
  const left = invoice.amount - invoice.paid_amount;
  const [amount, setAmount] = useState(left);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const updated = await api(`/admin/invoices/${invoice.id}/payments`, {
        method: 'POST', body: { amount, method, note: note.trim() || null },
      });
      toast(`${money(amount)} so'm qabul qilindi. Ota-onaga xabar yuborildi`);
      onSaved(updated);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="stack sub-panel">
      <MoneyField label="To'lov summasi" value={amount} onChange={setAmount}
        error={amount > left ? `Qoldiqdan ko'p (${money(left)} so'm)` : undefined} />
      <div className="chips">
        {METHODS.map((m) => <Chip key={m.key} active={method === m.key} onClick={() => setMethod(m.key)}>{m.label}</Chip>)}
      </div>
      <Field placeholder="Izoh (ixtiyoriy), masalan: chek raqami" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button onClick={save} loading={busy} disabled={!amount || amount > left}>To'lovni qabul qilish</Button>
    </div>
  );
}

function AdjustForm({ invoice, onSaved }) {
  const toast = useToast();
  const [amount, setAmount] = useState(invoice.amount);
  const [due, setDue] = useState(invoice.due_date);
  const [note, setNote] = useState(invoice.note ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = { note: note.trim() };
      if (amount !== invoice.amount) body.amount = amount;
      if (due !== invoice.due_date) body.due_date = due;
      const updated = await api(`/admin/invoices/${invoice.id}`, { method: 'PATCH', body });
      toast(body.due_date ? 'Muhlat berildi — ilova ochiq qoladi' : "Summa o'zgartirildi");
      onSaved(updated);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="stack sub-panel">
      <MoneyField label="Summa" value={amount} onChange={setAmount} />
      <Field label="Oxirgi muddat (muhlat)" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <Field label="Sababi" placeholder="Masalan: chegirma / 15-sanada to'lashini aytdi"
        value={note} onChange={(e) => setNote(e.target.value)} />
      <Button onClick={save} loading={busy}
        disabled={note.trim().length < 2 || (amount === invoice.amount && due === invoice.due_date)}>Saqlash</Button>
    </div>
  );
}

function PrepayForm({ invoice, onSaved }) {
  const toast = useToast();
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const paid = await api('/admin/invoices/prepay', {
        method: 'POST',
        body: { student_id: invoice.student.id, group_id: invoice.group_id, months, method },
      });
      const sum = paid.reduce((a, i) => a + i.amount, 0);
      toast(`${paid.length} oy uchun ${money(sum)} so'm qabul qilindi`);
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="stack sub-panel">
      <p className="muted small">Joriy oydan boshlab to'lanmagan oylar to'liq yopiladi.</p>
      <div className="chips">
        {[1, 2, 3, 6].map((n) => <Chip key={n} active={months === n} onClick={() => setMonths(n)}>{n} oy</Chip>)}
      </div>
      <div className="chips">
        {METHODS.map((m) => <Chip key={m.key} active={method === m.key} onClick={() => setMethod(m.key)}>{m.label}</Chip>)}
      </div>
      <Button onClick={save} loading={busy}>Oldindan to'lovni qabul qilish</Button>
    </div>
  );
}

function InvoiceCard({ invoice, onChanged, onReload }) {
  const [panel, setPanel] = useState(null); // pay | prepay | adjust
  const left = invoice.amount - invoice.paid_amount;
  const st = STATUS[invoice.status];

  return (
    <Card>
      <button type="button" className="row row-btn" onClick={() => setPanel(panel ? null : (left > 0 ? 'pay' : 'prepay'))}>
        <div className="grow">
          <h3 className="item-title">{invoice.student.first_name} {invoice.student.last_name}</h3>
          <p className="muted small">{invoice.group_name} · muddat {formatDate(invoice.due_date, false)}</p>
        </div>
        <div className="pill-stack">
          <b>{money(invoice.amount)}</b>
          <Pill tone={st.tone}>{st.text}</Pill>
          {invoice.overdue && <Pill tone="warn">🔒 Bloklangan</Pill>}
          {invoice.payer_missing && <Pill tone="grey">Ota-ona bog'lanmagan</Pill>}
        </div>
      </button>
      {invoice.lessons_count && (
        <p className="muted small">Oy o'rtasida qo'shilgan: {invoice.lessons_count} / {invoice.lessons_total} dars uchun</p>
      )}
      <InvoiceBreakdown invoice={invoice} />
      {invoice.status === 'partial' && <p className="small">To'langan: {money(invoice.paid_amount)} · <b>Qoldiq: {money(left)} so'm</b></p>}
      {invoice.note && <p className="muted small">Izoh: {invoice.note}</p>}
      {panel && (
        <div className="chips">
          {left > 0 && <Chip active={panel === 'pay'} onClick={() => setPanel('pay')}>To'lov qabul qilish</Chip>}
          <Chip active={panel === 'prepay'} onClick={() => setPanel('prepay')}>Oldindan (bir necha oy)</Chip>
          <Chip active={panel === 'adjust'} onClick={() => setPanel('adjust')}>Summa / muhlat</Chip>
        </div>
      )}
      {panel === 'pay' && left > 0 && <PaymentForm invoice={invoice} onSaved={(u) => { onChanged(u); setPanel(null); }} />}
      {panel === 'prepay' && <PrepayForm invoice={invoice} onSaved={() => { setPanel(null); onReload(); }} />}
      {panel === 'adjust' && <AdjustForm invoice={invoice} onSaved={(u) => { onChanged(u); setPanel(null); }} />}
      {panel && invoice.payer_missing && (
        <p className="muted small">Bu o'quvchiga ota-ona bog'lanmagan va u "o'zi vasiy" emas — to'lov eslatmalari hech kimga bormaydi.</p>
      )}
    </Card>
  );
}

export default function Payments() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [filter, setFilter] = useState('debt');
  const [q, setQ] = useState('');
  const { data, error, loading, reload, setData } = useApi(`/admin/invoices?period=${iso(month)}`);

  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const all = data ?? [];
  const term = q.trim().toLowerCase();
  const list = all
    .filter((i) => (filter === 'debt' ? i.status !== 'paid' : filter ? i.status === filter : true))
    .filter((i) => !term || `${i.student.first_name} ${i.student.last_name} ${i.group_name}`.toLowerCase().includes(term));

  const expected = all.reduce((a, i) => a + i.amount, 0);
  const received = all.reduce((a, i) => a + i.paid_amount, 0);
  const debtors = all.filter((i) => i.status !== 'paid').length;

  return (
    <>
      <Header title="To'lovlar"
        right={<IconButton icon="tag" label="Chegirmalar" onClick={() => navigate('/payments/discounts')} />} />
      <Content>
        <div className="month-switch">
          <button type="button" className="icon-btn" aria-label="Oldingi oy" onClick={() => shift(-1)}><Icon name="back" /></button>
          <b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
          <button type="button" className="icon-btn" aria-label="Keyingi oy" onClick={() => shift(1)}><Icon name="right" /></button>
        </div>

        {data && (
          <Card>
            <div className="stats3">
              <div><b className="stat-num-sm">{money(expected)}</b><span className="muted small">Kutilgan</span></div>
              <div><b className="stat-num-sm">{money(received)}</b><span className="muted small">Tushgan</span></div>
              <div><b className="stat-num-sm warn-text">{money(expected - received)}</b><span className="muted small">Qarz ({debtors})</span></div>
            </div>
            {expected > 0 && (
              <div className="progress"><div className="progress-bar" style={{ width: `${Math.round((100 * received) / expected)}%` }} /></div>
            )}
          </Card>
        )}

        <SearchField value={q} onChange={setQ} placeholder="O'quvchi yoki guruh" />
        <div className="chips">
          {FILTERS.map((f) => <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</Chip>)}
        </div>

        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data && all.length === 0 && (
          <EmptyState icon="wallet" title="Bu oy uchun to'lovlar yo'q"
            text="Guruhga oylik narx qo'yilsa, to'lovlar avtomatik yaratiladi." />
        )}
        {data && all.length > 0 && list.length === 0 && (
          <p className="muted small center pad">{filter === 'debt' ? "Qarzdor yo'q 🎉" : 'Hech narsa topilmadi'}</p>
        )}
        {list.map((i) => (
          <InvoiceCard key={i.id} invoice={i} onReload={reload}
            onChanged={(u) => setData((all2) => all2.map((x) => (x.id === u.id ? { ...u, payer_missing: x.payer_missing } : x)))} />
        ))}
      </Content>
    </>
  );
}
