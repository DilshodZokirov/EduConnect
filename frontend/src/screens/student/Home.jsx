import { useNavigate } from 'react-router-dom';
import { formatDate, todayISO } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import { AttendanceDots, summarize } from '../../components/Attendance.jsx';
import Icon from '../../components/Icon.jsx';
import { Card, Content, EmptyState, ErrorBox, Header, Loading } from '../../components/ui.jsx';
import { useStudentData } from './useStudentData.js';

function GroupToday({ group }) {
  const navigate = useNavigate();
  const lessons = useApi(`/learn/groups/${group.id}/lessons`);
  const today = todayISO();
  // Bugungi dars, bo'lmasa eng oxirgi dars
  const lesson = lessons.data?.find((l) => l.lesson_date === today) ?? lessons.data?.[0];

  return (
    <div className="hero-card">
      <p className="hero-label">{group.name}{group.schedule ? ` · ${group.schedule}` : ''}</p>
      {lessons.loading && !lessons.data && <p className="hero-sub">Yuklanmoqda…</p>}
      {lessons.data && !lesson && <p className="hero-lesson">Hali dars yo'q</p>}
      {lesson && (
        <>
          <p className="hero-sub">{lesson.lesson_date === today ? 'Bugungi dars' : `Oxirgi dars · ${formatDate(lesson.lesson_date, false)}`}</p>
          <h2 className="hero-title">{lesson.title}</h2>
          <button type="button" className="hero-btn hero-btn-light"
            onClick={() => navigate(`/lessons/${group.id}/${lesson.id}`)}>
            Materiallarni ochish
          </button>
        </>
      )}
    </div>
  );
}

export default function StudentHome() {
  const navigate = useNavigate();
  const { user, groups } = useStudentData();
  const attendance = useApi('/student/attendance');
  const homework = useApi('/student/assignments');
  const todo = homework.data?.filter((a) => a.status === 'new' || a.status === 'overdue').length ?? 0;
  const stats = summarize(attendance.data ?? []);

  return (
    <>
      <Header title={`Salom, ${user.first_name}!`} />
      <Content>
        {groups.loading && !groups.data && <Loading />}
        {groups.error && <ErrorBox text={groups.error} onRetry={groups.reload} />}
        {groups.data?.length === 0 && (
          <EmptyState icon="book" title="Siz hali guruhga qo'shilmagansiz"
            text="Admin sizni guruhga qo'shgach, darslar shu yerda paydo bo'ladi." />
        )}
        {groups.data?.map((g) => <GroupToday key={g.id} group={g} />)}

        {groups.data?.length > 0 && (
          <>
            <div className="tiles">
              <button type="button" className="tile" onClick={() => navigate('/attendance')}>
                <span className="tile-icon"><Icon name="checksq" size={22} /></span>
                <span className="tile-title">{stats.percent === null ? '—' : `${stats.percent}%`}</span>
                <span className="tile-sub">Davomat</span>
              </button>
              <button type="button" className={`tile ${todo ? 'tile-warn' : ''}`} onClick={() => navigate('/homework')}>
                <span className="tile-icon"><Icon name="test" size={22} /></span>
                <span className="tile-title">Uy vazifalari</span>
                <span className="tile-sub">{todo ? `${todo} ta bajarish kerak` : 'Hammasi topshirilgan'}</span>
              </button>
            </div>
            <Card>
              <div className="kv"><h3 className="item-title">Oxirgi darslar</h3>
                <button type="button" className="link-btn" onClick={() => navigate('/attendance')}>Hammasi</button></div>
              <AttendanceDots items={attendance.data ?? []} />
            </Card>
          </>
        )}
      </Content>
    </>
  );
}
