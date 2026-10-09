import Logo from './Logo.jsx';

/** Guruh havolasi kartochkasi: odam adashib boshqa guruhga yozilmasligi uchun barcha ma'lumot. */
export default function InviteCard({ info }) {
  return (
    <div className="invite-card">
      <div className="row"><Logo size={44} /><b className="grow">{info.center_name}</b></div>
      <div className="invite-rows">
        {info.branch_name && <p><span>📍 Filial</span><b>{info.branch_name}{info.branch_address ? `, ${info.branch_address}` : ''}</b></p>}
        <p><span>👥 Guruh</span><b>{info.group_name}</b></p>
        {info.mentor_name && <p><span>👨‍🏫 O'qituvchi</span><b>{info.mentor_name}</b></p>}
        {info.schedule && <p><span>🕒 Jadval</span><b>{info.schedule}</b></p>}
      </div>
    </div>
  );
}
