import { useState } from 'react';
import { initials } from '../api.js';
import { formatDate } from '../dates.js';
import { useApi } from '../hooks.jsx';
import { Avatar, Chip, EmptyState, ErrorBox, Loading } from './ui.jsx';

const PERIODS = [
  { key: 'week:0', label: 'Shu hafta' },
  { key: 'week:-1', label: "O'tgan hafta" },
  { key: 'month:0', label: 'Shu oy' },
  { key: 'month:-1', label: "O'tgan oy" },
];
const PLACE = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));

/** Guruh reytingi: hamma ko'radi; 1-o'rin oltin, 2-kumush, 3-bronza, qolganlari bir xil rangda. */
export default function RatingBoard({ groupId, highlightId, highlightLabel = 'siz' }) {
  const [period, setPeriod] = useState('week:0');
  const [p, offset] = period.split(':');
  const { data, error, loading, reload } = useApi(`/rating/groups/${groupId}?period=${p}&offset=${offset}`);

  const heroes = data?.last_month_heroes ?? [];
  return (
    <div className="stack">
      {heroes.length > 0 && (
        <div className="hero-month">
          <span className="hero-month-cup" aria-hidden="true">🏆</span>
          <div className="grow">
            <p className="hero-month-label">{data.last_month.charAt(0).toUpperCase() + data.last_month.slice(1)} oyi faxri</p>
            {heroes.map((h) => (
              <div key={h.student.id} className="hero-month-row">
                <Avatar text={initials(h.student)} size={40} />
                <div className="grow">
                  <b>{h.student.first_name} {h.student.last_name}{h.student.id === highlightId ? ` (${highlightLabel})` : ''}</b>
                  <span className="hero-month-points">{fmt(h.points)} ball · guruhda 1-o'rin</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="chips chips-scroll">
        {PERIODS.map((x) => <Chip key={x.key} active={period === x.key} onClick={() => setPeriod(x.key)}>{x.label}</Chip>)}
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox text={error} onRetry={reload} />}
      {data && (
        <>
          <p className="muted small">
            {formatDate(data.period_start, false)} — {formatDate(data.period_end, false)} · eng ko'pi {fmt(data.max_points)} ball
            {data.homework_count ? ` (${data.homework_count} ta vazifa + testlar)` : ''}
          </p>
          {data.pending > 0 && <p className="muted small">⏳ {data.pending} ta javob hali baholanmagan — ballar tasdiqlangach qo'shiladi.</p>}
          {data.max_points === 0 ? (
            <EmptyState icon="trophy" title="Bu davrda hali vazifa yoki test yo'q" />
          ) : (
            <div className="rating-list">
              {data.rows.map((r) => {
                const medal = PLACE[r.rank];
                const me = r.student.id === highlightId;
                return (
                  <div key={r.student.id} className={`rating-row ${medal ? `rank-${medal}` : ''} ${me ? 'rating-me' : ''}`}>
                    <span className={`rank-badge ${medal ? `badge-${medal}` : ''}`}>{r.rank}</span>
                    <Avatar text={initials(r.student)} size={36} />
                    <div className="grow">
                      <b>{r.student.first_name} {r.student.last_name}{me ? ` (${highlightLabel})` : ''}</b>
                      <p className="muted small">
                        Vazifa {fmt(r.homework_points)} · Test {fmt(r.test_points)}
                        {r.medals > 0 ? ` · 🏅 ${r.medals}` : ''}
                      </p>
                    </div>
                    <div className="rating-score">
                      <b>{fmt(r.points)}</b>
                      {r.delta ? <span className={r.delta > 0 ? 'delta-up' : 'delta-down'}>{r.delta > 0 ? `▲ ${r.delta}` : `▼ ${-r.delta}`}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
