import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Card, Content, ErrorBox, Header, Loading, useTelegramBack } from '../../components/ui.jsx';

const REASON = {
  timeout: 'Vaqt tugagani uchun test avtomatik topshirildi.',
  left_page: 'Sahifadan ko\'p marta chiqilgani uchun test avtomatik yakunlandi.',
};

function answerText(q, ans) {
  if (q.kind === 'short') return ans || '—';
  const ids = Array.isArray(ans) ? ans : [];
  return ids.length ? q.options.filter((o) => ids.includes(o.id)).map((o) => o.text).join(', ') : '—';
}

export default function Result() {
  const { aid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/tests', { replace: true }), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/student/attempts/${aid}/result`);

  useEffect(() => {
    if (!data?.ai_pending) return undefined;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data, reload]);

  if (loading && !data) return <><Header title="Natija" onBack={back} /><Loading /></>;
  if (error) return <><Header title="Natija" onBack={back} /><Content><ErrorBox text={error} onRetry={reload} /></Content></>;

  const tone = data.score >= 80 ? 'good' : data.score >= 60 ? 'mid' : 'low';
  return (
    <>
      <Header title="Test natijasi" onBack={back} />
      <Content>
        <div className={`score-hero score-${tone}`}>
          <p className="small">{data.test_title}</p>
          <b className="score-big">{data.points ?? '—'}</b>
          <span className="small">/ {data.max_points} ball{data.score !== null ? ` · ${data.score}%` : ''}</span>
          {data.ai_pending && <p className="small">Qisqa javoblar tekshirilmoqda — ball biroz o'zgarishi mumkin…</p>}
        </div>
        {REASON[data.finish_reason] && <p className="error-box">{REASON[data.finish_reason]}</p>}
        {!data.answers_visible && <p className="muted small center">To'g'ri javoblar test yopilgandan keyin ko'rsatiladi.</p>}

        {data.questions.map((q, i) => {
          const status = q.is_correct === null ? 'pending' : q.is_correct ? 'ok' : 'bad';
          return (
            <Card key={q.id} className={`result-q result-${status}`}>
              <div className="kv small">
                <b>{i + 1}-savol</b>
                <span className="result-mark">
                  {status === 'ok' && <><Icon name="check" size={16} /> {q.earned} / {q.points}</>}
                  {status === 'bad' && <>✕ 0 / {q.points}</>}
                  {status === 'pending' && 'Tekshirilmoqda'}
                </span>
              </div>
              <p className="question-text-sm">{q.text}</p>
              <p className="small"><span className="muted">Sizning javobingiz:</span> {answerText(q, q.your_answer)}</p>
              {data.answers_visible && q.correct && status !== 'ok' && (
                <p className="small correct-line">
                  <span className="muted">To'g'ri javob:</span> {q.kind === 'short' ? q.correct.join(' / ') : answerText(q, q.correct)}
                </p>
              )}
            </Card>
          );
        })}
      </Content>
    </>
  );
}
