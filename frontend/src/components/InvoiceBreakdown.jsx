import { money } from '../api.js';

/** Chegirmalar bo'lsa: asosiy summa, har bir chegirma qatori va yakuniy summa. */
export default function InvoiceBreakdown({ invoice }) {
  if (!invoice.discounts?.length) return null;
  return (
    <div className="breakdown">
      <div className="kv small"><span className="muted">Kurs narxi</span><span>{money(invoice.base_amount)} so'm</span></div>
      {invoice.discounts.map((d, i) => (
        <div key={i} className="kv small discount-line">
          <span>🎁 {d.name}{d.kind === 'percent' ? ` (−${d.value}%)` : ''}</span>
          <span>−{money(d.amount)}</span>
        </div>
      ))}
      <div className="kv small"><b>To'lash kerak</b><b>{money(invoice.amount)} so'm</b></div>
    </div>
  );
}
