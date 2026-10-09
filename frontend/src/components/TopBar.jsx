import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useUnreadCount } from '../notificationsStore.js';
import { toggleTheme, useTheme } from '../theme.js';
import Icon from './Icon.jsx';
import { FullscreenToggle } from './ui.jsx';

const WEEKDAYS = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Daqiqa almashganda aniq yangilanadi
    let t = setTimeout(function tick() {
      setNow(new Date());
      t = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    }, 60000 - (Date.now() % 60000) + 50);
    return () => clearTimeout(t);
  }, []);
  return now;
}

let weatherCache = null; // sahifalar almashganda qayta so'ramaslik uchun

function useWeather() {
  const [w, setW] = useState(weatherCache?.data ?? null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (weatherCache && Date.now() - weatherCache.at < 15 * 60000) { setW(weatherCache.data); return; }
      try {
        const data = await api('/weather');
        weatherCache = { at: Date.now(), data };
        if (alive) setW(data);
      } catch { /* ob-havo bo'lmasa ham ilova ishlaydi */ }
    };
    load();
    const t = setInterval(load, 15 * 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return w;
}

/** Har bir sahifa tepasida: soat, sana, ob-havo, kunduzgi/tungi rejim va bildirishnomalar. */
export default function TopBar() {
  const navigate = useNavigate();
  const now = useClock();
  const weather = useWeather();
  const theme = useTheme();
  const unread = useUnreadCount();

  useEffect(() => {
    document.body.classList.add('has-topbar');
    return () => document.body.classList.remove('has-topbar');
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return (
    <div className="topbar">
      <div className="topbar-time">
        <b>{hh}:{mm}</b>
        <span>{WEEKDAYS[now.getDay()]}, {now.getDate()}-{MONTHS[now.getMonth()]}</span>
      </div>
      {weather && (
        <div className="topbar-weather" title={weather.text}>
          <span className="topbar-weather-icon" aria-hidden="true">{weather.icon}</span>
          <b>{weather.temp > 0 ? '+' : ''}{weather.temp}°</b>
          <span>{weather.city}</span>
        </div>
      )}
      <div className="topbar-actions">
        <button type="button" className="topbar-btn" onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'} title={theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
        </button>
        <button type="button" className="topbar-btn" onClick={() => navigate('/notifications')}
          aria-label={unread ? `Bildirishnomalar: ${unread} ta yangi` : 'Bildirishnomalar'} title="Bildirishnomalar">
          <Icon name="bell" size={20} />
          {unread > 0 && <span className="topbar-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <FullscreenToggle inline />
      </div>
    </div>
  );
}
