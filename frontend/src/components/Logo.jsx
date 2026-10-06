// Logotip belgisi: chat pufakchasi + bitiruv shapkasi + bildirishnoma nuqtasi
export default function Logo({ size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="EduConnect">
      <rect width="120" height="120" rx="30" fill="var(--brand)" />
      <rect x="22" y="26" width="76" height="58" rx="18" fill="#fff" />
      <polygon points="34,78 28,99 54,82" fill="#fff" />
      <path d="M60 36 L86 47 L60 58 L34 47 Z" fill="var(--brand)" />
      <path d="M45 52 L45 61 Q60 71 75 61 L75 52 L60 58 Z" fill="var(--brand)" />
      <path d="M84 48 L84 62" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="84" cy="64" r="3.5" fill="var(--brand)" />
      <circle cx="97" cy="27" r="12" fill="var(--warn)" stroke="var(--brand)" strokeWidth="5" />
    </svg>
  );
}
