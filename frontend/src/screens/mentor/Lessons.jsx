import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { formatDate, todayISO } from '../../dates.js';
import { useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button, Card, Content, EmptyState, ErrorBox, Field, Header, IconButton, Loading, Pill, useTelegramBack,
} from '../../components/ui.jsx';

function CreateLesson({ gid, onCreated, onCancel }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const lesson = await api(`/mentor/groups/${gid}/lessons`, {
        method: 'POST', body: { title: title.trim(), lesson_date: date, description: description.trim() || null },
      });
      toast("Dars qo'shildi");
      onCreated(lesson);
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Card>
      <form className="stack" onSubmit={submit}>
        <h3 className="item-title">Yangi dars</h3>
        <Field label="Mavzu" placeholder="Masalan: JavaScript massivlar" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Field label="Sana" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="field">
          <span className="field-label">Qisqacha tavsif (ixtiyoriy)</span>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Darsda nimalar o'tiladi" />
        </label>
        <div className="row">
          <Button type="button" variant="outline" onClick={onCancel}>Bekor qilish</Button>
          <Button type="submit" loading={busy} disabled={!title.trim()}>Qo'shish</Button>
        </div>
      </form>
    </Card>
  );
}

export default function Lessons() {
  const { gid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/mentor/groups/${gid}/lessons`);
  const [creating, setCreating] = useState(false);
  const today = todayISO();

  return (
    <>
      <Header title="Mavzular" onBack={back}
        right={!creating && <IconButton icon="plus" label="Yangi dars" onClick={() => setCreating(true)} />} />
      <Content>
        {creating && (
          <CreateLesson gid={gid} onCancel={() => setCreating(false)}
            onCreated={(l) => navigate(`/g/${gid}/lessons/${l.id}`)} />
        )}
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && !creating && (
          <EmptyState icon="book" title="Hali dars yo'q" text="Dars mavzusini qo'shing va unga prezentatsiya biriktiring."
            action={<Button onClick={() => setCreating(true)}>Dars qo'shish</Button>} />
        )}
        {data?.map((l) => (
          <button key={l.id} type="button" className="card card-link" onClick={() => navigate(`/g/${gid}/lessons/${l.id}`)}>
            <div className="row">
              <div className="grow">
                <p className="muted small">{formatDate(l.lesson_date)}</p>
                <h3 className="item-title">{l.title}</h3>
              </div>
              <Icon name="right" size={18} />
            </div>
            <div className="chips">
              {l.lesson_date === today && <Pill tone="warn">Bugun</Pill>}
              <Pill tone={l.materials.length ? 'blue' : 'grey'}>
                {l.materials.length ? `${l.materials.length} ta material` : "Material yo'q"}
              </Pill>
            </div>
          </button>
        ))}
      </Content>
    </>
  );
}
