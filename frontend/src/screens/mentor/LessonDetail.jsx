import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, apiUpload } from '../../api.js';
import { formatDate } from '../../dates.js';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import {
  expiryLabel, formatDuration, formatSize, openMaterial, sendToTelegram, uploadVideo,
} from '../../materials.js';
import Icon from '../../components/Icon.jsx';
import { AssignmentCard } from '../homework/MentorList.jsx';
import {
  Button, Card, Chip, Content, ErrorBox, Field, Header, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';

const BUSY_STATUSES = ['uploading', 'processing', 'encoding'];
const KIND_ICON = { file: 'file', link: 'globe', video: 'video', telegram: 'file' };

function EditLesson({ lesson, onSaved }) {
  const toast = useToast();
  const [title, setTitle] = useState(lesson.title);
  const [date, setDate] = useState(lesson.lesson_date);
  const [description, setDescription] = useState(lesson.description ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const updated = await api(`/mentor/lessons/${lesson.id}`, {
        method: 'PATCH', body: { title: title.trim(), lesson_date: date, description: description.trim() || null },
      });
      toast('Saqlandi');
      onSaved(updated);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Card>
      <Field label="Mavzu" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Field label="Sana" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="field">
        <span className="field-label">Tavsif</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <Button onClick={save} loading={busy} disabled={!title.trim()}>Saqlash</Button>
    </Card>
  );
}

function FilePick({ inputRef, accept, file, onFile, hint }) {
  return (
    <label className="file-pick">
      <input ref={inputRef} type="file" accept={accept} onChange={(e) => onFile(e.target.files[0] ?? null)} />
      <Icon name="upload" size={22} />
      <span>{file ? `${file.name} (${formatSize(file.size)})` : hint}</span>
    </label>
  );
}

function AddMaterial({ lessonId, onAdded }) {
  const toast = useToast();
  const [mode, setMode] = useState('file'); // file | video | link
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const inputRef = useRef();

  function reset() {
    setName(''); setUrl(''); setFile(null); setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function switchMode(m) {
    if (busy) return;
    setMode(m);
    reset();
  }

  async function submit() {
    setBusy(true);
    try {
      let material;
      if (mode === 'file') {
        const form = new FormData();
        form.append('file', file);
        if (name.trim()) form.append('name', name.trim());
        material = await apiUpload(`/mentor/lessons/${lessonId}/materials/upload`, form);
        toast('Fayl yuklandi');
      } else if (mode === 'video') {
        setProgress(0);
        material = await uploadVideo(lessonId, file, name.trim(), setProgress);
        toast("Video yuklandi. Endi u siqilmoqda — tayyor bo'lgach o'quvchilarga xabar boradi");
      } else {
        material = await api(`/mentor/lessons/${lessonId}/materials`, {
          method: 'POST', body: { name: name.trim() || url.trim(), url: url.trim() },
        });
        toast("Havola qo'shildi");
      }
      reset();
      onAdded(material);
    } catch (e) {
      toast(e.message, 'error');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  const validUrl = /^https?:\/\/\S+\.\S+/.test(url.trim());
  const ready = mode === 'link' ? validUrl : !!file;

  return (
    <Card>
      <h3 className="item-title">Material qo'shish</h3>
      <div className="chips">
        <Chip active={mode === 'file'} onClick={() => switchMode('file')}>Fayl</Chip>
        <Chip active={mode === 'video'} onClick={() => switchMode('video')}>Video</Chip>
        <Chip active={mode === 'link'} onClick={() => switchMode('link')}>Havola</Chip>
      </div>

      {mode === 'file' && (
        <FilePick inputRef={inputRef} file={file} onFile={setFile}
          accept=".pdf,.ppt,.pptx,.pps,.ppsx,.doc,.docx,.xls,.xlsx,.odp,.odt,.ods,.txt,.rtf,.csv,.png,.jpg,.jpeg,.gif,.webp,.zip,.rar,.7z"
          hint="Prezentatsiya, PDF, Word, Excel yoki rasm (100 MB gacha)" />
      )}
      {mode === 'video' && (
        <FilePick inputRef={inputRef} file={file} onFile={setFile} accept="video/*,.mkv,.avi"
          hint="Dars videosi: mp4, mov, webm… (2 GB gacha)" />
      )}
      {mode === 'link' && (
        <Field label="Havola" placeholder="https://..." inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)}
          error={url && !validUrl ? 'Havola https:// bilan boshlanishi kerak' : undefined} />
      )}

      <Field label="Nomi (ixtiyoriy)" placeholder={mode === 'link' ? 'Masalan: Qo\'shimcha o\'qish uchun' : 'Fayl nomi ishlatiladi'}
        value={name} onChange={(e) => setName(e.target.value)} />

      {progress !== null && (
        <div className="upload-progress">
          <div className="progress"><div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <p className="muted small">Yuklanmoqda: {Math.round(progress * 100)}% — ilovani yopmang</p>
        </div>
      )}

      <Button onClick={submit} loading={busy} disabled={!ready}>Qo'shish</Button>
    </Card>
  );
}

function MaterialRow({ material, onOpenVideo, onRemove }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');

  async function run(kind, fn) {
    setBusy(kind);
    try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  const m = material;
  const processing = BUSY_STATUSES.includes(m.status);
  let sub = '';
  if (m.kind === 'link') sub = 'Havola';
  else if (m.kind === 'video') sub = [formatDuration(m.duration_seconds), formatSize(m.size_bytes), expiryLabel(m)].filter(Boolean).join(' · ');
  else sub = formatSize(m.size_bytes);

  return (
    <div className="material">
      <div className="list-row material-head">
        <span className="setting-icon"><Icon name={KIND_ICON[m.kind] ?? 'file'} size={20} /></span>
        <div className="grow">
          <b className="break">{m.name}</b>
          <p className="muted small">{sub}</p>
        </div>
        <button type="button" className="icon-btn icon-btn-danger" aria-label="O'chirish" title="O'chirish" onClick={() => onRemove(m)}>
          <Icon name="trash" size={20} />
        </button>
      </div>

      {processing && <Pill tone="warn">{m.status === 'uploading' ? 'Yuklanmoqda…' : 'Video siqilmoqda…'}</Pill>}
      {m.source === 'recording' && m.status === 'ready' && <Pill tone="grey">Ekran yozuvi · 7 kun saqlanadi</Pill>}
      {m.status === 'failed' && <p className="error-box">Videoni qayta ishlab bo'lmadi. O'chirib, qayta yuklang.</p>}

      {m.status === 'ready' && (
        <div className="material-actions">
          {m.kind === 'video' && <button type="button" className="mini-btn primary" onClick={() => onOpenVideo(m)}>▶ Ko'rish</button>}
          {m.kind === 'link' && <button type="button" className="mini-btn primary" onClick={() => openMaterial(m)}>Ochish</button>}
          {m.kind === 'file' && (
            <>
              <button type="button" className="mini-btn primary" disabled={!!busy} onClick={() => run('view', () => openMaterial(m))}>Ko'rish</button>
              <button type="button" className="mini-btn" disabled={!!busy} onClick={() => run('dl', () => openMaterial(m, { download: true }))}>Yuklab olish</button>
            </>
          )}
          {(m.kind === 'file' || m.kind === 'telegram') && (
            <button type="button" className="mini-btn" disabled={!!busy}
              onClick={() => run('tg', async () => { await sendToTelegram(m); toast('Telegram chatingizga yuborildi'); })}>
              {busy === 'tg' ? 'Yuborilmoqda…' : 'Telegramga'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LessonDetail() {
  const { gid, lid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(`/g/${gid}/lessons`), [navigate, gid]);
  useTelegramBack(back);

  const lessons = useApi(`/mentor/groups/${gid}/lessons`);
  const assignments = useApi(`/mentor/groups/${gid}/assignments`);
  const [lesson, setLesson] = useState(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setLesson(lessons.data?.find((l) => String(l.id) === lid) ?? null);
  }, [lessons.data, lid]);

  // Video siqilayotgan bo'lsa, holatni har 8 soniyada yangilab turamiz
  const hasProcessing = lesson?.materials.some((m) => BUSY_STATUSES.includes(m.status));
  const { reload } = lessons;
  useEffect(() => {
    if (!hasProcessing) return undefined;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [hasProcessing, reload]);

  async function removeMaterial(m) {
    if (!(await confirmDialog(`«${m.name}» o'chirilsinmi?`))) return;
    try {
      await api(`/mentor/materials/${m.id}`, { method: 'DELETE' });
      setLesson((l) => ({ ...l, materials: l.materials.filter((x) => x.id !== m.id) }));
      toast("Material o'chirildi");
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function removeLesson() {
    if (!(await confirmDialog("Dars o'chirilsinmi? Uning materiallari, videolari va yo'qlamasi ham o'chadi."))) return;
    try {
      await api(`/mentor/lessons/${lesson.id}`, { method: 'DELETE' });
      toast("Dars o'chirildi");
      navigate(`/g/${gid}/lessons`, { replace: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  if (lessons.loading && !lessons.data) return <><Header title="Dars" onBack={back} /><Loading /></>;
  if (!lesson) {
    return <><Header title="Dars" onBack={back} /><Content><ErrorBox text={lessons.error ?? 'Dars topilmadi'} onRetry={lessons.reload} /></Content></>;
  }

  return (
    <>
      <Header title="Dars" onBack={back} />
      <Content>
        <div className="hero-card">
          <p className="hero-label">{formatDate(lesson.lesson_date)}</p>
          <h2 className="hero-title">{lesson.title}</h2>
          {lesson.description && <p className="hero-sub">{lesson.description}</p>}
          <div className="row hero-actions">
            <button type="button" className="hero-btn" onClick={() => setEditing((v) => !v)}>{editing ? 'Yopish' : 'Tahrirlash'}</button>
            <button type="button" className="hero-btn hero-btn-light" onClick={() => navigate(`/g/${gid}/attendance/${lesson.id}`)}>
              Yo'qlama
            </button>
          </div>
        </div>

        <button type="button" className="rec-cta" onClick={() => navigate(`/g/${gid}/lessons/${lid}/record`)}>
          <span className="rec-dot" aria-hidden="true" />
          <span className="grow">
            <b>Darsni ekrandan yozish</b>
            <span className="muted small">Ekran va ovoz yoziladi, o'quvchilarga o'zi yuboriladi</span>
          </span>
          <Icon name="right" size={18} />
        </button>

        {editing && <EditLesson lesson={lesson} onSaved={(l) => { setLesson(l); setEditing(false); lessons.reload(); }} />}

        <h2 className="section-title">Materiallar</h2>
        {lesson.materials.length === 0 && <p className="muted small">Hali material yo'q. Prezentatsiya, video yoki havola qo'shing.</p>}
        {lesson.materials.length > 0 && (
          <Card className="card-flush">
            {lesson.materials.map((m) => (
              <MaterialRow key={m.id} material={m} onRemove={removeMaterial}
                onOpenVideo={(v) => navigate(`/g/${gid}/lessons/${lid}/video/${v.id}`)} />
            ))}
          </Card>
        )}

        <div className="section-head">
          <h2 className="section-title">Vazifalar</h2>
          <button type="button" className="link-btn" onClick={() => navigate(`/g/${gid}/lessons/${lid}/assign`)}>+ Topshiriq berish</button>
        </div>
        {assignments.data?.filter((a) => String(a.lesson_id) === lid).map((a) => (
          <AssignmentCard key={a.id} a={a} onClick={() => navigate(`/g/${gid}/homework/${a.id}`)} />
        ))}
        {assignments.data && !assignments.data.some((a) => String(a.lesson_id) === lid) && (
          <p className="muted small">Bu darsga hali uy vazifasi berilmagan.</p>
        )}

        <AddMaterial lessonId={lesson.id}
          onAdded={(m) => setLesson((l) => ({ ...l, materials: [...l.materials, m] }))} />

        <button type="button" className="link-btn link-danger" onClick={removeLesson}>Darsni o'chirish</button>
      </Content>
    </>
  );
}
