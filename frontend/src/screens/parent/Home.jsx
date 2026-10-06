import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, initials } from '../../api.js';
import { useApi, useToast } from '../../hooks.jsx';
import { AttendanceDots, AttendanceStats } from '../../components/Attendance.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar, Button, Card, Chip, Content, EmptyState, ErrorBox, Header, Loading,
} from '../../components/ui.jsx';
import { useChildren } from './useParentData.js';
import { PaymentAlert } from './Payments.jsx';
import { ChildHomeworkSummary } from '../homework/ChildHomework.jsx';

function PendingLinks({ onDecided }) {
  const toast = useToast();
  const links = useApi('/parent/links?status=pending');
  const [busy, setBusy] = useState(null);
  if (!links.data?.length) return null;

  async function decide(link, decision) {
    setBusy(link.id);
    try {
      await api(`/parent/links/${link.id}/${decision}`, { method: 'POST' });
      toast(decision === 'confirm' ? `${link.student.first_name} farzandlaringizga qo'shildi` : "So'rov rad etildi");
      links.setData((list) => list.filter((l) => l.id !== link.id));
      onDecided();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return links.data.map((l) => (
    <Card key={l.id} className="card-warn">
      <p><b>Tasdiqlash kerak:</b> mentor sizni <b>{l.student.first_name} {l.student.last_name}</b> ning ota-onasi sifatida bog'ladi.</p>
      <p className="muted small">Agar bu sizning farzandingiz bo'lmasa, rad eting.</p>
      <div className="row">
        <Button onClick={() => decide(l, 'confirm')} loading={busy === l.id}>Tasdiqlash</Button>
        <Button variant="outline" onClick={() => decide(l, 'reject')} disabled={busy === l.id}>Rad etish</Button>
      </div>
    </Card>
  ));
}

function ChildDashboard({ child }) {
  const navigate = useNavigate();
  const groups = useApi(`/parent/children/${child.id}/groups`);
  const attendance = useApi(`/parent/children/${child.id}/attendance`);

  return (
    <>
      <PaymentAlert childId={child.id} />
      <Card>
        <div className="row">
          <Avatar text={initials(child)} size={48} />
          <div className="grow">
            <h2 className="title-md">{child.first_name} {child.last_name}</h2>
            <p className="muted small">{child.groups.join(', ') || "Guruhga qo'shilmagan"}</p>
          </div>
        </div>
        {attendance.data && <AttendanceStats items={attendance.data} />}
      </Card>

      <Card>
        <div className="kv">
          <h3 className="item-title">Oxirgi darslar</h3>
          <button type="button" className="link-btn" onClick={() => navigate(`/child/${child.id}/attendance`)}>📅 Kalendar</button>
        </div>
        {attendance.loading && !attendance.data ? <Loading /> : <AttendanceDots items={attendance.data ?? []} />}
      </Card>

      <ChildHomeworkSummary childId={child.id} />

      <h2 className="section-title">Darslar va materiallar</h2>
      {groups.loading && !groups.data && <Loading />}
      {groups.error && <ErrorBox text={groups.error} onRetry={groups.reload} />}
      {groups.data?.map((g) => (
        <button key={g.id} type="button" className="card card-link" onClick={() => navigate(`/child/${child.id}/g/${g.id}`)}>
          <div className="row">
            <span className="setting-icon"><Icon name="book" size={20} /></span>
            <div className="grow">
              <h3 className="item-title">{g.name}</h3>
              <p className="muted small">
                {g.mentor ? `Mentor: ${g.mentor.first_name} ${g.mentor.last_name}` : ''}{g.schedule ? ` · ${g.schedule}` : ''}
              </p>
            </div>
            <Icon name="right" size={18} />
          </div>
        </button>
      ))}
    </>
  );
}

export default function ParentHome() {
  const { children, child, select } = useChildren();

  return (
    <>
      <Header title="Farzandlarim" />
      <Content>
        <PendingLinks onDecided={children.reload} />
        {children.loading && !children.data && <Loading />}
        {children.error && <ErrorBox text={children.error} onRetry={children.reload} />}
        {children.data?.length === 0 && (
          <EmptyState icon="users" title="Hali farzand bog'lanmagan"
            text="Farzandingizning mentori sizni u bilan bog'laydi. Shundan so'ng shu yerda tasdiqlash so'rovi chiqadi." />
        )}
        {children.data?.length > 1 && (
          <div className="chips chips-scroll">
            {children.data.map((c) => (
              <Chip key={c.id} active={child?.id === c.id} onClick={() => select(c.id)}>{c.first_name}</Chip>
            ))}
          </div>
        )}
        {child && <ChildDashboard key={child.id} child={child} />}
      </Content>
    </>
  );
}
