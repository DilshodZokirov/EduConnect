import { useEffect, useState } from 'react';
import { api, joinToken, STAFF_ROLES } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../hooks.jsx';
import Icon from '../components/Icon.jsx';
import InviteCard from '../components/InviteCard.jsx';
import { BottomBar, Button, Card, Chip, Content, ErrorBox, Header, Loading, Screen } from '../components/ui.jsx';

/**
 * Guruh havolasi orqali kelgan, ro'yxatdan o'tgan foydalanuvchi uchun:
 * o'quvchi — guruhga qo'shiladi; ota-ona — farzandini tanlaydi (o'qituvchi tasdiqlaydi).
 */
export default function JoinFlow({ onDone }) {
  const { user, refreshUser, applySession } = useAuth();
  const toast = useToast();
  const token = joinToken.get();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [joinAs, setJoinAs] = useState(user.role === 'student' || user.role === 'parent' ? user.role : null);
  const [classmates, setClassmates] = useState(null);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const isStaff = STAFF_ROLES.includes(user.role) || user.role === 'mentor';

  const finish = async () => {
    joinToken.clear();
    api('/join/pending/clear', { method: 'POST' }).catch(() => {});
    await refreshUser();
    onDone();
  };

  useEffect(() => {
    api(`/public/invite/${token}`, { auth: false }).then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (joinAs === 'parent' && !classmates) {
      api(`/join/${token}/students`).then(setClassmates).catch((e) => setError(e.message));
    }
  }, [joinAs, classmates, token]);

  // Xodim yoki boshqa roldagi foydalanuvchi — alohida profil ochiladi (masalan, superadmin sinash uchun o'quvchi bo'ladi)
  const newProfile = isStaff || (user.role && joinAs && joinAs !== user.role);

  async function submit() {
    setBusy(true);
    try {
      if (newProfile) {
        const r = await api(`/join/${token}/new-profile`, { method: 'POST', body: { join_as: joinAs, child_ids: picked } });
        applySession(r);
        setDone({ joined_as: joinAs, group_name: info.group_name, pending_children: picked.length, new_profile: true });
        return;
      }
      const r = await api(`/join/${token}`, { method: 'POST', body: { join_as: joinAs, child_ids: picked } });
      setDone(r);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }


  return (
    <Screen>
      <Header title="Guruhga qo'shilish" />
      <Content>
        {error && <ErrorBox text={error} />}
        {!info && !error && <Loading />}
        {info && <InviteCard info={info} />}

        {info && newProfile && !done && (
          <Card className="card-info">
            <b>Alohida profil ochiladi</b>
            <p className="muted small">
              Hozirgi profilingiz o'zgarmaydi. Yangi profil yaratiladi va «Profil → Profillarim» bo'limidan istalgan vaqtda
              ular orasida o'tasiz.
            </p>
          </Card>
        )}

        {info && !done && (
          <>
            {(!user.role || isStaff || user.role === 'student' || user.role === 'parent') && (
              <div className="field">
                <span className="field-label">Siz kimsiz?</span>
                <div className="chips">
                  <Chip active={joinAs === 'student'} onClick={() => setJoinAs('student')}>🎒 O'quvchiman</Chip>
                  <Chip active={joinAs === 'parent'} onClick={() => setJoinAs('parent')}>👨‍👩‍👧 Ota-onaman</Chip>
                </div>
              </div>
            )}
            {joinAs === 'student' && (
              <p className="muted small">«Qo'shilish» tugmasini bosganingizda shu guruhga darhol qo'shilasiz.</p>
            )}
            {joinAs === 'parent' && (
              <Card>
                <h3 className="item-title">Farzandingizni tanlang</h3>
                <p className="muted small">Ikki farzandingiz shu guruhda bo'lsa — ikkalasini ham belgilang. Boshqa guruhdagi farzand uchun o'sha guruh havolasini oching.</p>
                {!classmates && <Loading />}
                {classmates?.length === 0 && <p className="muted small">Guruhda hali o'quvchi yo'q. Farzandingiz avval o'zi havola orqali qo'shilsin.</p>}
                <div className="check-list">
                  {classmates?.map((c) => {
                    const on = picked.includes(c.id);
                    return (
                      <label key={c.id} className="check-row">
                        <input type="checkbox" checked={on}
                          onChange={(e) => setPicked((l) => (e.target.checked ? [...l, c.id] : l.filter((x) => x !== c.id)))} />
                        <span className={`check-box ${on ? 'on' : ''}`} aria-hidden="true">{on && <Icon name="check" size={16} />}</span>
                        <span className="check-text"><b>{c.label}</b></span>
                      </label>
                    );
                  })}
                </div>
                <p className="muted small">O'qituvchi tasdiqlagach, farzandingiz profilingizda paydo bo'ladi.</p>
              </Card>
            )}
          </>
        )}

        {done && (
          <div className="intro center intro-tall">
            <div className="status-circle"><Icon name="check" size={40} /></div>
            <h1 className="title-lg">{done.joined_as === 'student' ? `«${done.group_name}» guruhiga qo'shildingiz` : "So'rov yuborildi"}</h1>
            <p className="muted narrow">
              {done.joined_as === 'student'
                ? `Darslar, vazifalar va testlar endi shu yerda ko'rinadi.${done.new_profile ? ' Siz yangi profilga o\'tdingiz.' : ''}`
                : done.pending_children
                  ? `${done.pending_children} ta farzand bo'yicha so'rov o'qituvchiga yuborildi. Tasdiqlangach, Telegram'da xabar olasiz.`
                  : "Farzandingiz allaqachon bog'langan yoki so'rov kutilmoqda."}
            </p>
          </div>
        )}
      </Content>
      <BottomBar>
        {done || error ? (
          <Button onClick={finish}>Davom etish</Button>
        ) : (
          <>
            <Button onClick={submit} loading={busy}
              disabled={!info || !joinAs || (joinAs === 'parent' && picked.length === 0)}>
              {joinAs === 'parent' ? `Tanlanganlarni yuborish (${picked.length})` : "Qo'shilish"}
            </Button>
            <button type="button" className="link-btn link-muted" onClick={finish}>Keyinroq</button>
          </>
        )}
      </BottomBar>
    </Screen>
  );
}
