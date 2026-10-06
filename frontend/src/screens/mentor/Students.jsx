import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { initials } from '../../api.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Avatar, Card, Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';

export default function Students() {
  const { gid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/mentor/groups/${gid}/students`);

  return (
    <>
      <Header title="O'quvchilar" onBack={back} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="users" title="Guruhda o'quvchi yo'q" text="O'quvchilarni admin guruhga qo'shadi." />}
        {data?.length > 0 && (
          <>
            <p className="muted small">O'quvchini bosib, unga ota-onasini bog'lang.</p>
            <Card className="card-flush">
              {data.map((s) => (
                <button key={s.id} type="button" className="list-row list-row-btn" onClick={() => navigate(`/g/${gid}/students/${s.id}`)}>
                  <Avatar text={initials(s)} size={40} />
                  <span className="grow">
                    <b>{s.first_name} {s.last_name}</b>
                    <span className="muted small block">
                      Davomat: {s.attendance_percent === null || s.attendance_percent === undefined ? '—' : `${s.attendance_percent}%`}
                    </span>
                  </span>
                  {s.confirmed_parents > 0 && <Pill>Ota-ona: {s.confirmed_parents}</Pill>}
                  {s.confirmed_parents === 0 && (s.self_guardian ? <Pill tone="grey">O'zi vasiy</Pill> : <Pill tone="warn">Bog'lanmagan</Pill>)}
                  <Icon name="right" size={18} />
                </button>
              ))}
            </Card>
          </>
        )}
      </Content>
    </>
  );
}
