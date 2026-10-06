import { useMemo, useState } from 'react';
import { formatPhone } from '../../api.js';
import { CheckRow, SearchField } from '../../components/ui.jsx';

/** O'quvchilarni qidirib, belgilab tanlash ro'yxati. */
export default function StudentPicker({ students, selected, onChange, exclude = [] }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return students
      .filter((s) => !exclude.includes(s.id))
      .filter((s) => !term || `${s.first_name} ${s.last_name} ${s.phone}`.toLowerCase().includes(term));
  }, [students, q, exclude]);

  const toggle = (id, on) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));

  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="O'quvchi qidirish..." />
      <div className="check-list">
        {list.map((s) => (
          <CheckRow key={s.id} checked={selected.includes(s.id)} onChange={(on) => toggle(s.id, on)}
            title={`${s.first_name} ${s.last_name}`} sub={formatPhone(s.phone)} />
        ))}
        {list.length === 0 && <p className="muted small center pad">
          {students.length ? 'Hech kim topilmadi' : "Faol o'quvchi yo'q. Avval so'rovlarda kimgadir o'quvchi rolini bering."}
        </p>}
      </div>
    </>
  );
}
