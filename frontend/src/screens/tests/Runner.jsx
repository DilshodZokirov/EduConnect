import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, tg } from '../../api.js';
import { confirmDialog, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { BottomBar, Button, Content, ErrorBox, Loading, useTelegramBack } from '../../components/ui.jsx';

const backupKey = (id) => `test.answers.${id}`;

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Test ishlash ekrani: taymer, sahifadan chiqishni nazorat qilish, javoblarni avtomatik saqlash. */
export default function Runner() {
  const { tid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState({});
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(null);       // qolgan soniyalar
  const [leaves, setLeaves] = useState(0);
  const [warning, setWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const offset = useRef(0);                      // server va qurilma soati farqi
  const answersRef = useRef({});
  const finishedRef = useRef(false);
  answersRef.current = answers;

  const finish = useCallback(async (silent = false) => {
    if (finishedRef.current || !data) return;
    finishedRef.current = true;
    setBusy(true);
    try {
      await api(`/student/attempts/${data.attempt_id}/finish`, { method: 'POST', body: { answers: answersRef.current } });
      try { localStorage.removeItem(backupKey(data.attempt_id)); } catch { /* */ }
      if (!silent) toast('Test topshirildi');
      navigate(`/tests/result/${data.attempt_id}`, { replace: true });
    } catch (e) {
      finishedRef.current = false;
      setBusy(false);
      toast(e.message, 'error');
    }
  }, [data, navigate, toast]);

  // Boshlash yoki davom ettirish
  useEffect(() => {
    (async () => {
      try {
        const r = await api(`/student/tests/${tid}/start`, { method: 'POST' });
        offset.current = new Date(r.server_now) - Date.now();
        let saved = r.answers ?? {};
        try { saved = { ...saved, ...JSON.parse(localStorage.getItem(backupKey(r.attempt_id)) || '{}') }; } catch { /* */ }
        setAnswers(saved);
        setLeaves(r.leaves);
        setData(r);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [tid]);

  // Telegram'ni tasodifan yopib qo'ymaslik uchun
  useEffect(() => {
    try { tg?.enableClosingConfirmation(); } catch { /* */ }
    return () => { try { tg?.disableClosingConfirmation(); } catch { /* */ } };
  }, []);

  // Taymer
  useEffect(() => {
    if (!data) return undefined;
    const tick = () => {
      const sec = (new Date(data.deadline_at) - (Date.now() + offset.current)) / 1000;
      setLeft(sec);
      if (sec <= 0) finish(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [data, finish]);

  // Javoblarni saqlash: darhol qurilmaga, 2 soniyadan keyin serverga
  useEffect(() => {
    if (!data) return undefined;
    try { localStorage.setItem(backupKey(data.attempt_id), JSON.stringify(answers)); } catch { /* */ }
    const t = setTimeout(() => {
      api(`/student/attempts/${data.attempt_id}/answers`, { method: 'PUT', body: { answers } }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [answers, data]);

  // Sahifadan chiqishni nazorat qilish
  useEffect(() => {
    if (!data) return undefined;
    const onHide = async () => {
      if (document.visibilityState !== 'hidden' || finishedRef.current) return;
      try {
        const r = await api(`/student/attempts/${data.attempt_id}/leave`, { method: 'POST', body: { answers: answersRef.current } });
        setLeaves(r.leaves);
        if (r.finished) {
          finishedRef.current = true;
          navigate(`/tests/result/${data.attempt_id}`, { replace: true });
        } else {
          setWarning(true);
        }
      } catch { /* */ }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [data, navigate]);

  const askFinish = useCallback(async () => {
    const unanswered = data.questions.filter((q) => {
      const a = answers[String(q.id)];
      return !a || (Array.isArray(a) ? a.length === 0 : !String(a).trim());
    }).length;
    const text = unanswered
      ? `${unanswered} ta savolga javob berilmagan. Testni topshirasizmi?`
      : 'Testni topshirasizmi? Keyin javoblarni o\'zgartirib bo\'lmaydi.';
    if (await confirmDialog(text)) finish();
  }, [data, answers, finish]);
  useTelegramBack(data ? askFinish : null);

  if (error) return <Content><ErrorBox text={error} /><Button variant="outline" onClick={() => navigate('/tests', { replace: true })}>Testlarga qaytish</Button></Content>;
  if (!data) return <Loading />;

  const q = data.questions[index];
  const key = String(q.id);
  const value = answers[key];
  const setValue = (v) => setAnswers((a) => ({ ...a, [key]: v }));
  const answeredCount = data.questions.filter((x) => {
    const a = answers[String(x.id)];
    return a && (Array.isArray(a) ? a.length : String(a).trim());
  }).length;
  const urgent = left !== null && left < 60;

  return (
    <div className="screen">
      <header className="header test-header">
        <h1 className="grow">{data.test_title}</h1>
        <span className={`timer ${urgent ? 'timer-urgent' : ''}`} aria-live="polite"><Icon name="clock" size={16} /> {left === null ? '…' : fmt(left)}</span>
      </header>
      <Content>
        <div className="kv small"><b>{index + 1} / {data.questions.length} savol</b><span className="muted">Javob berildi: {answeredCount}</span></div>
        <div className="progress"><div className="progress-bar" style={{ width: `${(100 * (index + 1)) / data.questions.length}%` }} /></div>

        {warning && (
          <div className="warn-banner" role="alert">
            <Icon name="lock" size={20} />
            <div className="grow">
              <b>Sahifadan chiqdingiz ({leaves} / {data.max_leaves})</b>
              <p className="small">{data.max_leaves}-marta chiqsangiz, test avtomatik yakunlanadi va mentorga ko'rinadi.</p>
            </div>
            <button type="button" className="icon-btn" aria-label="Yopish" onClick={() => setWarning(false)}>✕</button>
          </div>
        )}

        <div className="card">
          <p className="muted small">{index + 1}-savol · {q.points} ball{q.kind === 'multiple' ? ' · bir nechta javob' : ''}</p>
          <h2 className="question-text">{q.text}</h2>
        </div>

        {q.kind === 'short' ? (
          <label className="field">
            <input className="short-answer" value={value ?? ''} placeholder="Javobingiz" onChange={(e) => setValue(e.target.value)} />
          </label>
        ) : q.options.map((o) => {
          const chosen = Array.isArray(value) && value.includes(o.id);
          return (
            <button key={o.id} type="button" className={`answer-option ${chosen ? 'on' : ''}`} aria-pressed={chosen}
              onClick={() => {
                if (q.kind === 'single') setValue([o.id]);
                else setValue(chosen ? value.filter((x) => x !== o.id) : [...(value ?? []), o.id]);
              }}>
              <span className={`mark ${q.kind === 'multiple' ? 'mark-square' : ''} ${chosen ? 'on' : ''}`} aria-hidden="true">
                {chosen && <Icon name="check" size={14} />}
              </span>
              <span>{o.text}</span>
            </button>
          );
        })}

        <div className="q-dots" aria-label="Savollar">
          {data.questions.map((x, i) => {
            const a = answers[String(x.id)];
            const done = a && (Array.isArray(a) ? a.length : String(a).trim());
            return (
              <button key={x.id} type="button" className={`q-dot ${i === index ? 'current' : ''} ${done ? 'done' : ''}`}
                aria-label={`${i + 1}-savol`} onClick={() => setIndex(i)}>{i + 1}</button>
            );
          })}
        </div>
      </Content>
      <BottomBar>
        <div className="row">
          <Button variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>Oldingi</Button>
          {index < data.questions.length - 1
            ? <Button onClick={() => setIndex((i) => i + 1)}>Keyingi</Button>
            : <Button onClick={askFinish} loading={busy}>Topshirish</Button>}
        </div>
      </BottomBar>
    </div>
  );
}
