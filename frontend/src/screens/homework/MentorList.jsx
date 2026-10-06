import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDateTime } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Content, EmptyState, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';

/** Bitta vazifa kartasi (guruh ro'yxati va dars sahifasida ishlatiladi). */
export function AssignmentCard({ a, onClick }) {
  const overdue = new Date(a.due_at) < new Date();
  return (
    <button type="button" className="card card-link" onClick={onClick}>
      <div className="row">
        <div className="grow">
          <p className="muted small">Muddat: {formatDateTime(a.due_at)}{overdue ? ' · tugagan' : ''}</p>
          <h3 className="item-title">{a.title}</h3>
        </div>
        <Icon name="right" size={18} />
      </div>
      <div className="chips">
        <Pill tone="grey">Topshirdi: {a.submitted} / {a.total}</Pill>
        {a.to_review > 0 && <Pill tone="warn">Ko'rish kerak: {a.to_review}</Pill>}
        {a.to_approve > 0 && <Pill>AI baholadi: {a.to_approve}</Pill>}
        {a.graded > 0 && <Pill tone="grey">Baholandi: {a.graded}</Pill>}
      </div>
    </button>
  );
}

export default function MentorList() {
  const { gid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/mentor/groups/${gid}/assignments`);

  return (
    <>
      <Header title="Uy vazifalari" onBack={back} />
      <Content>
        <p className="muted small">Yangi vazifa darsga biriktiriladi: Mavzular → dars → «Uy vazifasi berish».</p>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && <EmptyState icon="test" title="Hali vazifa yo'q" />}
        {data?.map((a) => <AssignmentCard key={a.id} a={a} onClick={() => navigate(`/g/${gid}/homework/${a.id}`)} />)}
      </Content>
    </>
  );
}
