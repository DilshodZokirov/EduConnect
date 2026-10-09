import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import RatingBoard from '../../components/RatingBoard.jsx';
import { Chip, Content, EmptyState, Header, Loading, useTelegramBack } from '../../components/ui.jsx';

function GroupSwitch({ groups, value, onChange }) {
  if (!groups || groups.length < 2) return null;
  return (
    <div className="chips chips-scroll">
      {groups.map((g) => <Chip key={g.id} active={value === g.id} onClick={() => onChange(g.id)}>{g.name}</Chip>)}
    </div>
  );
}

function useFirstGroup(groups) {
  const [gid, setGid] = useState(null);
  useEffect(() => { if (!gid && groups?.length) setGid(groups[0].id); }, [groups, gid]);
  return [gid, setGid];
}

export function StudentRating() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const groups = useApi('/student/groups');
  const [gid, setGid] = useFirstGroup(groups.data);
  return (
    <>
      <Header title="Reyting" onBack={back} />
      <Content>
        {groups.loading && !groups.data && <Loading />}
        {groups.data?.length === 0 && <EmptyState icon="trophy" title="Siz hali guruhga qo'shilmagansiz" />}
        <GroupSwitch groups={groups.data} value={gid} onChange={setGid} />
        {gid && <RatingBoard groupId={gid} highlightId={user.id} />}
      </Content>
    </>
  );
}

export function MentorRating() {
  const { gid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  return (
    <>
      <Header title="Guruh reytingi" onBack={back} />
      <Content><RatingBoard groupId={Number(gid)} /></Content>
    </>
  );
}

export function ChildRating() {
  const { cid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const groups = useApi(`/parent/children/${cid}/groups`);
  const [gid, setGid] = useFirstGroup(groups.data);
  return (
    <>
      <Header title="Reyting" onBack={back} />
      <Content>
        {groups.loading && !groups.data && <Loading />}
        <GroupSwitch groups={groups.data} value={gid} onChange={setGid} />
        {gid && <RatingBoard groupId={gid} highlightId={Number(cid)} highlightLabel="farzandingiz" />}
      </Content>
    </>
  );
}

/** Bosh sahifadagi qisqa ko'rinish: shu haftadagi o'rin. */
export function RatingSummary({ groupId, studentId, to }) {
  const navigate = useNavigate();
  const { data } = useApi(groupId ? `/rating/groups/${groupId}?period=week&offset=0` : null);
  const row = data?.rows.find((r) => r.student.id === studentId);
  const medal = row && { 1: 'gold', 2: 'silver', 3: 'bronze' }[row.rank];
  return (
    <button type="button" className={`tile ${medal ? `tile-${medal}` : ''}`} onClick={() => navigate(to)}>
      <span className="tile-icon"><Icon name="trophy" size={22} /></span>
      <span className="tile-title">{row && data.max_points > 0 ? `${row.rank}-o'rin` : 'Reyting'}</span>
      <span className="tile-sub">{row && data.max_points > 0 ? `${data.rows.length} o'quvchidan · ${row.points} ball` : 'Shu hafta'}</span>
    </button>
  );
}
