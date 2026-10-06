import { useMemo, useState } from 'react';
import { ATT_LABEL, summarize } from './Attendance.jsx';
import Icon from './Icon.jsx';

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const WEEK = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
const pad = (n) => String(n).padStart(2, '0');

/** Oylik davomat kalendari: har bir dars kuni rangli, pastida oy bo'yicha foiz. */
export default function AttendanceCalendar({ items = [] }) {
  const [month, setMonth] = useState(() => {
    const d = items[0] ? new Date(`${items[0].lesson_date}T00:00:00`) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const key = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
  const monthItems = useMemo(() => items.filter((a) => a.lesson_date.startsWith(key)), [items, key]);
  const byDay = useMemo(() => {
    const m = {};
    monthItems.forEach((a) => { (m[Number(a.lesson_date.slice(8, 10))] ??= []).push(a); });
    return m;
  }, [monthItems]);
  const stats = summarize(monthItems);

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (month.getDay() + 6) % 7; // dushanbadan boshlanadi
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const today = new Date();
  const isToday = (d) => d && today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth() && today.getDate() === d;
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="calendar">
      <div className="month-switch">
        <button type="button" className="icon-btn" aria-label="Oldingi oy" onClick={() => shift(-1)}><Icon name="back" /></button>
        <b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
        <button type="button" className="icon-btn" aria-label="Keyingi oy" onClick={() => shift(1)}><Icon name="right" /></button>
      </div>
      <div className="cal-grid">
        {WEEK.map((w) => <span key={w} className="cal-head">{w}</span>)}
        {cells.map((d, i) => {
          const recs = d ? byDay[d] : null;
          // Bir kunda bir nechta dars bo'lsa — eng yomon holat ko'rsatiladi
          const st = recs && (recs.some((r) => r.status === 'absent') ? 'absent' : recs.some((r) => r.status === 'late') ? 'late' : 'present');
          return (
            <span key={i} className={`cal-cell ${st ? `dot-${st}` : ''} ${isToday(d) ? 'cal-today' : ''}`}
              title={recs ? recs.map((r) => `${r.lesson_title}: ${ATT_LABEL[r.status]}`).join('\n') : undefined}>
              {d ?? ''}
            </span>
          );
        })}
      </div>
      <div className="cal-legend">
        <span><i className="dot-present" />Keldi {stats.present}</span>
        <span><i className="dot-late" />Kechikdi {stats.late}</span>
        <span><i className="dot-absent" />Kelmadi {stats.absent}</span>
      </div>
      <p className="center"><b>{stats.percent === null ? "Bu oyda yo'qlama yo'q" : `Oy bo'yicha davomat: ${stats.percent}%`}</b></p>
    </div>
  );
}
