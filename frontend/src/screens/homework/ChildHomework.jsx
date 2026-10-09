import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDateTime } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import { Card, Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';
import { ScorePill } from './shared.jsx';

const STATUS = {
  waiting: { text: 'Bajarilmoqda', tone: 'grey' },
  submitted: { text: 'Topshirildi, baholanmoqda', tone: 'grey' },
  graded: { text: 'Baholandi', tone: 'blue' },
  missing: { text: 'Topshirilmagan', tone: 'warn' },
};

/** Ota-ona bosh sahifasidagi qisqa ko'rinish. */
export function ChildHomeworkSummary({ childId }) {
  const navigate = useNavigate();
  const { data } = useApi(`/parent/children/${childId}/homework`);
  if (!data?.length) return null;
  const graded = data.filter((h) => h.final_score != null);
  const avg = graded.length ? Math.round(graded.reduce((a, h) => a + h.final_score, 0) / graded.length) : null;
  const missing = data.filter((h) => h.status === 'missing').length;
  return (
    <button type="button" className="card card-link" onClick={() => navigate(`/child/${childId}/homework`)}>
      <div className="kv"><h3 className="item-title">Uy vazifalari</h3><span className="link-btn">Hammasi</span></div>
      <div className="stats3">
        <div><b className="stat-num">{avg ?? '—'}</b><span className="muted small">O'rtacha baho</span></div>
        <div><b className="stat-num">{graded.length}</b><span className="muted small">Baholangan</span></div>
        <div><b className={`stat-num ${missing ? 'warn-text' : ''}`}>{missing}</b><span className="muted small">Topshirilmagan</span></div>
      </div>
    </button>
  );
}

export default function ChildHomework() {
  const { cid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/parent/children/${cid}/homework`);

  return (
    <>
      <Header title="Uy vazifalari" onBack={back} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="test" title="Hali uy vazifasi berilmagan" />}
        {data?.map((h) => (
          <Card key={h.id}>
            <div className="kv">
              <div>
                <p className="muted small">{h.group_name} · muddat {formatDateTime(h.due_at)}</p>
                <h3 className="item-title">{h.title}</h3>
              </div>
              <ScorePill score={h.final_score} />
            </div>
            <div className="chips">
              <Pill tone={STATUS[h.status].tone}>{STATUS[h.status].text}</Pill>
              {h.late && <Pill tone="warn">Kech topshirildi</Pill>}
            </div>
            {h.mentor_comment && <p className="small"><b>Mentor izohi:</b> {h.mentor_comment}</p>}
          </Card>
        ))}
      </Content>
    </>
  );
}
