import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { absoluteUrl } from '../materials.js';
import { Chip, ErrorBox, Loading } from './ui.jsx';

const SPEEDS = [1, 1.25, 1.5, 2];

/** Dars videosi pleeri. trackProgress=true bo'lsa (o'quvchi), ko'rilgan joy serverga yuboriladi. */
export default function VideoPlayer({ material, trackProgress = false }) {
  const ref = useRef(null);
  const resumeAt = useRef(null);
  const lastSent = useRef(0);
  const retries = useRef(0);
  const [src, setSrc] = useState(null);
  const [error, setError] = useState('');
  const [rate, setRate] = useState(1);
  const posKey = `video.pos.${material.id}`;

  const loadUrl = useCallback(async () => {
    try {
      const r = await api(`/materials/${material.id}/url`);
      setSrc(absoluteUrl(r.url));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [material.id]);

  useEffect(() => { loadUrl(); }, [loadUrl]);

  const report = useCallback((force) => {
    const v = ref.current;
    if (!v || !v.duration) return;
    try { localStorage.setItem(posKey, String(Math.floor(v.currentTime))); } catch { /* */ }
    if (!trackProgress) return;
    const now = Date.now();
    if (!force && now - lastSent.current < 15000) return;
    lastSent.current = now;
    api(`/materials/${material.id}/progress`, {
      method: 'POST', body: { position: v.currentTime, duration: v.duration },
    }).catch(() => {});
  }, [material.id, posKey, trackProgress]);

  useEffect(() => () => report(true), [report]); // sahifadan chiqishda oxirgi joy

  function onLoaded() {
    const v = ref.current;
    v.playbackRate = rate;
    let at = resumeAt.current;
    if (at === null) {
      try { at = Number(localStorage.getItem(posKey)) || 0; } catch { at = 0; }
    }
    if (at > 5 && at < v.duration - 5) v.currentTime = at; // to'xtagan joydan davom
    resumeAt.current = null;
    retries.current = 0;
  }

  function onError() {
    // Havola eskirgan bo'lishi mumkin (uzoq pauza) — yangisini olib, shu joydan davom etamiz
    retries.current += 1;
    if (retries.current > 2) {
      setError("Videoni ochib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.");
      retries.current = 0;
      return;
    }
    if (ref.current) resumeAt.current = ref.current.currentTime;
    loadUrl();
  }

  function changeRate(r) {
    setRate(r);
    if (ref.current) ref.current.playbackRate = r;
  }

  if (error) return <ErrorBox text={error} onRetry={loadUrl} />;
  if (!src) return <Loading />;

  return (
    <div className="player">
      <video ref={ref} src={src} controls playsInline preload="metadata" controlsList="nodownload"
        onLoadedMetadata={onLoaded} onTimeUpdate={() => report(false)} onPause={() => report(true)}
        onEnded={() => report(true)} onError={onError} />
      <div className="chips">
        <span className="muted small speed-label">Tezlik:</span>
        {SPEEDS.map((r) => <Chip key={r} active={rate === r} onClick={() => changeRate(r)}>{r}x</Chip>)}
      </div>
    </div>
  );
}
