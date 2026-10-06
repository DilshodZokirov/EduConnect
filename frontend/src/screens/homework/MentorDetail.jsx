import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, initials } from '../../api.js';
import { formatDateTime } from '../../dates.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar, Button, Card, Chip, Content, ErrorBox, Header, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';
import { AnswerText, CriteriaList, ScorePill, SubmissionImages, TaskFileButton } from './shared.jsx';

const NEEDS_MENTOR = ['review', 'failed', 'manual'];
const AI_LABEL = {
  pending: { text: 'AI navbatda…', tone: 'grey' },
  checking: { text: 'AI tekshirmoqda…', tone: 'grey' },
  done: { text: 'AI baholadi', tone: 'blue' },
  review: { text: "Mentor ko'rishi kerak", tone: 'warn' },
  failed: { text: 'AI xatosi', tone: 'warn' },
  manual: { text: 'Qo\'lda baholang', tone: 'warn' },
};

function GradeForm({ sub, onSaved }) {
  const toast = useToast();
  const [score, setScore] = useState(sub.final_score ?? sub.ai_score ?? '');
  const [comment, setComment] = useState(sub.mentor_comment ?? '');
  const [busy, setBusy] = useState(false);
  const valid = score !== '' && Number(score) >= 0 && Number(score) <= 100;

  async function save() {
    setBusy(true);
    try {
      onSaved(await api(`/mentor/submissions/${sub.id}/grade`, {
        method: 'POST', body: { score: Number(score), comment: comment.trim() || null },
      }));
      toast('Baho qo\'yildi');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack sub-panel">
      <div className="row">
        <label className="field score-field">
          <span className="field-label">Baho (0–100)</span>
          <input type="number" inputMode="numeric" min={0} max={100} value={score}
            onChange={(e) => setScore(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))} />
        </label>
        <Button onClick={save} loading={busy} disabled={!valid}>{sub.final_score === null ? 'Tasdiqlash' : 'Yangilash'}</Button>
      </div>
      <label className="field">
        <span className="field-label">Mentor izohi (ixtiyoriy)</span>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="O'quvchiga qo'shimcha izoh" />
      </label>
    </div>
  );
}

