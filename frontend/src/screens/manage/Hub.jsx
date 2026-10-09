import { useNavigate } from 'react-router-dom';
import { isGeneral, isManager, ROLE_NAMES } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { useBranding } from '../../branding.jsx';
import { useApi } from '../../hooks.jsx';
import Icon from '../../components/Icon.jsx';
import { Content, Header, Pill } from '../../components/ui.jsx';

function Item({ icon, title, sub, badge, onClick }) {
  return (
    <button type="button" className="setting-row" onClick={onClick}>
      <span className="setting-icon"><Icon name={icon} size={20} /></span>
      <span className="setting-text"><b>{title}</b>{sub && <span className="muted small">{sub}</span>}</span>
      {badge}
      <Icon name="right" size={18} />
    </button>
  );
}

/** Boshqaruv: rolga qarab kerakli bo'limlar. */
export default function Hub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { name } = useBranding();
  const approvals = useApi(isManager(user.role) ? '/admin/approvals' : null);
  const waiting = approvals.data?.length ?? 0;

  return (
    <>
      <Header title="Boshqaruv" />
      <Content>
        <p className="muted small">{name} · {ROLE_NAMES[user.role]}{user.branch_name && user.role === 'admin' ? ` · ${user.branch_name}` : ''}</p>
        <div className="card card-flush">
          {isManager(user.role) && (
            <Item icon="users" title="Ishga tayinlash" sub="Qidiruv, rol va filial berish, vakolatni topshirish"
              onClick={() => navigate('/manage/staff')} />
          )}
          <Item icon="user" title="A'zolar" sub="Qidiruv, bloklash" onClick={() => navigate('/members')} />
          <Item icon="home" title="Filiallar" sub={isGeneral(user.role) ? "Filial qo'shish va tahrirlash" : "Filiallar ma'lumoti"}
            onClick={() => navigate('/manage/branches')} />
          {isManager(user.role) && waiting > 0 && (
            <Item icon="shield" title="Admin so'rovlari (eski)" sub="Oldingi tartibda yuborilgan takliflar"
              badge={waiting > 0 ? <Pill tone="warn">{waiting}</Pill> : null} onClick={() => navigate('/manage/approvals')} />
          )}
          {isGeneral(user.role) && (
            <Item icon="users" title="Hududiy menejerlar" sub="Menejerlarga filial biriktirish" onClick={() => navigate('/manage/managers')} />
          )}
          <Item icon="tag" title="Chegirmalar" sub="Chegirma turlari va berilganlar" onClick={() => navigate('/payments/discounts')} />
          {user.role === 'superadmin' && (
            <Item icon="edit" title="Markaz sozlamalari" sub="Nomi va logotipi" onClick={() => navigate('/manage/settings')} />
          )}
        </div>
      </Content>
    </>
  );
}
