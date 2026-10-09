import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, initials } from '../../api.js';
import { formatDateTime } from '../../dates.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar, Card, Chip, Content, EmptyState, ErrorBox, Header, IconButton, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';
import { ScorePill } from '../homework/shared.jsx';

function windowState(t) {
  const now = new Date();
  if (now < new Date(t.opens_at)) return { text: `Ochiladi: ${formatDateTime(t.opens_at)}`, tone: 'grey' };
  if (now > new Date(t.closes_at)) return { text: 'Yopilgan', tone: 'grey' };
  return { text: `Ochiq · ${formatDateTime(t.closes_at)} gacha`, tone: 'blue' };
}

export function MentorTestList() {
  const { gid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/mentor/groups/${gid}/tests`);

  return (
    <>
      <Header title="Testlar" onBack={back}
        right={<IconButton icon="plus" label="Yangi test" onClick={() => navigate(`/g/${gid}/tests/new`)} />} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="test" title="Hali test yo'q" text="Yuqoridagi + tugmasi orqali test tuzing." />}
        {data?.map((t) => {
          const w = windowState(t);
          return (
            <button key={t.id} type="button" className="card card-link" onClick={() => navigate(`/g/${gid}/tests/${t.id}`)}>
              <div className="row">
                <div className="grow">
                  <p className="muted small">{t.max_points} ball · {t.question_count} ta savol · {t.time_limit_min} daqiqa</p>
                  <h3 className="item-title">{t.title}</h3>
                </div>
                <Icon name="right" size={18} />
              </div>
              <div className="chips">
                <Pill tone={w.tone}>{w.text}</Pill>
                <Pill tone="grey">Topshirdi: {t.finished} / {t.total}</Pill>
                {t.average !== null && <Pill>O'rtacha: {t.average}</Pill>}
              </div>
            </button>
          );
        })}
      </Content>
    </>
  );
}

const REASON = { timeout: 'vaqt tugadi', left_page: "sahifadan chiqdi — avtomatik yakunlandi", submitted: '' };

export function MentorTestDetail() {
  const { gid, tid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(`/g/${gid}/tests`), [navigate, gid]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/mentor/tests/${tid}`);
  const [tab, setTab] = useState('results');

  async function retake(a) {
    if (!(await confirmDialog(`${a.student.first_name} ${a.student.last_name}ga testni qayta topshirishga ruxsat berilsinmi? Yangi natija hisobga olinadi.`))) return;
    try {
      await api(`/mentor/tests/${tid}/retake/${a.student.id}`, { method: 'POST' });
      toast("Ruxsat berildi — o'quvchiga xabar yuborildi");
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function remove() {
    if (!(await confirmDialog("Test o'chirilsinmi? Barcha natijalar ham o'chadi."))) return;
    try {
      await api(`/mentor/tests/${tid}`, { method: 'DELETE' });
      toast("Test o'chirildi");
      back();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (loading && !data) return <><Header title="Test" onBack={back} /><Loading /></>;
  if (error) return <><Header title="Test" onBack={back} /><Content><ErrorBox text={error} onRetry={reload} /></Content></>;
  const t = data.test;
  const w = windowState(t);

  return (
    <>
      <Header title="Test natijalari" onBack={back} />
      <Content>
        <div className="hero-card">
          <p className="hero-label">{t.max_points} ballik · {t.question_count} ta savol · {t.time_limit_min} daqiqa</p>
          <h2 className="hero-title">{t.title}</h2>
          <p className="hero-sub">{w.text}</p>
          <p className="hero-sub">Topshirdi: {t.finished} / {t.total}{t.average !== null ? ` · O'rtacha ball: ${t.average}` : ''}</p>
          <button type="button" className="hero-btn" onClick={() => navigate(`/g/${gid}/tests/${tid}/edit`)}>Tahrirlash</button>
        </div>

        <div className="chips">
          <Chip active={tab === 'results'} onClick={() => setTab('results')}>Natijalar ({data.attempts.length})</Chip>
          <Chip active={tab === 'missing'} onClick={() => setTab('missing')}>Topshirmagan ({data.missing.length})</Chip>
          <Chip active={tab === 'stats'} onClick={() => setTab('stats')}>Savollar tahlili</Chip>
        </div>

        {tab === 'results' && (data.attempts.length === 0
          ? <p className="muted small center pad">Hali hech kim topshirmagan</p>
          : (
            <Card className="card-flush">
              {data.attempts.map((a) => (
                <div key={a.id} className="list-row">
                  <Avatar text={initials(a.student)} size={36} />
                  <div className="grow">
                    <b>{a.student.first_name} {a.student.last_name}</b>
                    <p className="muted small">
                      {a.finished_at ? formatDateTime(a.finished_at) : 'Hozir ishlamoqda…'}
                      {a.attempt_no > 1 ? ` · ${a.attempt_no}-urinish` : ''}
                      {a.leaves > 0 ? ` · sahifadan chiqdi: ${a.leaves}` : ''}
                      {a.finish_reason && REASON[a.finish_reason] ? ` · ${REASON[a.finish_reason]}` : ''}
                    </p>
                  </div>
                  <div className="pill-stack">
                    {a.ai_pending ? <Pill tone="grey">AI tekshirmoqda</Pill> : (
                      a.points !== null && a.points !== undefined
                        ? <Pill tone={a.score >= 80 ? 'blue' : a.score >= 60 ? 'grey' : 'warn'}>{a.points} / {t.max_points}</Pill>
                        : null
                    )}
                    {a.finished_at && (a.retake_granted
                      ? <Pill tone="grey">Qayta ruxsat berilgan</Pill>
                      : <button type="button" className="mini-btn" onClick={() => retake(a)}>Qayta topshirish</button>)}
                  </div>
                </div>
              ))}
            </Card>
          ))}

        {tab === 'missing' && (data.missing.length === 0
          ? <p className="muted small center pad">Hamma topshirdi 🎉</p>
          : (
            <Card className="card-flush">
              {data.missing.map((u) => (
                <div key={u.id} className="list-row"><Avatar text={initials(u)} size={36} /><b className="grow">{u.first_name} {u.last_name}</b></div>
              ))}
            </Card>
          ))}

        {tab === 'stats' && (
          <Card className="card-flush">
            {data.stats.map((s) => (
              <div key={s.question_id} className="list-row">
                <div className="grow">
                  <b className="small">{s.position}. {s.text}</b>
                  <div className="progress progress-sm">
                    <div className={`progress-bar ${s.correct_rate !== null && s.correct_rate < 50 ? 'progress-partial' : ''}`}
                      style={{ width: `${s.correct_rate ?? 0}%` }} />
                  </div>
                </div>
                <span className="percent">{s.correct_rate === null ? '—' : `${s.correct_rate}%`}</span>
              </div>
            ))}
          </Card>
        )}
        {tab === 'stats' && <p className="muted small">Foiz — savolga to'g'ri javob berganlar ulushi. Past foizli savollarni darsda qayta tushuntirish foydali.</p>}

        <button type="button" className="link-btn link-danger" onClick={remove}>Testni o'chirish</button>
      </Content>
    </>
  );
}
