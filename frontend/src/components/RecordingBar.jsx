import { useLocation, useNavigate } from 'react-router-dom';
import { confirmDialog } from '../hooks.jsx';
import { formatDuration } from '../materials.js';
import { finishRecording, pauseRecording, resumeRecording, useRecording } from '../recordingStore.js';
import Icon from './Icon.jsx';

/** Yozuv ketayotganda ilovaning har bir sahifasida tepada turadigan panel. */
export default function RecordingBar() {
  const rec = useRecording();
  const location = useLocation();
  const navigate = useNavigate();
  const page = `/g/${rec.gid}/lessons/${rec.lid}/record`;
  if (!['live', 'finishing'].includes(rec.phase) || location.pathname === page || !rec.stats) return null;

  const s = rec.stats;
  async function stop() {
    if (await confirmDialog("Yozuv tugatilsinmi? Video saqlanadi va o'quvchilarga yuboriladi.")) {
      navigate(page);
      finishRecording();
    }
  }

  return (
    <div className={`rec-bar ${s.paused ? 'is-paused' : ''}`} role="status">
      <button type="button" className="rec-bar-main" onClick={() => navigate(page)}>
        <span className={s.paused ? 'rec-dot rec-dot-paused' : 'rec-dot'} />
        <span className="rec-bar-text">
          <b>{rec.phase === 'finishing' ? 'Yuklanmoqda…' : s.paused ? 'Pauza' : 'Yozilmoqda'} · {formatDuration(Math.floor(s.elapsedMs / 1000)) || '0:00'}</b>
          <span>{rec.lessonTitle}</span>
        </span>
      </button>
      {rec.phase === 'live' && (
        <>
          <button type="button" className="rec-bar-btn" aria-label={s.paused ? 'Davom ettirish' : 'Pauza'}
            onClick={s.paused ? resumeRecording : pauseRecording}>
            <Icon name={s.paused ? 'play' : 'pause'} size={18} />
          </button>
          <button type="button" className="rec-bar-btn rec-bar-stop" aria-label="Tugatish" onClick={stop}>
            <Icon name="stop" size={16} />
          </button>
        </>
      )}
    </div>
  );
}
