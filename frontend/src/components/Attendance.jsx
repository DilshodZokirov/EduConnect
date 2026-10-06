import { formatDate } from '../dates.js';
import { Card, Pill } from './ui.jsx';

export const ATT_LABEL = { present: 'Keldi', absent: 'Kelmadi', late: 'Kechikdi' };
const ATT_TONE = { present: 'blue', absent: 'warn', late: 'grey' };

/** Davomat statistikasi: kech qolgan ham "kelgan" hisoblanadi. */
export function summarize(items = []) {
  const c = { present: 0, absent: 0, late: 0 };
  items.forEach((a) => { c[a.status] += 1; });
  const total = items.length;
  return { ...c, total, percent: total ? Math.round((100 * (c.present + c.late)) / total) : null };
}

/** Oxirgi darslar: rangli doirachalar. Eng eskisi chapda. */
export function AttendanceDots({ items = [], count = 6 }) {
  const last = items.slice(0, count).reverse();
  if (!last.length) return <p className="muted small">Hali yo'qlama bo'lmagan.</p>;
  return (
    <div className="dots">
      {last.map((a) => (
        <div key={a.lesson_id} className="dot-col" title={`${a.lesson_title}: ${ATT_LABEL[a.status]}`}>
          <span className={`dot dot-${a.status}`} aria-label={ATT_LABEL[a.status]}>
            {a.status === 'absent' ? '—' : a.status === 'late' ? '!' : '✓'}
          </span>
          <span className="dot-date">{a.lesson_date.slice(8, 10)}.{a.lesson_date.slice(5, 7)}</span>
        </div>
      ))}
    </div>
  );
}

export function AttendanceList({ items = [] }) {
  if (!items.length) return <p className="muted small">Hali yo'qlama bo'lmagan.</p>;
  return (
    <Card className="card-flush">
      {items.map((a) => (
        <div key={a.lesson_id} className="list-row">
          <div className="grow">
            <b>{a.lesson_title}</b>
            <p className="muted small">{formatDate(a.lesson_date)} · {a.group_name}</p>
          </div>
          <Pill tone={ATT_TONE[a.status]}>{ATT_LABEL[a.status]}</Pill>
        </div>
      ))}
    </Card>
  );
}

export function AttendanceStats({ items }) {
  const s = summarize(items);
  return (
    <div className="stats3">
      <div><b className="stat-num">{s.percent === null ? '—' : `${s.percent}%`}</b><span className="muted small">Davomat</span></div>
      <div><b className="stat-num">{s.absent}</b><span className="muted small">Qoldirgan</span></div>
      <div><b className="stat-num">{s.late}</b><span className="muted small">Kechikkan</span></div>
    </div>
  );
}
