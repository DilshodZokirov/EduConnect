import { useNavigate } from 'react-router-dom';
import { money } from '../../api.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Content, EmptyState, ErrorBox, Header, IconButton, Loading, Pill } from '../../components/ui.jsx';

export default function Groups() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi('/admin/groups');

  return (
    <>
      <Header title="Guruhlar" right={<IconButton icon="plus" label="Yangi guruh" onClick={() => navigate('/groups/new')} />} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && (
          <EmptyState icon="book" title="Hali guruh yo'q" text="Guruh yarating, mentorga biriktiring va o'quvchilarni qo'shing."
            action={<Button onClick={() => navigate('/groups/new')}>Guruh yaratish</Button>} />
        )}
        {data?.map((g) => (
          <button key={g.id} type="button" className="card card-link" onClick={() => navigate(`/groups/${g.id}`)}>
            <div className="row">
              <div className="grow">
                <h3 className="item-title">{g.name}</h3>
                <p className="muted small">
                  {g.mentor ? `Mentor: ${g.mentor.first_name} ${g.mentor.last_name}` : ''}
                </p>
              </div>
              <Icon name="right" size={18} />
            </div>
            <div className="chips">
              {!g.mentor && <Pill tone="warn">Mentor biriktirilmagan</Pill>}
              <Pill>{g.student_count} o'quvchi</Pill>
              {g.schedule && <Pill tone="grey">{g.schedule}</Pill>}
              {g.price ? <Pill tone="grey">{money(g.price)} so'm</Pill> : <Pill tone="warn">Narx yo'q</Pill>}
              {!g.is_active && <Pill tone="grey">Faol emas</Pill>}
            </div>
          </button>
        ))}
      </Content>
    </>
  );
}
