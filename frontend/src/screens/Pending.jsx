import { useState } from 'react';
import { formatPhone } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useBranding } from '../branding.jsx';
import Icon from '../components/Icon.jsx';
import { BottomBar, Button, Card, Content, Header, Pill, Screen } from '../components/ui.jsx';
import ProfileSwitcher from '../components/ProfileSwitcher.jsx';

export default function Pending() {
  const { user, refreshUser } = useAuth();
  const { name: centerName } = useBranding();
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
      <Header title={centerName} />
      <Content className="content-roomy">
        <div className="intro center">
          <div className="status-circle warn"><Icon name="clock" size={42} /></div>
          <h1 className="title-lg">{user.awaiting_manager ? 'Menejer tasdiqlashi kutilmoqda' : "So'rovingiz yuborildi"}</h1>
          <p className="muted narrow">
            {user.awaiting_manager
              ? "Filial admini sizni admin sifatida taklif qildi. Hududiy menejer tasdiqlagach, botda xabar olasiz."
              : user.requested_role === 'admin'
                ? "Siz admin bo'lish uchun so'rov yubordingiz. Filialning hududiy menejeri tasdiqlagach, botda xabar olasiz."
                : "Siz mentor (o'qituvchi) sifatida ro'yxatdan o'tdingiz. Filial admini tasdiqlagach, botda xabar olasiz."}
          </p>
        </div>
        <Card>
          <div className="kv"><span className="muted">Ism</span><b>{user.first_name} {user.last_name}</b></div>
          <div className="divider" />
          <div className="kv"><span className="muted">Telefon</span><b>{formatPhone(user.phone)}</b></div>
          {user.branch_name && (<><div className="divider" /><div className="kv"><span className="muted">Filial</span><b>{user.branch_name}</b></div></>)}
          <div className="divider" />
          <div className="kv"><span className="muted">Holat</span><Pill tone="warn">{user.awaiting_manager ? 'Menejer tasdiqlaydi' : 'Kutilmoqda'}</Pill></div>
        </Card>
        {note && <p className="muted small center">{note}</p>}
        <ProfileSwitcher compact />
        {!user.awaiting_manager && (
          <p className="muted small center">O'quvchi yoki ota-ona bo'lsangiz — o'qituvchingiz bergan guruh havolasini oching, shunda darhol qo'shilasiz.</p>
        )}
      </Content>
      <BottomBar>
        <Button variant="outline" onClick={refresh} loading={loading}>Holatni yangilash</Button>
      </BottomBar>
    </Screen>
  );
}