function SubmissionCard({ sub, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(sub.final_score === null && NEEDS_MENTOR.includes(sub.ai_status));
  const ai = AI_LABEL[sub.ai_status];

  async function recheck() {
    try {
      onChanged(await api(`/mentor/submissions/${sub.id}/recheck`, { method: 'POST' }));
      toast('AI qayta tekshiradi');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <Card>
      <button type="button" className="row row-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Avatar text={initials(sub.student)} size={40} />
        <div className="grow">
          <b>{sub.student.first_name} {sub.student.last_name}</b>
          <p className="muted small">{formatDateTime(sub.submitted_at)}{sub.attempt > 1 ? ` · ${sub.attempt}-urinish` : ''}</p>
        </div>
        <div className="pill-stack">
          {sub.final_score !== null ? <ScorePill score={sub.final_score} /> : (
            <>
              <Pill tone={ai.tone}>{ai.text}</Pill>
              {sub.ai_score !== null && <span className="muted small">AI: {sub.ai_score}</span>}
            </>
          )}
          {sub.late && <Pill tone="warn">Kech topshirildi</Pill>}
        </div>
      </button>
      {open && (
        <>
          <AnswerText text={sub.text} isCode={sub.is_code} />
          <SubmissionImages files={sub.files} />
          {sub.ai_feedback && (
            <div className="ai-box">
              <p className="small"><Icon name="sparkle" size={16} /> <b>AI izohi</b>{sub.ai_score !== null ? ` · ${sub.ai_score} ball` : ''}</p>
              <p className="small">{sub.ai_feedback}</p>
              <CriteriaList items={sub.ai_criteria} />
            </div>
          )}
          {sub.ai_status === 'failed' && <button type="button" className="link-btn" onClick={recheck}>AI'ga qayta tekshirtirish</button>}
          <GradeForm sub={sub} onSaved={(s) => { onChanged(s); setOpen(false); }} />
        </>
      )}
    </Card>
  );
}

export default function MentorDetail() {
  const { gid, aid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(`/g/${gid}/homework`), [navigate, gid]);
  useTelegramBack(back);

  const { data, error, loading, reload, setData } = useApi(`/mentor/assignments/${aid}`);
  const [filter, setFilter] = useState('review');
  const [showTask, setShowTask] = useState(false);
  const [busy, setBusy] = useState(false);

  // AI tekshirayotgan javoblar bo'lsa — holatni yangilab turamiz
  const checking = data?.submissions.some((s) => ['pending', 'checking'].includes(s.ai_status));
  useEffect(() => {
    if (!checking) return undefined;
    const t = setInterval(reload, 6000);
    return () => clearInterval(t);
  }, [checking, reload]);

  async function approveAll() {
    if (!(await confirmDialog(`AI ishonch bilan bergan ${data.assignment.to_approve} ta baho tasdiqlansinmi?`))) return;
    setBusy(true);
    try {
      setData(await api(`/mentor/assignments/${aid}/approve-ai`, { method: 'POST' }));
      toast('Baholar tasdiqlandi');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmDialog("Vazifa o'chirilsinmi? O'quvchilar javoblari ham o'chadi."))) return;
    try {
      await api(`/mentor/assignments/${aid}`, { method: 'DELETE' });
      toast("Vazifa o'chirildi");
      back();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (loading && !data) return <><Header title="Vazifa" onBack={back} /><Loading /></>;
  if (error) return <><Header title="Vazifa" onBack={back} /><Content><ErrorBox text={error} onRetry={reload} /></Content></>;

  const a = data.assignment;
  const subs = data.submissions;
  const groups = {
    review: subs.filter((s) => s.final_score === null && ['review', 'failed', 'manual', 'pending', 'checking'].includes(s.ai_status)),
    approve: subs.filter((s) => s.final_score === null && s.ai_status === 'done'),
    graded: subs.filter((s) => s.final_score !== null),
  };
  const shown = filter === 'missing' ? [] : groups[filter];
  const replace = (s) => setData((d) => ({ ...d, submissions: d.submissions.map((x) => (x.id === s.id ? s : x)) }));

  return (
    <>
      <Header title="Uy vazifasi" onBack={back} />
      <Content>
        <div className="hero-card">
          <p className="hero-label">Muddat: {formatDateTime(a.due_at)}</p>
          <h2 className="hero-title">{a.title}</h2>
          <p className="hero-sub">Topshirdi: {a.submitted} / {a.total} · Baholandi: {a.graded}</p>
          <button type="button" className="hero-btn" onClick={() => setShowTask((v) => !v)}>{showTask ? 'Yopish' : 'Topshiriq va mezonlar'}</button>
        </div>
        {showTask && (
          <Card>
            <p className="pre-wrap">{a.description}</p>
            <TaskFileButton assignmentId={a.id} fileName={a.file_name} />
            <h3 className="item-title">Mezonlar</h3>
            <p className="pre-wrap muted">{a.criteria}</p>
            <button type="button" className="link-btn link-danger" onClick={remove}>Vazifani o'chirish</button>
          </Card>
        )}

        <div className="chips chips-scroll">
          <Chip active={filter === 'review'} onClick={() => setFilter('review')}>Ko'rish kerak ({groups.review.length})</Chip>
          <Chip active={filter === 'approve'} onClick={() => setFilter('approve')}>AI baholadi ({groups.approve.length})</Chip>
          <Chip active={filter === 'graded'} onClick={() => setFilter('graded')}>Baholangan ({groups.graded.length})</Chip>
          <Chip active={filter === 'missing'} onClick={() => setFilter('missing')}>Topshirmagan ({data.missing.length})</Chip>
        </div>

        {filter === 'approve' && groups.approve.length > 0 && (
          <Button onClick={approveAll} loading={busy}>Ishonchli AI baholarini tasdiqlash ({groups.approve.length})</Button>
        )}
        {filter !== 'missing' && shown.length === 0 && <p className="muted small center pad">Bu bo'limda javob yo'q</p>}
        {shown.map((s) => <SubmissionCard key={s.id} sub={s} onChanged={replace} />)}

        {filter === 'missing' && (data.missing.length === 0
          ? <p className="muted small center pad">Hamma topshirdi 🎉</p>
          : (
            <Card className="card-flush">
              {data.missing.map((u) => (
                <div key={u.id} className="list-row"><Avatar text={initials(u)} size={36} /><b className="grow">{u.first_name} {u.last_name}</b></div>
              ))}
            </Card>
          ))}
      </Content>
    </>
  );
}
