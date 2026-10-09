import { useState } from 'react';
import { api, initials } from '../../api.js';
import { confirmDialog, timeAgo, useApi, useToast } from '../../hooks.jsx';
import { Avatar, Button, Card } from '../../components/ui.jsx';

/** Havola orqali kelgan ota-onalarning "bu mening farzandim" so'rovlari — o'qituvchi tasdiqlaydi. */
/** Havola orqali "ota-ona" bo'lib kelgan, lekin farzand tanlamaganlar — ko'pincha adashgan o'quvchi. */
function UnlinkedParents({ groupId, onChanged }) {
  const toast = useToast();
  const { data, setData } = useApi(`/mentor/groups/${groupId}/unlinked-parents`);
  const [busy, setBusy] = useState(null);
  if (!data?.length) return null;

  async function makeStudent(p) {
    if (!(await confirmDialog(`${p.first_name} ${p.last_name} aslida o'quvchimi? U shu guruhga o'quvchi sifatida qo'shiladi.`))) return;
    setBusy(p.id);
    try {
      await api(`/mentor/users/${p.id}/role`, { method: 'POST', body: { role: 'student', group_id: Number(groupId) } });
      toast("Rol tuzatildi: endi u o'quvchi");
      setData((list) => list.filter((x) => x.id !== p.id));
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h2 className="section-title">Farzand tanlamagan ota-onalar ({data.length})</h2>
      <p className="muted small">Havola orqali «ota-ona» bo'lib ro'yxatdan o'tgan, lekin farzandini belgilamagan. Agar bu aslida o'quvchi bo'lsa — rolini tuzating.</p>
      {data.map((p) => (
        <Card key={p.id}>
          <div className="row">
            <Avatar text={initials(p)} size={40} />
            <b className="grow">{p.first_name} {p.last_name}</b>
            <button type="button" className="mini-btn" onClick={() => makeStudent(p)} disabled={busy === p.id}>Bu o'quvchi</button>
          </div>
        </Card>
      ))}
      {groupId && <UnlinkedParents groupId={groupId} onChanged={onChanged} />}
    </>
  );
}

export default function ParentRequests({ groupId, onChanged }) {
  const toast = useToast();
  const { data, setData } = useApi('/mentor/parent-requests');
  const [busy, setBusy] = useState(null);
  if (!data?.length) return groupId ? <UnlinkedParents groupId={groupId} onChanged={onChanged} /> : null;

  async function decide(l, decision) {
    setBusy(l.id);
    try {
      await api(`/mentor/parent-requests/${l.id}/${decision}`, { method: 'POST' });
      toast(decision === 'confirm' ? 'Tasdiqlandi — ota-onaga xabar yuborildi' : 'Rad etildi');
      setData((list) => list.filter((x) => x.id !== l.id));
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function actuallyStudent(l) {
    if (!(await confirmDialog(`${l.parent.first_name} ${l.parent.last_name} aslida o'quvchimi? U shu guruhga o'quvchi sifatida qo'shiladi.`))) return;
    setBusy(l.id);
    try {
      await api(`/mentor/users/${l.parent.id}/role`, { method: 'POST', body: { role: 'student', group_id: Number(groupId) } });
      toast("Rol tuzatildi: endi u o'quvchi");
      setData((list) => list.filter((x) => x.parent.id !== l.parent.id));
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h2 className="section-title">Ota-ona so'rovlari ({data.length})</h2>
      {data.map((l) => (
        <Card key={l.id} className="card-warn">
          <div className="row">
            <Avatar text={initials(l.parent)} size={40} />
            <p className="grow small"><b>{l.parent.first_name} {l.parent.last_name}</b> o'zini <b>{l.student.first_name} {l.student.last_name}</b>ning ota-onasi deb ko'rsatdi · {timeAgo(l.created_at)}</p>
          </div>
          <div className="row">
            <Button onClick={() => decide(l, 'confirm')} loading={busy === l.id}>Tasdiqlash</Button>
            <Button variant="outline" onClick={() => decide(l, 'reject')} disabled={busy === l.id}>Rad etish</Button>
          </div>
          {groupId && (
            <button type="button" className="link-btn link-muted" onClick={() => actuallyStudent(l)} disabled={busy === l.id}>
              Adashibdi — bu o'quvchi
            </button>
          )}
        </Card>
      ))}
    </>
  );
}
