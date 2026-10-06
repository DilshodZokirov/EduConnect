import { useCallback, useEffect, useState } from 'react';
import { api, money } from '../api.js';
import { formatDate } from '../dates.js';
import Icon from './Icon.jsx';
import { Button, Card, Content, Screen, Splash } from './ui.jsx';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function LockScreen({ lock, onCheck, checking }) {
  const total = lock.debts.reduce((a, d) => a + d.left, 0);
  if (!lock.show_amounts) {
    // Farzandning o'qishiga ta'sir qilmaslik uchun unga summa va qarz ko'rsatilmaydi
    return (
      <Screen>
        <Content className="content-roomy">
          <div className="intro center intro-tall">
            <div className="status-circle"><Icon name="lock" size={40} /></div>
            <h1 className="title-lg">Ilova vaqtincha yopiq</h1>
            <p className="muted narrow">Batafsil ma'lumotni ota-onangizdan so'rang. Ilova tez orada yana ochiladi.</p>
          </div>
          <Button variant="outline" onClick={onCheck} loading={checking}>Qayta tekshirish</Button>
        </Content>
      </Screen>
    );
  }
  return (
    <Screen>
      <Content className="content-roomy">
        <div className="intro center intro-tall">
          <div className="status-circle warn"><Icon name="lock" size={40} /></div>
          <h1 className="title-lg">Bot vaqtincha yopildi</h1>
          <p className="muted narrow">To'lov muddati o'tib ketdi. To'lov qabul qilinishi bilan bot avtomatik ochiladi.</p>
        </div>
        <Card>
          {lock.debts.map((d, i) => (
            <div key={i} className="kv debt-row">
              <div>
                <b>{d.student_name}</b>
                <p className="muted small">{d.group_name} · {MONTHS[Number(d.period.slice(5, 7)) - 1]} · muddat {formatDate(d.due_date, false)}</p>
              </div>
              <b>{money(d.left)}</b>
            </div>
          ))}
          <div className="divider" />
          <div className="kv"><b>Jami qarz</b><b className="warn-text">{money(total)} so'm</b></div>
        </Card>
        <p className="muted small center">To'lovni o'quv markaz administratoriga qiling.</p>
        {lock.support_phone && (
          <a className="btn btn-outline" href={`tel:${lock.support_phone.replace(/[^\d+]/g, '')}`}>📞 {lock.support_phone}</a>
        )}
        <Button onClick={onCheck} loading={checking}>To'lovni tekshirish</Button>
      </Content>
    </Screen>
  );
}

/** O'quvchi va ota-ona uchun: to'lov muddati o'tgan bo'lsa, butun ilova o'rniga qulf ekrani. */
export default function LockGate({ children }) {
  const [lock, setLock] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try { setLock(await api('/me/lock')); } catch { setLock((l) => l ?? { locked: false, debts: [] }); }
    setChecking(false);
  }, []);

  useEffect(() => {
    check();
    const onLocked = () => check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('payment-locked', onLocked);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('payment-locked', onLocked);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  if (!lock) return <Splash />;
  if (lock.locked) return <LockScreen lock={lock} onCheck={check} checking={checking} />;
  return children;
}
