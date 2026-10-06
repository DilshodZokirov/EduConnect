import { useNavigate } from 'react-router-dom';
import { formatDate, todayISO } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { EmptyState, ErrorBox, Loading, Pill } from '../../components/ui.jsx';

/** Guruh darslari ro'yxati (o'quvchi va ota-ona uchun). basePath + "/" + lessonId ga o'tadi. */
export default function LessonList({ gid, basePath, progress = {} }) {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi(`/learn/groups/${gid}/lessons`);
  const today = todayISO();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox text={error} onRetry={reload} />;
  if (!data?.length) return <EmptyState icon="book" title="Hali dars yo'q" text="Mentor dars qo'shganda shu yerda paydo bo'ladi." />;

  return data.map((l) => {
    const videos = l.materials.filter((m) => m.kind === 'video');
    const others = l.materials.length - videos.length;
    const watched = videos.length ? Math.round(videos.reduce((a, v) => a + (progress[v.id] ?? 0), 0) / videos.length) : null;
    return (
      <button key={l.id} type="button" className="card card-link" onClick={() => navigate(`${basePath}/${l.id}`)}>
        <div className="row">
          <div className="grow">
            <p className="muted small">{formatDate(l.lesson_date)}</p>
            <h3 className="item-title">{l.title}</h3>
          </div>
          <Icon name="right" size={18} />
        </div>
        <div className="chips">
          {l.lesson_date === today && <Pill tone="warn">Bugun</Pill>}
          {videos.length > 0 && <Pill tone={watched >= 90 ? 'blue' : 'warn'}>📹 Video · {watched}% ko'rilgan</Pill>}
          {others > 0 && <Pill tone="grey">{others} ta material</Pill>}
        </div>
      </button>
    );
  });
}
