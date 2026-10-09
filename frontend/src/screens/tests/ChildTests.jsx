import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDateTime } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import { Card, Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';

const STATUS = {
  waiting: { text: 'Hali topshirilmagan', tone: 'grey' },
  done: { text: 'Topshirildi', tone: 'blue' },
  missed: { text: "O'tkazib yuborilgan", tone: 'warn' },
};

export function ChildTestsSummary({ childId }) {
  const navigate = useNavigate();
  const { data } = useApi(`/parent/children/${childId}/tests`);
  if (!data?.length) return null;
  const done = data.filter((t) => t.score != null);
  const avg = done.length ? Math.round(done.reduce((a, t) => a + t.score, 0) / done.length) : null; // o'rtacha natija, %
  const missed = data.filter((t) => t.status === 'missed').length;
  return (
    <button type="button" className="card card-link" onClick={() => navigate(`/child/${childId}/tests`)}>
      <div className="kv"><h3 className="item-title">Testlar</h3><span className="link-btn">Hammasi</span></div>
      <div className="stats3">
        <div><b className="stat-num">{avg ?? '—'}</b><span className="muted small">O'rtacha natija, %</span></div>
        <div><b className="stat-num">{done.length}</b><span className="muted small">Topshirilgan</span></div>
        <div><b className={`stat-num ${missed ? 'warn-text' : ''}`}>{missed}</b><span className="muted small">O'tkazilgan</span></div>
      </div>
    </button>
  );
}

export default function ChildTests() {
  const { cid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/parent/children/${cid}/tests`);

  return (
    <>
      <Header title="Testlar" onBack={back} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="test" title="Hali test bo'lmagan" />}
        {data?.map((t) => (
          <Card key={t.id}>
            <div className="kv">
              <div>
                <p className="muted small">{t.group_name} · muddat {formatDateTime(t.closes_at)}</p>
                <h3 className="item-title">{t.title}</h3>
              </div>
              {t.points != null && <Pill tone={t.score >= 80 ? 'blue' : t.score >= 60 ? 'grey' : 'warn'}>{t.points} / {t.max_points}</Pill>}
            </div>
            <div className="chips">
              <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].text}</Pill>
              {t.leaves > 0 && <Pill tone="grey">Sahifadan chiqqan: {t.leaves}</Pill>}
            </div>
          </Card>
        ))}
      </Content>
    </>
  );
}
