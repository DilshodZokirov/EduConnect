import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { initials } from '../../api.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Avatar, Button, Card, Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';
import ParentRequests from './ParentRequests.jsx';

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
        <ParentRequests groupId={gid} onChanged={reload} />
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && (
          <EmptyState icon="users" title="Guruhda o'quvchi yo'q" text="Guruh havolasini o'quvchilarga yuboring — ular o'zi qo'shiladi."
            action={<Button onClick={() => navigate(`/g/${gid}/invite`)}>Havolani ochish</Button>} />
        )}
        {data?.length > 0 && (
          <>
            <p className="muted small">O'quvchini bosing: ota-onasini bog'lash, rolni tuzatish yoki guruhdan chiqarish.</p>
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
