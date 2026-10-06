import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { initials } from '../../api.js';
import { useApi } from '../../hooks.jsx';
import { formatDuration } from '../../materials.js';
import VideoPlayer from '../../components/VideoPlayer.jsx';
import { Avatar, Card, Content, ErrorBox, Header, Loading, useTelegramBack } from '../../components/ui.jsx';

const WATCHED = 90; // shu foizdan ko'p ko'rgan — "oxirigacha ko'rdi"

export default function VideoPage() {
  const { gid, lid, mid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate(`/g/${gid}/lessons/${lid}`), [navigate, gid, lid]);
  useTelegramBack(back);

  const lessons = useApi(`/mentor/groups/${gid}/lessons`);
  const views = useApi(`/mentor/materials/${mid}/views`);
  const lesson = lessons.data?.find((l) => String(l.id) === lid);
  const video = lesson?.materials.find((m) => String(m.id) === mid);

  if (lessons.loading && !lessons.data) return <><Header title="Video" onBack={back} /><Loading /></>;
  if (!video) return <><Header title="Video" onBack={back} /><Content><ErrorBox text="Video topilmadi" /></Content></>;

  const finished = views.data?.filter((v) => v.percent >= WATCHED).length ?? 0;

  return (
    <>
      <Header title="Dars videosi" onBack={back} />
      <Content>
        <div>
          <p className="muted small">{lesson.title}</p>
          <h2 className="title-md">{video.name}</h2>
          {video.duration_seconds && <p className="muted small">Davomiyligi: {formatDuration(video.duration_seconds)}</p>}
        </div>
        <VideoPlayer material={video} />

        <div className="section-head">
          <h2 className="section-title">Kim ko'rdi</h2>
          {views.data && <span className="muted small">{finished} / {views.data.length} oxirigacha ko'rdi</span>}
        </div>
        {views.loading && !views.data && <Loading />}
        {views.error && <ErrorBox text={views.error} onRetry={views.reload} />}
        {views.data?.length > 0 && (
          <Card className="card-flush">
            {views.data.map((v) => (
              <div key={v.student.id} className="list-row">
                <Avatar text={initials(v.student)} size={36} />
                <div className="grow">
                  <b>{v.student.first_name} {v.student.last_name}</b>
                  <div className="progress progress-sm">
                    <div className={`progress-bar ${v.percent >= WATCHED ? '' : 'progress-partial'}`} style={{ width: `${v.percent}%` }} />
                  </div>
                </div>
                <span className={`percent ${v.percent === 0 ? 'muted' : ''}`}>{v.percent}%</span>
              </div>
            ))}
          </Card>
        )}
      </Content>
    </>
  );
}
