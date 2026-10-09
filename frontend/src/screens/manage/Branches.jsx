import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isGeneral } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useBranding } from '../../branding.jsx';
import { useApi, useToast } from '../../hooks.jsx';
import {
  Button, Card, Content, EmptyState, ErrorBox, Field, Header, IconButton, Loading, Pill, Select, useTelegramBack,
} from '../../components/ui.jsx';

function BranchForm({ initial, onSaved, onCancel }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const cities = useApi('/public/cities');
  const [busy, setBusy] = useState(false);

  async function save(isActive = true) {
    setBusy(true);
    try {
      const body = { name: name.trim(), address: address.trim() || null, city: city || null, is_active: isActive };
      const saved = initial
        ? await api(`/admin/branches/${initial.id}`, { method: 'PUT', body })
        : await api('/admin/branches', { method: 'POST', body });
      toast(initial ? (isActive ? 'Saqlandi' : "Filial yopildi — ro'yxatdan o'tishda ko'rinmaydi") : "Filial qo'shildi");
      onSaved(saved);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="item-title">{initial ? 'Filialni tahrirlash' : 'Yangi filial'}</h3>
      <Field label="Nomi" placeholder="Filial nomi" value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="Manzil (ixtiyoriy)" placeholder="Shahar, ko'cha" value={address} onChange={(e) => setAddress(e.target.value)} />
      <Select label="Shahar (ob-havo uchun)" value={city} onChange={(e) => setCity(e.target.value)}>
        <option value="">Tanlanmagan — Toshkent</option>
        {(cities.data ?? []).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
      </Select>
      <div className="row">
        <Button variant="outline" onClick={onCancel}>Bekor qilish</Button>
        <Button onClick={() => save(true)} loading={busy} disabled={name.trim().length < 2}>Saqlash</Button>
      </div>
      {initial && (initial.is_active
        ? <button type="button" className="link-btn link-danger" onClick={() => save(false)}>Filialni yopish</button>
        : <button type="button" className="link-btn" onClick={() => save(true)}>Filialni qayta ochish</button>)}
    </Card>
  );
}

export default function Branches() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const branding = useBranding();
  const back = useCallback(() => navigate('/manage'), [navigate]);
  useTelegramBack(back);
  const { data, error, loading, reload } = useApi('/admin/branches');
  const [editing, setEditing] = useState(null); // null | 'new' | branch
  const canEdit = isGeneral(user.role);
  const saved = () => { setEditing(null); reload(); branding.reload(); };

  return (
    <>
      <Header title="Filiallar" onBack={back}
        right={canEdit && !editing && <IconButton icon="plus" label="Yangi filial" onClick={() => setEditing('new')} />} />
      <Content>
        {editing === 'new' && <BranchForm onCancel={() => setEditing(null)} onSaved={saved} />}
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data?.length === 0 && editing !== 'new' && (
          <EmptyState icon="home" title="Hali filial yo'q"
            text={canEdit ? "Birinchi filial qo'shilganda, hozirgi barcha foydalanuvchi va guruhlar unga biriktiriladi." : undefined}
            action={canEdit && <Button onClick={() => setEditing('new')}>Filial qo'shish</Button>} />
        )}
        {data?.map((b) => (editing?.id === b.id
          ? <BranchForm key={b.id} initial={b} onCancel={() => setEditing(null)} onSaved={saved} />
          : (
            <Card key={b.id} className={b.is_active ? '' : 'card-dim'}>
              <div className="kv">
                <div>
                  <h3 className="item-title">{b.name}</h3>
                  {b.address && <p className="muted small">{b.address}</p>}
                </div>
                {canEdit && <button type="button" className="link-btn" onClick={() => setEditing(b)}>Tahrirlash</button>}
              </div>
              <div className="chips">
                <Pill>{b.students} o'quvchi</Pill>
                {!b.is_active && <Pill tone="warn">Yopilgan</Pill>}
              </div>
              <p className="small"><b>Hududiy menejer:</b> {b.managers.length ? b.managers.map((m) => `${m.first_name} ${m.last_name}`).join(', ') : <span className="warn-text">biriktirilmagan</span>}</p>
              <p className="small"><b>Adminlar:</b> {b.admins.length ? b.admins.map((m) => `${m.first_name} ${m.last_name}`).join(', ') : <span className="warn-text">yo'q</span>}</p>
            </Card>
          )))}
      </Content>
    </>
  );
}
