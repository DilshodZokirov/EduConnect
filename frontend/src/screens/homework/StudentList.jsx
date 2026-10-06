import { useNavigate } from 'react-router-dom';
import { formatDateTime, timeLeft } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Chip, Content, EmptyState, ErrorBox, Header, Loading, Pill } from '../../components/ui.jsx';
import { useState } from 'react';
import { ScorePill, STUDENT_STATUS } from './shared.jsx';

export default function StudentList() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi('/student/assignments');
  const [tab, setTab] = useState('todo');
  const todo = data?.filter((a) => a.status === 'new' || a.status === 'overdue') ?? [];
  const done = data?.filter((a) => a.status === 'submitted' || a.status === 'graded') ?? [];
  const list = tab === 'todo' ? todo : done;

  return (
    <>
      <Header title="Uy vazifalari" />
      <Content>
        <div className="chips">
          <Chip active={tab === 'todo'} onClick={() => setTab('todo')}>Bajarish kerak ({todo.length})</Chip>
          <Chip active={tab === 'done'} onClick={() => setTab('done')}>Topshirilgan ({done.length})</Chip>
        </div>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data && list.length === 0 && (
          <EmptyState icon="test" title={tab === 'todo' ? "Bajarilmagan vazifa yo'q 🎉" : "Hali topshirilgan vazifa yo'q"} />
        )}
        {list.map((a) => {
          const st = STUDENT_STATUS[a.status];
          return (
            <button key={a.id} type="button" className="card card-link" onClick={() => navigate(`/homework/${a.id}`)}>
              <div className="row">
                <div className="grow">
                  <p className="muted small">{a.group_name} · {a.lesson_title}</p>
                  <h3 className="item-title">{a.title}</h3>
                </div>
                <Icon name="right" size={18} />
              </div>
              <div className="chips">
                <Pill tone={st.tone}>{st.text}</Pill>
                {a.status === 'graded' && <ScorePill score={a.submission.final_score} />}
                {(a.status === 'new' || a.status === 'overdue') && (
                  <Pill tone={a.status === 'overdue' ? 'warn' : 'grey'}>{formatDateTime(a.due_at)} · {timeLeft(a.due_at)}</Pill>
                )}
                {a.submission?.late && <Pill tone="warn">Kech topshirildi</Pill>}
              </div>
            </button>
          );
        })}
      </Content>
    </>
  );
}
