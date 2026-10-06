import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Chip, Content, EmptyState, ErrorBox, Header, Loading } from '../../components/ui.jsx';
import LessonList from '../learn/LessonList.jsx';
import LessonView from '../learn/LessonView.jsx';
import { useStudentData } from './useStudentData.js';

export function StudentLessons() {
  const { groups, progress } = useStudentData();
  const [gid, setGid] = useState(null);
  useEffect(() => {
    if (!gid && groups.data?.length) setGid(groups.data[0].id);
  }, [groups.data, gid]);

  return (
    <>
      <Header title="Darslar" />
      <Content>
        {groups.loading && !groups.data && <Loading />}
        {groups.error && <ErrorBox text={groups.error} onRetry={groups.reload} />}
        {groups.data?.length === 0 && <EmptyState icon="book" title="Siz hali guruhga qo'shilmagansiz" />}
        {groups.data?.length > 1 && (
          <div className="chips chips-scroll">
            {groups.data.map((g) => <Chip key={g.id} active={gid === g.id} onClick={() => setGid(g.id)}>{g.name}</Chip>)}
          </div>
        )}
        {gid && <LessonList gid={gid} basePath={`/lessons/${gid}`} progress={progress} />}
      </Content>
    </>
  );
}

export function StudentLesson() {
  const { gid, lid } = useParams();
  const navigate = useNavigate();
  const { progress } = useStudentData();
  const back = useCallback(() => navigate(-1), [navigate]);
  return <LessonView gid={gid} lid={lid} track progress={progress} onBack={back} />;
}
