import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, initials, maskPhone, ROLE_NAMES } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { confirmDialog, useApi, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Avatar, Card, Content, Header, Pill } from '../../components/ui.jsx';

function SettingRow({ icon, title, sub, right, onClick, danger }) {
  return (
    <button type="button" className={`setting-row ${danger ? 'setting-danger' : ''}`} onClick={onClick}>
      <span className="setting-icon"><Icon name={icon} size={20} /></span>
      <span className="setting-text"><b>{title}</b>{sub && <span className="muted small">{sub}</span>}</span>
      {right}
      <Icon name="right" size={18} />
    </button>
  );
}

export default function Profile() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, applySession } = useAuth();
  const phoneReq = useApi('/me/phone');
  const [busy, setBusy] = useState(false);

  async function revokeAll() {
    if (!(await confirmDialog("Boshqa barcha qurilmalardan chiqilsinmi? Bu qurilmada ilova ochiq qoladi."))) return;
    setBusy(true);
    try {
      applySession(await api('/me/sessions/revoke', { method: 'POST' }));
      toast('Boshqa qurilmalardan chiqildi');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const pendingPhone = phoneReq.data && ['awaiting_new', 'awaiting_old', 'awaiting_admin'].includes(phoneReq.data.status);

  return (
    <>
      <Header title="Profil" />
      <Content>
        <Card className="profile-card">
          <Avatar text={initials(user)} size={72} />
          <h2 className="title-md">{user.first_name} {user.last_name}</h2>
          <div className="chips chips-center">
            <Pill>{ROLE_NAMES[user.role]}</Pill>
            {user.self_guardian && <Pill tone="grey">O'zi vasiy</Pill>}
          </div>
          <p className="muted">{maskPhone(user.phone)}</p>
          <button type="button" className="btn btn-outline btn-icon" onClick={() => navigate('/profile/edit')}>
            <Icon name="edit" size={18} />Profilni tahrirlash
          </button>
        </Card>

        <Card className="card-flush">
          <h3 className="card-title">Xavfsizlik</h3>
          <SettingRow icon="lock" title="Parol" sub="Ilova ochilganda so'raladi" onClick={() => navigate('/profile/password')}
            right={user.has_password ? <Pill>O'rnatilgan</Pill> : <Pill tone="warn">O'rnatilmagan</Pill>} />
          <SettingRow icon="phone" title="Telefon raqam" sub="SMS tasdiq orqali o'zgartiriladi" onClick={() => navigate('/profile/phone')}
            right={pendingPhone ? <Pill tone="warn">Jarayonda</Pill> : null} />
          <SettingRow icon="shield" title="Boshqa qurilmalardan chiqish" sub="Profilingiz boshqa joyda ochiq qolgan bo'lsa"
            onClick={busy ? undefined : revokeAll} />
        </Card>
      </Content>
    </>
  );
}
