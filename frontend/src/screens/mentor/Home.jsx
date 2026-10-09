import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { todayISO } from '../../dates.js';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Chip, Content, EmptyState, ErrorBox, Header, IconButton, Loading } from '../../components/ui.jsx';

const STORAGE_KEY = 'mentor.group';
const readSaved = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };

function Tile({ icon, title, sub, warn, onClick }) {
  return (
    <button type="button" className={`tile ${warn ? 'tile-warn' : ''}`} onClick={onClick}>
      <span className="tile-icon"><Icon name={icon} size={22} /></span>
      <span className="tile-title">{title}</span>
      <span className="tile-sub">{sub}</span>
    </button>
  );
}

export default function MentorHome() {
  const navigate = useNavigate();
  const groups = useApi('/mentor/groups');
  const [savedId, setSavedId] = useState(readSaved);
  const [switching, setSwitching] = useState(false);

  const group = groups.data?.find((g) => String(g.id) === savedId) ?? groups.data?.[0];
  useEffect(() => {
    if (group) try { localStorage.setItem(STORAGE_KEY, String(group.id)); } catch { /* */ }
  }, [group]);

  const lessons = useApi(group ? `/mentor/groups/${group.id}/lessons` : null);
  const students = useApi(group ? `/mentor/groups/${group.id}/students` : null);
  const homework = useApi(group ? `/mentor/groups/${group.id}/assignments` : null);
  const tests = useApi(group ? `/mentor/groups/${group.id}/tests` : null);
  const today = lessons.data?.find((l) => l.lesson_date === todayISO());
  const attendance = useApi(today ? `/mentor/lessons/${today.id}/attendance` : null);

  const addBtn = <IconButton icon="plus" label="Yangi guruh" onClick={() => navigate('/groups/new')} />;
  if (groups.loading && !groups.data) return <><Header title="Mening guruhim" /><Loading /></>;
  if (groups.error) return <><Header title="Mening guruhim" /><Content><ErrorBox text={groups.error} onRetry={groups.reload} /></Content></>;
  if (!group) {
    return (
      <>
        <Header title="Mening guruhim" />
        <Content>
          <EmptyState icon="book" title="Hali guruhingiz yo'q"
            text="Guruh yarating va uning havolasini o'quvchilarga yuboring — ular o'zi qo'shiladi."
            action={<Button onClick={() => navigate('/groups/new')}>Guruh yaratish</Button>} />
        </Content>
      </>
    );
  }

  const base = `/g/${group.id}`;
  const total = students.data?.length ?? group.student_count;
  const linked = students.data?.filter((s) => s.confirmed_parents > 0).length;
  const marked = attendance.data?.length > 0;

  const nowTs = Date.now();
  const openTests = tests.data?.filter((t) => new Date(t.opens_at) <= nowTs && nowTs <= new Date(t.closes_at)).length ?? 0;
  const toCheck = homework.data?.reduce((n, a) => n + a.to_review + a.to_approve, 0) ?? 0;
  let attendanceSub = "Bugun dars yo'q";
  if (today) attendanceSub = marked ? 'Bugun belgilangan' : 'Bugun belgilanmagan';

  return (
    <>
      <Header title="Mening guruhim" right={addBtn} />
      <Content>
        <div className="hero-card">
          <div className="kv">
            <h2 className="hero-title">{group.name}</h2>
            {groups.data.length > 1 && (
              <button type="button" className="hero-btn hero-btn-sm" onClick={() => setSwitching((v) => !v)}>
                Almashtirish <Icon name="chev" size={14} />
              </button>
            )}
          </div>
          <p className="hero-sub">{group.student_count} o'quvchi{group.schedule ? ` · ${group.schedule}` : ''}</p>
          {switching && (
            <div className="chips hero-chips">
              {groups.data.map((g) => (
                <Chip key={g.id} active={g.id === group.id}
                  onClick={() => { setSavedId(String(g.id)); setSwitching(false); }}>{g.name}</Chip>
              ))}
            </div>
          )}
          <div className="row hero-actions">
            <button type="button" className="hero-btn hero-btn-light" onClick={() => navigate(`${base}/invite`)}>🔗 Taklif havolasi</button>
            <button type="button" className="hero-btn" onClick={() => navigate(`${base}/settings`)}>Sozlamalar</button>
          </div>
          <div className="hero-divider" />
          <p className="hero-label">Bugungi dars</p>
          <p className="hero-lesson">{today ? today.title : 'Hali yaratilmagan'}</p>
        </div>

        <div className="tiles">
          <Tile icon="book" title="Mavzular" sub={lessons.data ? `${lessons.data.length} ta dars` : '…'}
            onClick={() => navigate(`${base}/lessons`)} />
          <Tile icon="checksq" title="Yo'qlama" sub={attendanceSub} warn={!today || !marked}
            onClick={() => navigate(`${base}/attendance`)} />
          <Tile icon="users" title="O'quvchilar" sub={`${total} ta`}
            onClick={() => navigate(`${base}/students`)} />
          <Tile icon="link" title="Ota-onani bog'lash" sub={linked !== undefined ? `${linked} / ${total} bog'langan` : '…'}
            onClick={() => navigate(`${base}/students`)} />
          <Tile icon="sparkle" title="Uy vazifalari" warn={toCheck > 0}
            sub={homework.data ? (toCheck ? `${toCheck} ta tekshirish kerak` : `${homework.data.length} ta vazifa`) : '…'}
            onClick={() => navigate(`${base}/homework`)} />
          <Tile icon="tag" title="Chegirmalar" sub="Guruhingiz uchun" onClick={() => navigate(`${base}/discounts`)} />
          <Tile icon="trophy" title="Reyting" sub="Guruh o'quvchilari o'rni" onClick={() => navigate(`${base}/rating`)} />
          <Tile icon="test" title="Testlar"
            sub={tests.data ? (openTests ? `${openTests} ta ochiq test` : `${tests.data.length} ta test`) : '…'}
            onClick={() => navigate(`${base}/tests`)} />
        </div>
      </Content>
    </>
  );
}
