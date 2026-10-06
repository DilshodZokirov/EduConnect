import { Chip, Field } from '../../components/ui.jsx';

export const DAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

/** "Du, Ch, Ju 14:00–16:00" <-> { days: ['Du','Ch','Ju'], start: '14:00', end: '16:00' } */
export function parseSchedule(text = '') {
  const days = DAYS.filter((d) => new RegExp(`(^|[ ,])${d}(?=[ ,]|$)`).test(text));
  const times = text.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
  return { days, start: times?.[1] ?? '14:00', end: times?.[2] ?? '16:00' };
}

export function formatSchedule({ days, start, end }) {
  if (!days.length) return null;
  const ordered = DAYS.filter((d) => days.includes(d));
  return `${ordered.join(', ')} ${start}–${end}`;
}

export function ScheduleEditor({ value, onChange }) {
  const toggle = (d) => onChange({
    ...value, days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d],
  });
  return (
    <div className="field">
      <span className="field-label">Dars kunlari va vaqti</span>
      <div className="chips">
        {DAYS.map((d) => <Chip key={d} active={value.days.includes(d)} onClick={() => toggle(d)}>{d}</Chip>)}
      </div>
      <div className="row">
        <Field type="time" aria-label="Boshlanish vaqti" value={value.start}
          onChange={(e) => onChange({ ...value, start: e.target.value })} />
        <span className="muted">–</span>
        <Field type="time" aria-label="Tugash vaqti" value={value.end}
          onChange={(e) => onChange({ ...value, end: e.target.value })} />
      </div>
    </div>
  );
}
