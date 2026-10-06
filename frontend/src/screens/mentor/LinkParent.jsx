import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, initials } from '../../api.js';
import { useApi, useDebounced, useToast } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar, Card, Content, ErrorBox, Header, Loading, Pill, SearchField, useTelegramBack,
} from '../../components/ui.jsx';

const LINK_STATUS = {
  pending: { text: 'Tasdiq kutilmoqda', tone: 'warn' },
  confirmed: { text: 'Tasdiqlagan', tone: 'blue' },
  rejected: { text: 'Rad etgan', tone: 'grey' },
};

export default function LinkParent() {
  const { gid, sid } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const back = useCallback(() => navigate(`/g/${gid}/students`), [navigate, gid]);
  useTelegramBack(back);

  const students = useApi(`/mentor/groups/${gid}/students`);
  const links = useApi(`/mentor/students/${sid}/parents`);
  const student = students.data?.find((s) => String(s.id) === sid);

  const [q, setQ] = useState('');
  const term = useDebounced(q.trim());
  const results = useApi(term.length >= 3 ? `/mentor/parents/search?q=${encodeURIComponent(term)}` : null);
  const [busyId, setBusyId] = useState(null);
  const [guardianBusy, setGuardianBusy] = useState(false);

  async function toggleGuardian() {
    const value = !student.self_guardian;
    setGuardianBusy(true);
    try {
      await api(`/mentor/students/${sid}/self-guardian`, { method: 'POST', body: { value } });
      students.setData((list) => list.map((s) => (s.id === student.id ? { ...s, self_guardian: value } : s)));
      toast(value ? "Endi to'lov xabarlari o'quvchining o'ziga boradi" : "To'lov xabarlari yana ota-onaga boradi");
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setGuardianBusy(false);
    }
  }

  const activeLink = (parentId) => links.data?.find((l) => l.parent.id === parentId && l.status !== 'rejected');

  async function link(parent) {
    setBusyId(parent.id);
    try {
      await api(`/mentor/students/${sid}/parents`, { method: 'POST', body: { parent_id: parent.id } });
      toast("So'rov yuborildi. Ota-ona Telegram'da tasdiqlashi kerak");
      links.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Header title="Ota-onani bog'lash" onBack={back} />
      <Content>
        {student && (
          <Card className="card-tint">
            <div className="row">
              <Avatar text={initials(student)} />
              <div>
                <p className="muted small">O'quvchi</p>
                <h3 className="item-title">{student.first_name} {student.last_name}</h3>
              </div>
            </div>
          </Card>
        )}

        {student && (
          <label className="check-row toggle-card">
            <input type="checkbox" checked={student.self_guardian} disabled={guardianBusy} onChange={toggleGuardian} />
            <span className={`check-box ${student.self_guardian ? 'on' : ''}`} aria-hidden="true">
              {student.self_guardian && <Icon name="check" size={16} />}
            </span>
            <span className="check-text">
              <b>O'zi o'ziga vasiy</b>
              <span className="muted small">Masalan, voyaga yetgan o'quvchi. To'lov haqidagi xabarlar ota-onaga emas, o'quvchining o'ziga boradi.</span>
            </span>
          </label>
        )}

        <SearchField value={q} onChange={setQ} placeholder="Telefon raqam yoki ism" />
        <p className="muted small">Faqat «ota-ona» roli berilgan foydalanuvchilar orasida qidiriladi. Kamida 3 ta belgi kiriting.</p>

        {results.loading && <Loading />}
        {results.error && <ErrorBox text={results.error} />}
        {results.data?.length === 0 && (
          <p className="muted small center pad">
            Topilmadi. Ota-ona botda ro'yxatdan o'tgan va admin unga «ota-ona» rolini bergan bo'lishi kerak.
          </p>
        )}
        {results.data?.map((p) => {
          const existing = activeLink(p.id);
          return (
            <Card key={p.id} className="card-compact">
              <div className="row">
                <Avatar text={initials(p)} size={40} />
                <div className="grow">
                  <b>{p.first_name} {p.last_name}</b>
                  <p className="muted small">{p.phone_masked} · farzandlari: {p.children_count}</p>
                </div>
                {existing
                  ? <Pill tone={LINK_STATUS[existing.status].tone}>{LINK_STATUS[existing.status].text}</Pill>
                  : (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busyId === p.id} onClick={() => link(p)}>
                      {busyId === p.id ? <span className="spinner" /> : "Bog'lash"}
                    </button>
                  )}
              </div>
            </Card>
          );
        })}

        <h2 className="section-title">Bog'langan ota-onalar</h2>
        {links.loading && !links.data && <Loading />}
        {links.data?.length === 0 && <p className="muted small">Hali hech kim bog'lanmagan.</p>}
        {links.data?.length > 0 && (
          <Card className="card-flush">
            {links.data.map((l) => (
              <div key={l.id} className="list-row">
                <Avatar text={initials(l.parent)} size={36} />
                <b className="grow">{l.parent.first_name} {l.parent.last_name}</b>
                <Pill tone={LINK_STATUS[l.status].tone}>{LINK_STATUS[l.status].text}</Pill>
              </div>
            ))}
          </Card>
        )}
      </Content>
    </>
  );
}
