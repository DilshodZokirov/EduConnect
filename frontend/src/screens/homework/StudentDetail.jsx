import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiUpload } from '../../api.js';
import { formatDateTime, timeLeft } from '../../dates.js';
import { useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button, Card, Content, ErrorBox, Header, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';
import { AnswerText, CriteriaList, ScorePill, SubmissionImages, TaskFileButton } from './shared.jsx';
import CodeTask from './CodeTask.jsx';

const MAX_IMAGES = 5;

function SubmitForm({ assignment, onSubmitted }) {
  const toast = useToast();
  const prev = assignment.submission;
  const [text, setText] = useState(prev?.text ?? '');
  const [isCode, setIsCode] = useState(prev?.is_code ?? false);
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();

  function addImages(list) {
    const next = [...images, ...Array.from(list)].slice(0, MAX_IMAGES);
    if (images.length + list.length > MAX_IMAGES) toast(`Ko'pi bilan ${MAX_IMAGES} ta rasm`, 'error');
    setImages(next);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function submit() {
    setBusy(true);
    try {
      const form = new FormData();
      if (text.trim()) form.append('text', text.trim());
      form.append('is_code', isCode ? 'true' : 'false');
      images.forEach((f) => form.append('files', f));
      const updated = await apiUpload(`/student/assignments/${assignment.id}/submit`, form);
      toast('Javob topshirildi. AI izohi bir necha soniyada chiqadi');
      setImages([]);
      onSubmitted(updated);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="item-title">{prev ? 'Qayta topshirish' : 'Javob'}</h3>
      {prev && <p className="muted small">Yangi javob avvalgisining o'rniga qabul qilinadi{prev.files.length ? ' (eski rasmlar o\'chadi)' : ''}.</p>}
      <label className="field">
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)}
          className={isCode ? 'code-input' : ''} placeholder={isCode ? 'Kodni shu yerga joylang' : 'Javobingizni yozing'} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={isCode} onChange={(e) => setIsCode(e.target.checked)} />
        <span className={`check-box ${isCode ? 'on' : ''}`} aria-hidden="true">{isCode && <Icon name="check" size={16} />}</span>
        <span className="check-text"><b>Bu kod</b></span>
      </label>
      <label className="file-pick">
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={(e) => addImages(e.target.files)} />
        <Icon name="camera" size={22} />
        <span>{images.length ? `${images.length} ta rasm tanlandi` : `Daftar yoki ekran rasmini qo'shish (${MAX_IMAGES} tagacha)`}</span>
      </label>
      {images.length > 0 && (
        <div className="chips">
          {images.map((f, i) => (
            <button key={i} type="button" className="chip" onClick={() => setImages((l) => l.filter((_, j) => j !== i))}>
              {f.name.slice(0, 18)} ✕
            </button>
          ))}
        </div>
      )}
      <Button onClick={submit} loading={busy} disabled={!text.trim() && !images.length}>Topshirish</Button>
    </Card>
  );
}

function Result({ sub }) {
  const checking = ['pending', 'checking'].includes(sub.ai_status);
  return (
    <Card>
      <div className="kv">
        <h3 className="item-title">Mening javobim</h3>
        {sub.final_score !== null ? <ScorePill score={sub.final_score} /> : <Pill tone="grey">Mentor baholaydi</Pill>}
      </div>
      <p className="muted small">Topshirildi: {formatDateTime(sub.submitted_at)}{sub.late ? ' · kech topshirildi' : ''}</p>
      <AnswerText text={sub.text} isCode={sub.is_code} />
      <SubmissionImages files={sub.files} />

      {checking && <p className="ai-box small"><span className="spinner" /> AI javobingizni tekshirmoqda…</p>}
      {sub.ai_feedback && (
        <div className="ai-box">
          <p className="small"><Icon name="sparkle" size={16} /> <b>Dastlabki izoh</b></p>
          <p className="small">{sub.ai_feedback}</p>
          <CriteriaList items={sub.ai_comments} withPoints={sub.final_score !== null} />
          {sub.final_score === null && <p className="muted small">Bahoni mentor tasdiqlagach ko'rasiz. Xatolarni tuzatib, qayta topshirishingiz mumkin.</p>}
        </div>
      )}
      {sub.mentor_comment && (
        <div className="mentor-box"><p className="small"><b>Mentor izohi:</b> {sub.mentor_comment}</p></div>
      )}
    </Card>
  );
}

export default function StudentDetail() {
  const { aid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/homework'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload, setData } = useApi('/student/assignments');
  const a = data?.find((x) => String(x.id) === aid);

  // AI tekshirayotgan paytda natijani kutib turamiz
  const checking = a?.submission && ['pending', 'checking'].includes(a.submission.ai_status);
  useEffect(() => {
    if (!checking) return undefined;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [checking, reload]);

  if (loading && !data) return <><Header title="Vazifa" onBack={back} /><Loading /></>;
  if (error || !a) return <><Header title="Vazifa" onBack={back} /><Content><ErrorBox text={error ?? 'Vazifa topilmadi'} onRetry={reload} /></Content></>;

  const canSubmit = a.status !== 'graded';

  return (
    <>
      <Header title="Uy vazifasi" onBack={back} />
      <Content>
        <div className="hero-card">
          <p className="hero-label">{a.group_name} · {a.lesson_title}</p>
          <h2 className="hero-title">{a.title}</h2>
          <p className="hero-sub">Muddat: {formatDateTime(a.due_at)} · {timeLeft(a.due_at)}</p>
        </div>
        <Card>
          <p className="pre-wrap">{a.description}</p>
          <TaskFileButton assignmentId={a.id} fileName={a.file_name} />
          <h3 className="item-title">Baholash mezonlari</h3>
          <p className="pre-wrap muted small">{a.criteria}</p>
        </Card>
        {a.kind === 'code' && (
          <CodeTask assignment={a} onSubmitted={(u) => setData((list) => list.map((x) => (x.id === u.id ? u : x)))} />
        )}
        {a.submission && <Result sub={a.submission} />}
        {canSubmit && a.kind !== 'code' && (
          <SubmitForm assignment={a}
            onSubmitted={(u) => setData((list) => list.map((x) => (x.id === u.id ? u : x)))} />
        )}
        {a.status === 'overdue' && <p className="muted small center">Muddat o'tgan, lekin hali ham topshirishingiz mumkin — javob «kech topshirildi» deb belgilanadi.</p>}
      </Content>
    </>
  );
}
