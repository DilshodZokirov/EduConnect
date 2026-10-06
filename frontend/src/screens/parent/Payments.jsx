import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { money } from '../../api.js';
import { formatDate, todayISO } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import InvoiceBreakdown from '../../components/InvoiceBreakdown.jsx';
import { Card, Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';
import { STATUS } from '../admin/Payments.jsx';

const METHOD = { cash: 'Naqd', card: 'Karta', transfer: "O'tkazma" };
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function daysLeft(due) {
  const ms = new Date(`${due}T00:00:00`) - new Date(`${todayISO()}T00:00:00`);
  return Math.round(ms / 86400000);
}

/** Ota-ona bosh sahifasidagi ogohlantirish: joriy to'lanmagan summa. */
export function PaymentAlert({ childId }) {
  const navigate = useNavigate();
  const { data } = useApi(`/parent/children/${childId}/invoices`);
  const unpaid = data?.filter((i) => i.status !== 'paid') ?? [];
  if (!unpaid.length) return null;
  const left = unpaid.reduce((a, i) => a + i.amount - i.paid_amount, 0);
  const nearest = unpaid.reduce((a, i) => (i.due_date < a.due_date ? i : a));
  const d = daysLeft(nearest.due_date);
  const when = d > 0 ? `${d} kun qoldi` : d === 0 ? 'bugun oxirgi kun' : "muddati o'tgan";

  return (
    <button type="button" className="card card-warn card-link pay-alert" onClick={() => navigate(`/child/${childId}/payments`)}>
      <span className="pay-icon"><Icon name="wallet" size={22} /></span>
      <span className="grow">
        <b>To'lov: {money(left)} so'm</b>
        <span className="small block">Muddat {formatDate(nearest.due_date, false)} — {when}</span>
      </span>
      <Icon name="right" size={18} />
    </button>
  );
}

export function ChildPayments() {
  const { cid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/parent/children/${cid}/invoices`);

  return (
    <>
      <Header title="To'lovlar" onBack={back} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="wallet" title="Hali to'lovlar yo'q" />}
        {data?.map((i) => {
          const left = i.amount - i.paid_amount;
          const st = STATUS[i.status];
          return (
            <Card key={i.id}>
              <div className="kv">
                <div>
                  <p className="muted small">{i.group_name}</p>
                  <h3 className="item-title">{MONTHS[Number(i.period.slice(5, 7)) - 1]} oyi</h3>
                </div>
                <div className="pill-stack">
                  <b>{money(i.amount)} so'm</b>
                  <Pill tone={st.tone}>{st.text}</Pill>
                </div>
              </div>
              <InvoiceBreakdown invoice={i} />
              {i.lessons_count && <p className="muted small">Oy o'rtasida qo'shilgan: {i.lessons_count} ta dars uchun hisoblangan ({i.lessons_total} tadan)</p>}
              {left > 0 && (
                <p className="small">
                  {i.paid_amount > 0 && <>To'langan: {money(i.paid_amount)} · </>}
                  <b>Qoldiq: {money(left)} so'm</b> · muddat {formatDate(i.due_date, false)}
                  {i.overdue && <> · <span className="warn-text">muddati o'tgan</span></>}
                </p>
              )}
              {i.note && <p className="muted small">Izoh: {i.note}</p>}
              {i.payments?.length > 0 && (
                <div className="pay-history">
                  {i.payments.map((p) => (
                    <div key={p.id} className="kv small">
                      <span className="muted">{new Date(p.created_at).toLocaleDateString('ru-RU')} · {METHOD[p.method] ?? p.method}</span>
                      <b>+{money(p.amount)}</b>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {data?.length > 0 && (
          <p className="muted small center">To'lovni istalgan vaqtda, bir necha oy oldindan ham o'quv markaz administratoriga qilishingiz mumkin. Har oy uchun oxirgi muddat — o'sha oyning 10-sanasi.</p>
        )}
      </Content>
    </>
  );
}
