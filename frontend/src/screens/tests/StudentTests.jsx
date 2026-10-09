import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateTime, timeLeft } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import { Button, Card, Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';

const STATUS = {
  open: { text: 'Ochiq', tone: 'blue' },
  in_progress: { text: 'Davom etmoqda', tone: 'warn' },
  upcoming: { text: 'Hali ochilmagan', tone: 'grey' },
  done: { text: 'Topshirildi', tone: 'grey' },
  missed: { text: "O'tkazib yuborilgan", tone: 'warn' },
};

export default function StudentTests() {
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi('/student/tests');

  return (
    <>
      <Header title="Testlar" onBack={back} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="test" title="Hali test yo'q" />}
        {data?.map((t) => (
          <Card key={t.id}>
            <div className="kv">
              <div>
                <p className="muted small">{t.group_name} · {t.max_points} ball · {t.question_count} ta savol · {t.time_limit_min} daqiqa</p>
                <h3 className="item-title">{t.title}</h3>
              </div>
              {t.status === 'done' && t.points !== null && <Pill tone={t.score >= 80 ? 'blue' : t.score >= 60 ? 'grey' : 'warn'}>{t.points} / {t.max_points}</Pill>}
            </div>
            <div className="chips">
              <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].text}</Pill>
              {t.status === 'upcoming' && <Pill tone="grey">{formatDateTime(t.opens_at)} da ochiladi</Pill>}
              {(t.status === 'open' || t.status === 'in_progress') && <Pill tone="grey">Yopilishigacha: {timeLeft(t.closes_at)}</Pill>}
            </div>
            {t.can_start && (
              <Button onClick={() => navigate(`/tests/${t.id}/take`)}>
                {t.status === 'in_progress' ? 'Davom ettirish' : t.status === 'done' ? 'Qayta topshirish' : 'Testni boshlash'}
              </Button>
            )}
            {t.status === 'done' && t.attempt_id && (
              <button type="button" className="link-btn" onClick={() => navigate(`/tests/result/${t.attempt_id}`)}>Natijani ko'rish</button>
            )}
          </Card>
        ))}
      </Content>
    </>
  );
}
