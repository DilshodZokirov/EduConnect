import { useApi } from '../../hooks.jsx';
import { AttendanceList, AttendanceStats } from '../../components/Attendance.jsx';
import AttendanceCalendar from '../../components/AttendanceCalendar.jsx';
import { Card, Content, ErrorBox, Header, Loading } from '../../components/ui.jsx';

export default function StudentAttendance() {
  const { data, error, loading, reload } = useApi('/student/attendance');
  return (
    <>
      <Header title="Davomatim" />
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
