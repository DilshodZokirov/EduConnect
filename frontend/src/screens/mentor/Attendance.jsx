import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, initials } from '../../api.js';
import { formatDate, todayISO } from '../../dates.js';
import { useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar, BottomBar, Button, Card, Content, EmptyState, ErrorBox, Field, Header, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';

const OPTIONS = [
  { key: 'present', label: 'Keldi' },
  { key: 'absent', label: 'Kelmadi' },
  { key: 'late', label: 'Kechikdi' },
];

/** Bugun uchun dars yo'q bo'lsa — tezda yaratish. */
function CreateToday({ gid, onCreated }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const lesson = await api(`/mentor/groups/${gid}/lessons`, {
        method: 'POST', body: { title: title.trim(), lesson_date: todayISO() },
      });
      onCreated(lesson);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="item-title">Bugun uchun dars yaratilmagan</h3>
      <p className="muted small">Yo'qlama darsga bog'lanadi. Bugungi dars mavzusini yozing.</p>
      <Field placeholder="Masalan: JavaScript massivlar" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Button onClick={create} loading={busy} disabled={!title.trim()}>Dars yaratish va yo'qlama qilish</Button>
    </Card>
  );
}

export default function Attendance() {
  const { gid, lid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBack(back);

  const lessons = useApi(`/mentor/groups/${gid}/lessons`);
  const students = useApi(`/mentor/groups/${gid}/students`);
  const lesson = lid
    ? lessons.data?.find((l) => String(l.id) === lid)
    : lessons.data?.find((l) => l.lesson_date === todayISO());
  const saved = useApi(lesson ? `/mentor/lessons/${lesson.id}/attendance` : null);

  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);

  // Avval saqlangan yo'qlamani yuklaymiz; belgilanmaganlar "Keldi" bo'lib turadi
  useEffect(() => {
    if (!students.data || !saved.data) return;
    const prev = Object.fromEntries(saved.data.map((a) => [a.student_id, a.status]));
    setMarks(Object.fromEntries(students.data.map((s) => [s.id, prev[s.id] ?? 'present'])));
  }, [students.data, saved.data]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0 };
    Object.values(marks).forEach((v) => { c[v] += 1; });
    return c;
  }, [marks]);

  async function save() {
    setBusy(true);
    try {
      const items = Object.entries(marks).map(([id, st]) => ({ student_id: Number(id), status: st }));
      await api(`/mentor/lessons/${lesson.id}/attendance`, { method: 'PUT', body: { items } });
      toast(counts.absent
        ? "Yo'qlama saqlandi. Kelmaganlarning ota-onasiga xabar yuborilmoqda"
        : "Yo'qlama saqlandi");
      saved.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const loading = (lessons.loading && !lessons.data) || (students.loading && !students.data);
  const error = lessons.error || students.error;

  return (
    <>
      <Header title="Yo'qlama" onBack={back} />
      <Content>
        {loading && <Loading />}
        {error && <ErrorBox text={error} onRetry={() => { lessons.reload(); students.reload(); }} />}

        {!loading && !error && !lesson && !lid && (
          <CreateToday gid={gid} onCreated={(l) => navigate(`/g/${gid}/attendance/${l.id}`, { replace: true })} />
        )}
        {!loading && !error && !lesson && lid && <ErrorBox text="Dars topilmadi" />}

        {lesson && (
          <>
            <div>
              <p className="muted small">{formatDate(lesson.lesson_date)}</p>
              <h2 className="title-md">{lesson.title}</h2>
            </div>
            {students.data?.length === 0 && <EmptyState icon="users" title="Guruhda o'quvchi yo'q" />}
            {students.data?.length > 0 && (
              <>
                <div className="chips">
                  <Pill>Keldi: {counts.present}</Pill>
                  <Pill tone="warn">Kelmadi: {counts.absent}</Pill>
                  <Pill tone="grey">Kechikdi: {counts.late}</Pill>
                </div>
                {saved.loading && !saved.data ? <Loading /> : students.data.map((s) => (
                  <Card key={s.id} className="att-card">
                    <div className="row">
                      <Avatar text={initials(s)} size={36} />
                      <b className="grow">{s.first_name} {s.last_name}</b>
                    </div>
                    <div className="seg" role="radiogroup" aria-label={`${s.first_name} ${s.last_name}`}>
                      {OPTIONS.map((o) => (
                        <button key={o.key} type="button" role="radio" aria-checked={marks[s.id] === o.key}
                          className={`seg-btn seg-${o.key} ${marks[s.id] === o.key ? 'on' : ''}`}
                          onClick={() => setMarks((m) => ({ ...m, [s.id]: o.key }))}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Content>
      {lesson && students.data?.length > 0 && (
        <BottomBar>
          <p className="muted small row"><Icon name="bell" size={16} />Kelmaganlarning ota-onasiga SMS va Telegram xabar yuboriladi.</p>
          <Button onClick={save} loading={busy}>Saqlash va yuborish</Button>
        </BottomBar>
      )}
    </>
  );
}
