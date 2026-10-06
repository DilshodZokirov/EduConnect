import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../hooks.jsx';
import { AttendanceList, AttendanceStats } from '../../components/Attendance.jsx';
import AttendanceCalendar from '../../components/AttendanceCalendar.jsx';
import { Card, Content, ErrorBox, Header, Loading, useTelegramBack } from '../../components/ui.jsx';
import LessonList from '../learn/LessonList.jsx';
import LessonView from '../learn/LessonView.jsx';
import { useChildProgress } from './useParentData.js';

export function ChildLessons() {
  const { cid, gid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const progress = useChildProgress(cid);
  const groups = useApi(`/parent/children/${cid}/groups`);
  const group = groups.data?.find((g) => String(g.id) === gid);

  return (
    <>
      <Header title={group?.name ?? 'Darslar'} onBack={back} />
      <Content>
        <p className="muted small">Farzandingiz o'tgan mavzular, materiallar va videolar. Video yonidagi foiz — farzandingiz uni qancha ko'rgani.</p>
        <LessonList gid={gid} basePath={`/child/${cid}/g/${gid}/l`} progress={progress} />
      </Content>
    </>
  );
}

export function ChildLesson() {
  const { cid, gid, lid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate(-1), [navigate]);
  const progress = useChildProgress(cid);
  return <LessonView gid={gid} lid={lid} progress={progress} onBack={back} />;
}

export function ChildAttendance() {
  const { cid } = useParams();
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi(`/parent/children/${cid}/attendance`);

  return (
    <>
      <Header title="Davomat" onBack={back} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data && (
          <>
            <Card><AttendanceStats items={data} /></Card>
            <Card><AttendanceCalendar items={data} /></Card>
            <h2 className="section-title">Barcha darslar</h2>
            <AttendanceList items={data} />
          </>
        )}
      </Content>
    </>
  );
}
