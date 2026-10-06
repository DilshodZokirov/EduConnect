import { useState } from 'react';
import { formatPhone } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { BottomBar, Button, Card, Content, Header, Pill, Screen } from '../components/ui.jsx';

export default function Pending() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');

  async function refresh() {
    setLoading(true);
    setNote('');
    try {
      const u = await refreshUser();
      if (u.status === 'pending') setNote("Hali tasdiqlanmagan. Admin rol berishi bilan botda xabar olasiz.");
    } catch (e) {
      setNote(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header title="EduConnect" />
      <Content className="content-roomy">
        <div className="intro center">
          <div className="status-circle warn"><Icon name="clock" size={42} /></div>
          <h1 className="title-lg">So'rovingiz yuborildi</h1>
          <p className="muted narrow">Admin ma'lumotlaringizni tekshirib, sizga rol beradi. Tasdiqlangach, botda xabar olasiz.</p>
        </div>
        <Card>
          <div className="kv"><span className="muted">Ism</span><b>{user.first_name} {user.last_name}</b></div>
          <div className="divider" />
          <div className="kv"><span className="muted">Telefon</span><b>{formatPhone(user.phone)}</b></div>
          <div className="divider" />
          <div className="kv"><span className="muted">Holat</span><Pill tone="warn">Kutilmoqda</Pill></div>
        </Card>
        {note && <p className="muted small center">{note}</p>}
      </Content>
      <BottomBar>
        <Button variant="outline" onClick={refresh} loading={loading}>Holatni yangilash</Button>
      </BottomBar>
    </Screen>
  );
}
