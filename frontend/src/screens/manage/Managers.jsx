import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatPhone, initials } from '../../api.js';
import { useApi, useToast } from '../../hooks.jsx';
import {
  Avatar, Button, Card, Chip, Content, EmptyState, ErrorBox, Header, Loading, useTelegramBack,
} from '../../components/ui.jsx';

function ManagerCard({ manager, branches, onSaved }) {
  const toast = useToast();
  const [ids, setIds] = useState(manager.branches.map((b) => b.id));
  const [busy, setBusy] = useState(false);
  const changed = ids.slice().sort().join() !== manager.branches.map((b) => b.id).sort().join();
  const toggle = (id) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  async function save() {
    setBusy(true);
    try {
      onSaved(await api(`/admin/managers/${manager.user.id}/branches`, { method: 'PUT', body: { branch_ids: ids } }));
      toast('Filiallar biriktirildi');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="row">
        <Avatar text={initials(manager.user)} />
        <div className="grow">
          <h3 className="item-title">{manager.user.first_name} {manager.user.last_name}</h3>
          <p className="muted small">{formatPhone(manager.phone)}</p>
        </div>
      </div>
      <p className="muted small">Biriktirilgan filiallar:</p>
      <div className="chips">
        {branches.map((b) => <Chip key={b.id} active={ids.includes(b.id)} onClick={() => toggle(b.id)}>{b.name}</Chip>)}
      </div>
      {changed && <Button onClick={save} loading={busy}>Saqlash</Button>}
    </Card>
  );
}

export default function Managers() {
  const navigate = useNavigate();
  const back = useCallback(() => navigate('/manage'), [navigate]);
  useTelegramBack(back);
  const managers = useApi('/admin/managers');
  const branches = useApi('/admin/branches');

  return (
    <>
      <Header title="Hududiy menejerlar" onBack={back} />
      <Content>
        <p className="muted small">Hududiy menejer rolini A'zolar bo'limida bering, so'ng shu yerda unga filiallarni biriktiring.</p>
        {(managers.loading && !managers.data) && <Loading />}
        {managers.error && <ErrorBox text={managers.error} onRetry={managers.reload} />}
        {managers.data?.length === 0 && <EmptyState icon="users" title="Hali hududiy menejer yo'q" />}
        {managers.data?.map((m) => (
          <ManagerCard key={m.user.id} manager={m} branches={(branches.data ?? []).filter((b) => b.is_active)}
            onSaved={(u) => managers.setData((list) => list.map((x) => (x.user.id === u.user.id ? u : x)))} />
        ))}
      </Content>
    </>
  );
}
