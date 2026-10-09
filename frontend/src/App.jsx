import { useEffect, useState } from 'react';
import { matchPath, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import LockGate from './components/LockGate.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import TopBar from './components/TopBar.jsx';
import Notifications from './screens/notifications/Notifications.jsx';
import NotifySettings from './screens/profile/NotifySettings.jsx';
import { BottomNav, Button, Content, FullscreenToggle, Screen, Splash } from './components/ui.jsx';
import PasswordLogin from './screens/PasswordLogin.jsx';
import Pending from './screens/Pending.jsx';
import Password from './screens/profile/Password.jsx';
import PhoneChange from './screens/profile/PhoneChange.jsx';
import Profile from './screens/profile/Profile.jsx';
import ProfileEdit from './screens/profile/ProfileEdit.jsx';
import Register from './screens/Register.jsx';
import JoinFlow from './screens/JoinFlow.jsx';
import { joinToken, recordTarget } from './api.js';
import GroupCreate from './screens/admin/GroupCreate.jsx';
import GroupDetail from './screens/admin/GroupDetail.jsx';
import Groups from './screens/admin/Groups.jsx';
import Members from './screens/admin/Members.jsx';
import Payments from './screens/admin/Payments.jsx';
import Discounts from './screens/admin/Discounts.jsx';
import Approvals from './screens/manage/Approvals.jsx';
import Branches from './screens/manage/Branches.jsx';
import Hub from './screens/manage/Hub.jsx';
import Managers from './screens/manage/Managers.jsx';
import CenterSettings from './screens/manage/Settings.jsx';
import { StaffDetail, StaffSearch } from './screens/manage/Staff.jsx';
import Requests from './screens/admin/Requests.jsx';
import Attendance from './screens/mentor/Attendance.jsx';
import LessonDetail from './screens/mentor/LessonDetail.jsx';
import Lessons from './screens/mentor/Lessons.jsx';
import LinkParent from './screens/mentor/LinkParent.jsx';
import MentorHome from './screens/mentor/Home.jsx';
import Students from './screens/mentor/Students.jsx';
import VideoPage from './screens/mentor/VideoPage.jsx';
import MentorGroupForm from './screens/mentor/GroupForm.jsx';
import MentorInvite from './screens/mentor/Invite.jsx';
import MentorRecord from './screens/mentor/Record.jsx';
import ChildHomework from './screens/homework/ChildHomework.jsx';
import AssignWizard from './screens/homework/AssignWizard.jsx';
import MentorDetail from './screens/homework/MentorDetail.jsx';
import MentorList from './screens/homework/MentorList.jsx';
import StudentHomework from './screens/homework/StudentList.jsx';
import StudentHomeworkDetail from './screens/homework/StudentDetail.jsx';
import TestBuilder from './screens/tests/Builder.jsx';
import ChildTests from './screens/tests/ChildTests.jsx';
import { MentorTestDetail, MentorTestList } from './screens/tests/MentorTests.jsx';
import TestResult from './screens/tests/Result.jsx';
import TestRunner from './screens/tests/Runner.jsx';
import { ChildRating, MentorRating, StudentRating } from './screens/rating/RatingPages.jsx';
import StudentTests from './screens/tests/StudentTests.jsx';
import { ChildAttendance, ChildLesson, ChildLessons } from './screens/parent/ChildPages.jsx';
import ParentHome from './screens/parent/Home.jsx';
import { ChildPayments } from './screens/parent/Payments.jsx';
import StudentAttendance from './screens/student/Attendance.jsx';
import StudentHome from './screens/student/Home.jsx';
import { StudentLesson, StudentLessons } from './screens/student/Lessons.jsx';

// Har bir rol uchun: pastki menyu (nav) va menyuda ko'rinmaydigan ichki sahifalar (inner).
// Ichki sahifalarda pastki menyu yashiriladi.
const ADMIN = {
  nav: [
    { to: '/', label: "So'rovlar", icon: 'users', element: <Requests /> },
    { to: '/groups', label: 'Guruhlar', icon: 'book', element: <Groups /> },
    { to: '/payments', label: "To'lovlar", icon: 'wallet', element: <Payments /> },
    { to: '/manage', label: 'Boshqaruv', icon: 'shield', element: <Hub /> },
  ],
  inner: [
    { path: '/groups/new', element: <GroupCreate /> },
    { path: '/groups/:id', element: <GroupDetail /> },
    { path: '/payments/discounts', element: <Discounts /> },
    { path: '/members', element: <Members /> },
    { path: '/manage/branches', element: <Branches /> },
    { path: '/manage/approvals', element: <Approvals /> },
    { path: '/manage/managers', element: <Managers /> },
    { path: '/manage/settings', element: <CenterSettings /> },
    { path: '/manage/staff', element: <StaffSearch /> },
    { path: '/manage/staff/:id', element: <StaffDetail /> },
  ],
};

const ROLE_PAGES = {
  superadmin: ADMIN,
  general_manager: ADMIN,
  regional_manager: ADMIN,
  admin: ADMIN,
  mentor: {
    nav: [{ to: '/', label: 'Guruhim', icon: 'home', element: <MentorHome /> }],
    inner: [
      { path: '/groups/new', element: <MentorGroupForm /> },
      { path: '/g/:gid/settings', element: <MentorGroupForm /> },
      { path: '/g/:gid/invite', element: <MentorInvite /> },
      { path: '/g/:gid/discounts', element: <Discounts /> },
      { path: '/g/:gid/lessons', element: <Lessons /> },
      { path: '/g/:gid/lessons/:lid', element: <LessonDetail /> },
      { path: '/g/:gid/lessons/:lid/video/:mid', element: <VideoPage /> },
      { path: '/g/:gid/lessons/:lid/record', element: <MentorRecord /> },
      { path: '/g/:gid/lessons/:lid/assign', element: <AssignWizard /> },
      { path: '/g/:gid/lessons/:lid/homework/new', element: <AssignWizard /> },
      { path: '/g/:gid/homework', element: <MentorList /> },
      { path: '/g/:gid/homework/:aid', element: <MentorDetail /> },
      { path: '/g/:gid/rating', element: <MentorRating /> },
      { path: '/g/:gid/tests', element: <MentorTestList /> },
      { path: '/g/:gid/tests/new', element: <TestBuilder /> },
      { path: '/g/:gid/tests/:tid', element: <MentorTestDetail /> },
      { path: '/g/:gid/tests/:tid/edit', element: <TestBuilder /> },
      { path: '/g/:gid/attendance', element: <Attendance /> },
      { path: '/g/:gid/attendance/:lid', element: <Attendance /> },
      { path: '/g/:gid/students', element: <Students /> },
      { path: '/g/:gid/students/:sid', element: <LinkParent /> },
    ],
  },
  student: {
    nav: [
      { to: '/', label: 'Bosh sahifa', icon: 'home', element: <StudentHome /> },
      { to: '/lessons', label: 'Darslar', icon: 'book', element: <StudentLessons /> },
      { to: '/homework', label: 'Vazifalar', icon: 'test', element: <StudentHomework /> },
      { to: '/attendance', label: 'Davomat', icon: 'checksq', element: <StudentAttendance /> },
    ],
    inner: [
      { path: '/lessons/:gid/:lid', element: <StudentLesson /> },
      { path: '/homework/:aid', element: <StudentHomeworkDetail /> },
      { path: '/rating', element: <StudentRating /> },
      { path: '/tests', element: <StudentTests /> },
      { path: '/tests/:tid/take', element: <TestRunner /> },
      { path: '/tests/result/:aid', element: <TestResult /> },
    ],
  },
  parent: {
    nav: [{ to: '/', label: 'Farzandlar', icon: 'users', element: <ParentHome /> }],
    inner: [
      { path: '/child/:cid/attendance', element: <ChildAttendance /> },
      { path: '/child/:cid/payments', element: <ChildPayments /> },
      { path: '/child/:cid/homework', element: <ChildHomework /> },
      { path: '/child/:cid/tests', element: <ChildTests /> },
      { path: '/child/:cid/rating', element: <ChildRating /> },
      { path: '/child/:cid/g/:gid', element: <ChildLessons /> },
      { path: '/child/:cid/g/:gid/l/:lid', element: <ChildLesson /> },
    ],
  },
};

// Profil ichki sahifalari — barcha rollar uchun bir xil
const PROFILE_PAGES = [
  { path: '/profile/edit', element: <ProfileEdit /> },
  { path: '/profile/password', element: <Password /> },
  { path: '/profile/phone', element: <PhoneChange /> },
  { path: '/profile/notifications', element: <NotifySettings /> },
  { path: '/notifications', element: <Notifications /> },
];

function Message({ title, text, onRetry }) {
  return (
    <Screen>
      <Content className="content-roomy">
        <div className="intro center intro-tall">
          <h1 className="title-lg">{title}</h1>
          <p className="muted narrow">{text}</p>
        </div>
        {onRetry && <Button variant="outline" onClick={onRetry}>Qayta urinish</Button>}
      </Content>
    </Screen>
  );
}

function RoleShell({ role }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Bot tugmasi yoki brauzer havolasi orqali kelgan bo'lsa — darhol dars yozish sahifasiga
  useEffect(() => {
    const target = recordTarget.take();
    if (!target) return;
    const [gid, lid] = target.split('.');
    if (role === 'mentor') navigate(`/g/${gid}/lessons/${lid}/record`, { replace: true });
  }, [role, navigate]);
  const { nav } = ROLE_PAGES[role];
  const inner = [...ROLE_PAGES[role].inner, ...PROFILE_PAGES];
  const pages = [...nav, { to: '/profile', label: 'Profil', icon: 'user', element: <Profile /> }];
  const isInner = inner.some((r) => matchPath(r.path, location.pathname));
  return (
    <Screen>
      <TopBar />
      {role === 'mentor' && <RecordingBar />}
      <div className="shell-body">
        <Routes>
          {pages.map((p) => <Route key={p.to} path={p.to} element={p.element} />)}
          {inner.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {!isInner && <BottomNav items={pages} />}
    </Screen>
  );
}

function CurrentScreen() {
  const { phase, user, error, login } = useAuth();
  const [joinDismissed, setJoinDismissed] = useState(false);
  const pendingJoin = !joinDismissed && !!joinToken.get(); // har renderda tekshiriladi (ro'yxatdan o'tishda tozalanishi mumkin)

  if (phase === 'loading') return <Splash />;
  if (phase === 'no-telegram') {
    return <Message title="Telegram orqali oching" text="Bu ilova faqat EduConnect boti ichidagi tugma orqali ishlaydi." />;
  }
  if (phase === 'error') return <Message title="Xatolik" text={error} onRetry={() => login()} />;
  if (phase === 'register') return <Register />;
  if (phase === 'password') return <PasswordLogin />;
  if (pendingJoin && user.status !== 'blocked') return <JoinFlow onDone={() => setJoinDismissed(true)} />;
  if (user.status === 'pending') return <Pending />;
  if (user.role === 'student' || user.role === 'parent') {
    return <LockGate><RoleShell role={user.role} /></LockGate>;
  }
  return <RoleShell role={user.role} />;
}

export default function App() {
  return (
    <>
      <CurrentScreen />
      <FullscreenToggle />
    </>
  );
}
