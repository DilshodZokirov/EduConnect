import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { toLocalInput } from '../../dates.js';
import { useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  BottomBar, Button, Card, Chip, Content, Field, Header, Loading, useTelegramBack,
} from '../../components/ui.jsx';

const KINDS = [
  { key: 'single', label: 'Bitta javob' },
  { key: 'multiple', label: 'Bir nechta javob' },
  { key: 'short', label: 'Qisqa javob' },
];
const LETTERS = 'abcdefghij';

const emptyQuestion = () => ({
  kind: 'single', text: '', points: 1,
  options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }],
  correct: [],
});

function questionError(q) {
  if (!q.text.trim()) return 'Savol matnini yozing';
  if (q.kind === 'short') return q.correct.some((c) => c.trim()) ? null : "Kamida bitta to'g'ri javob yozing";
  const filled = q.options.filter((o) => o.text.trim());
  if (filled.length < 2) return 'Kamida 2 ta variant kerak';
  if (!q.correct.length) return "To'g'ri javobni belgilang";
  if (q.correct.some((id) => !filled.find((o) => o.id === id))) return "To'g'ri javob bo'sh variantda bo'lmasin";
  return null;
}

function QuestionEditor({ index, q, onChange, onRemove }) {
  const set = (patch) => onChange({ ...q, ...patch });
  const toggleCorrect = (id) => {
    if (q.kind === 'single') set({ correct: [id] });
    else set({ correct: q.correct.includes(id) ? q.correct.filter((x) => x !== id) : [...q.correct, id] });
  };
  const changeKind = (kind) => {
    if (kind === q.kind) return;
    set({ kind, correct: kind === 'short' ? [''] : [], options: kind === 'short' ? [] : emptyQuestion().options });
  };
  const error = questionError(q);

  return (
    <Card>
      <div className="kv">
        <h3 className="item-title">{index + 1}-savol</h3>
        <button type="button" className="icon-btn icon-btn-danger" aria-label="Savolni o'chirish" onClick={onRemove}>
          <Icon name="trash" size={20} />
        </button>
      </div>
      <div className="chips">
        {KINDS.map((k) => <Chip key={k.key} active={q.kind === k.key} onClick={() => changeKind(k.key)}>{k.label}</Chip>)}
      </div>
      <label className="field">
        <textarea rows={2} value={q.text} placeholder="Savol matni" onChange={(e) => set({ text: e.target.value })} />
      </label>

      {q.kind !== 'short' && (
        <div className="stack">
          <span className="field-label">Variantlar — to'g'risini belgilang</span>
          {q.options.map((o, i) => (
            <div key={o.id} className="option-row">
              <button type="button" className={`mark ${q.kind === 'multiple' ? 'mark-square' : ''} ${q.correct.includes(o.id) ? 'on' : ''}`}
                aria-label="To'g'ri javob" aria-pressed={q.correct.includes(o.id)} onClick={() => toggleCorrect(o.id)}>
                {q.correct.includes(o.id) && <Icon name="check" size={14} />}
              </button>
              <input className="option-input" value={o.text} placeholder={`${LETTERS[i].toUpperCase()} variant`}
                onChange={(e) => set({ options: q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })} />
              {q.options.length > 2 && (
                <button type="button" className="icon-btn" aria-label="Variantni o'chirish"
                  onClick={() => set({ options: q.options.filter((x) => x.id !== o.id), correct: q.correct.filter((x) => x !== o.id) })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {q.options.length < LETTERS.length && (
            <button type="button" className="link-btn" onClick={() => {
              const used = new Set(q.options.map((o) => o.id));
              const id = [...LETTERS].find((l) => !used.has(l));
              set({ options: [...q.options, { id, text: '' }] });
            }}>+ Variant qo'shish</button>
          )}
        </div>
      )}

      {q.kind === 'short' && (
        <div className="stack">
          <span className="field-label">To'g'ri javob(lar) — har xil yozilishi bo'lsa, hammasini qo'shing</span>
          {q.correct.map((c, i) => (
            <div key={i} className="option-row">
              <input className="option-input" value={c} placeholder="To'g'ri javob"
                onChange={(e) => set({ correct: q.correct.map((x, j) => (j === i ? e.target.value : x)) })} />
              {q.correct.length > 1 && (
                <button type="button" className="icon-btn" aria-label="O'chirish"
                  onClick={() => set({ correct: q.correct.filter((_, j) => j !== i) })}>✕</button>
              )}
            </div>
          ))}
          <button type="button" className="link-btn" onClick={() => set({ correct: [...q.correct, ''] })}>+ Yana bir to'g'ri javob</button>
          <p className="muted small">Javob aynan mos kelmasa, AI ma'nosini tekshiradi.</p>
        </div>
      )}

      <div className="row">
        <label className="field score-field">
          <span className="field-label">Ball</span>
          <input type="number" min={1} max={100} value={q.points}
            onChange={(e) => set({ points: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />
        </label>
        {error && <span className="field-error grow">{error}</span>}
      </div>
    </Card>
  );
}

export default function Builder() {
  const { gid, tid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(tid ? `/g/${gid}/tests/${tid}` : `/g/${gid}/tests`), [navigate, gid, tid]);
  useTelegramBack(back);
  const existing = useApi(tid ? `/mentor/tests/${tid}` : null);
  const location = useLocation();
  const lessonId = location.state?.lessonId ?? null;
  const fromAI = !!location.state?.draft;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [minutes, setMinutes] = useState(20);
  const [opens, setOpens] = useState(() => toLocalInput(new Date()));
  const [closes, setCloses] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(23, 59, 0, 0); return toLocalInput(d); });
  const [showAnswers, setShowAnswers] = useState(true);
  const [maxLeaves, setMaxLeaves] = useState(3);
  const [maxPoints, setMaxPoints] = useState(100);
  const [pointsTouched, setPointsTouched] = useState(false);
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [busy, setBusy] = useState(false);
  const locked = tid && existing.data && existing.data.attempts.length > 0; // boshlangan testda savollar o'zgarmaydi

  useEffect(() => {
    if (!existing.data) return;
    const t = existing.data.test;
    setTitle(t.title); setDescription(t.description ?? ''); setMinutes(t.time_limit_min);
    setOpens(toLocalInput(new Date(t.opens_at))); setCloses(toLocalInput(new Date(t.closes_at)));
    setShowAnswers(t.show_answers); setMaxLeaves(t.max_leaves); setMaxPoints(t.max_points ?? 100); setPointsTouched(true);
    setQuestions(existing.data.questions.map((q) => ({ kind: q.kind, text: q.text, points: q.points, options: q.options, correct: q.correct })));
  }, [existing.data]);

  // "Topshiriq berish" oynasidan AI qoralamasi bilan kelgan bo'lsa — maydonlarni to'ldiramiz
  useEffect(() => {
    const d = location.state?.draft;
    if (!d || tid) return;
    setTitle(d.title ?? '');
    setDescription(d.description ?? '');
    if (d.suggested_minutes) setMinutes(Math.min(300, d.suggested_minutes));
    if (d.suggested_days) {
      const c = new Date(); c.setDate(c.getDate() + d.suggested_days); c.setHours(23, 59, 0, 0); setCloses(toLocalInput(c));
    }
    if (d.questions?.length) {
      setQuestions(d.questions.map((q) => ({
        kind: q.kind, text: q.text, points: q.points,
        options: q.kind === 'short' ? [] : q.options,
        correct: q.kind === 'short' ? (q.correct.length ? q.correct : ['']) : q.correct,
      })));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Haftalik test ballari: shu hafta (dushanba–yakshanba) testlari jami 100 balldan oshmaydi
  const opensIso = (() => { const d = new Date(opens); return Number.isNaN(d.getTime()) ? null : d.toISOString(); })();
  const budget = useApi(opensIso ? `/mentor/groups/${gid}/tests/week-budget?at=${encodeURIComponent(opensIso)}${tid ? `&exclude=${tid}` : ''}` : null);
  const left = budget.data?.left ?? 100;
  useEffect(() => {
    if (!pointsTouched && budget.data && !tid) setMaxPoints(Math.max(1, budget.data.left || 1));
  }, [budget.data, pointsTouched, tid]);
  const pointsError = maxPoints > left ? `Bu haftada faqat ${left} ball qolgan` : (left === 0 ? "Bu haftaning 100 balli band" : undefined);

  const total = questions.reduce((a, q) => a + q.points, 0);
  const invalid = questions.findIndex((q) => questionError(q));
  const windowError = new Date(closes) <= new Date(opens) ? "Yopilish vaqti ochilishdan keyin bo'lsin" : undefined;
  const ready = title.trim().length >= 2 && minutes >= 1 && !windowError && invalid === -1 && !pointsError && maxPoints >= 1;

  async function save() {
    setBusy(true);
    try {
      const body = {
        title: title.trim(), description: description.trim() || null, time_limit_min: minutes,
        lesson_id: existing.data?.test.lesson_id ?? lessonId,
        opens_at: new Date(opens).toISOString(), closes_at: new Date(closes).toISOString(),
        show_answers: showAnswers, max_leaves: maxLeaves, max_points: maxPoints,
        questions: questions.map((q) => ({
          kind: q.kind, text: q.text.trim(), points: q.points,
          options: q.kind === 'short' ? [] : q.options.filter((o) => o.text.trim()).map((o) => ({ id: o.id, text: o.text.trim() })),
          correct: q.correct.map((c) => c.trim()).filter(Boolean),
        })),
      };
      const t = tid
        ? await api(`/mentor/tests/${tid}`, { method: 'PUT', body })
        : await api(`/mentor/groups/${gid}/tests`, { method: 'POST', body });
      toast(tid ? 'Saqlandi' : "Test yaratildi. Ochilish vaqtida o'quvchilarga xabar boradi");
      navigate(`/g/${gid}/tests/${t.id}`, { replace: true });
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  if (tid && existing.loading && !existing.data) return <><Header title="Test" onBack={back} /><Loading /></>;

  return (
    <>
      <Header title={tid ? 'Testni tahrirlash' : 'Yangi test'} onBack={back} />
      <Content>
        {fromAI && !tid && (
          <div className="ai-box"><p className="small"><Icon name="sparkle" size={16} /> AI savollarni tayyorladi. Har birini tekshirib, kerak bo'lsa tuzating.</p></div>
        )}
        <Field label="Test nomi" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Test nomi" />
        <label className="field">
          <span className="field-label">Izoh (ixtiyoriy)</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O'quvchilar uchun qisqa ko'rsatma" />
        </label>
        <div className="row">
          <Field label="Ochiladi" type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
          <Field label="Yopiladi" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} error={windowError} />
        </div>
        <div className="row">
          <Field label="Vaqt (daqiqa)" type="number" min={1} max={300} value={minutes} disabled={!!locked}
            onChange={(e) => setMinutes(Math.max(1, Math.min(300, Number(e.target.value) || 1)))} />
          <div className="field">
            <span className="field-label">Sahifadan chiqishlar chegarasi</span>
            <div className="chips">{[2, 3, 5].map((n) => <Chip key={n} active={maxLeaves === n} onClick={() => setMaxLeaves(n)}>{n}</Chip>)}</div>
          </div>
        </div>
        <Card>
          <div className="row">
            <Field label="Bu test necha ballik" type="number" min={1} max={100} value={maxPoints} error={pointsError}
              onChange={(e) => { setPointsTouched(true); setMaxPoints(Math.max(1, Math.min(100, Number(e.target.value) || 1))); }} />
            <div className="grow week-budget">
              <span className="field-label">Shu hafta testlari</span>
              <div className="progress"><div className={`progress-bar ${left < maxPoints ? 'progress-partial' : ''}`}
                style={{ width: `${Math.min(100, (budget.data?.used ?? 0) + maxPoints)}%` }} /></div>
              <span className="muted small">{budget.data?.used ?? 0} ball band · {Math.max(0, left - maxPoints)} qoladi (jami 100)</span>
            </div>
          </div>
          {budget.data?.tests?.length > 0 && (
            <p className="muted small">Shu haftada: {budget.data.tests.map((t) => `${t.title} — ${t.max_points}`).join(', ')}</p>
          )}
          <p className="muted small">Haftasiga jami 100 ball: bitta 100 ballik test yoki bir nechta kichik test (masalan, 40 + 30 + 30).</p>
        </Card>
        <label className="check-row toggle-card">
          <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} />
          <span className={`check-box ${showAnswers ? 'on' : ''}`} aria-hidden="true">{showAnswers && <Icon name="check" size={16} />}</span>
          <span className="check-text">
            <b>Javoblarni darhol ko'rsatish</b>
            <span className="muted small">O'quvchi testni tugatishi bilan to'g'ri javoblarni ko'radi. O'chirilsa — test yopilgandan keyin.</span>
          </span>
        </label>

        <div className="section-head">
          <h2 className="section-title">Savollar ({questions.length})</h2>
          <span className="muted small">Jami: {total} ball → 100 ballga keltiriladi</span>
        </div>
        {locked && <p className="error-box">Testni o'quvchilar boshlagan — savollarni o'zgartirib bo'lmaydi. Faqat vaqt va sozlamalar saqlanadi.</p>}
        {questions.map((q, i) => (
          <fieldset key={i} disabled={!!locked} className="plain-fieldset">
            <QuestionEditor index={i} q={q}
              onChange={(nq) => setQuestions((list) => list.map((x, j) => (j === i ? nq : x)))}
              onRemove={() => setQuestions((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : list))} />
          </fieldset>
        ))}
        {!locked && <Button variant="outline" onClick={() => setQuestions((l) => [...l, emptyQuestion()])}>+ Savol qo'shish</Button>}
      </Content>
      <BottomBar>
        {invalid !== -1 && <p className="field-error center">{invalid + 1}-savolni to'ldiring</p>}
        <Button onClick={save} loading={busy} disabled={!ready}>{tid ? 'Saqlash' : 'Testni yaratish'}</Button>
      </BottomBar>
    </>
  );
}
