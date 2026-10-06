import { useState } from 'react';
import { formatDate } from '../../dates.js';
import { useApi, useToast } from '../../hooks.jsx';
import { formatDuration, formatSize, openMaterial, sendToTelegram } from '../../materials.js';
import Icon from '../../components/Icon.jsx';
import VideoPlayer from '../../components/VideoPlayer.jsx';
import { Card, Content, ErrorBox, Header, Loading, Pill, useTelegramBack } from '../../components/ui.jsx';

function Material({ m, track, percent, open, onToggle }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');

  async function run(kind, fn, okText) {
    setBusy(kind);
    try { await fn(); if (okText) toast(okText); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  const icon = { video: 'video', link: 'globe' }[m.kind] ?? 'file';
  const sub = m.kind === 'video'
    ? [formatDuration(m.duration_seconds), percent !== undefined ? `${percent}% ko'rilgan` : ''].filter(Boolean).join(' · ')
    : m.kind === 'link' ? 'Havola' : formatSize(m.size_bytes);

  return (
    <div className="material">
      <div className="list-row material-head">
        <span className="setting-icon"><Icon name={icon} size={20} /></span>
        <div className="grow">
          <b className="break">{m.name}</b>
          <p className="muted small">{sub}</p>
        </div>
      </div>
      <div className="material-actions">
        {m.kind === 'video' && (
          <button type="button" className="mini-btn primary" onClick={onToggle}>{open ? 'Yopish' : '▶ Ko\'rish'}</button>
        )}
        {m.kind === 'link' && <button type="button" className="mini-btn primary" onClick={() => openMaterial(m)}>Ochish</button>}
        {m.kind === 'file' && (
          <>
            <button type="button" className="mini-btn primary" disabled={!!busy} onClick={() => run('v', () => openMaterial(m))}>Ko'rish</button>
            <button type="button" className="mini-btn" disabled={!!busy} onClick={() => run('d', () => openMaterial(m, { download: true }))}>Yuklab olish</button>
          </>
        )}
        {(m.kind === 'file' || m.kind === 'telegram') && (
          <button type="button" className="mini-btn" disabled={!!busy}
            onClick={() => run('t', () => sendToTelegram(m), 'Telegram chatingizga yuborildi')}>
            {busy === 't' ? 'Yuborilmoqda…' : 'Telegramga'}
          </button>
        )}
      </div>
      {open && m.kind === 'video' && <VideoPlayer material={m} trackProgress={track} />}
    </div>
  );
}

/** Bitta dars: mavzu, tavsif va materiallar. track=true — o'quvchi (video ko'rish hisoblanadi). */
export default function LessonView({ gid, lid, track = false, progress = {}, onBack }) {
  useTelegramBack(onBack);
  const { data, error, loading, reload } = useApi(`/learn/groups/${gid}/lessons`);
  const lesson = data?.find((l) => String(l.id) === String(lid));
  const firstVideo = lesson?.materials.find((m) => m.kind === 'video');
  const [openId, setOpenId] = useState(null);
  const activeId = openId ?? firstVideo?.id ?? null; // birinchi video darhol ochiq turadi

  return (
    <>
      <Header title="Dars" onBack={onBack} />
      <Content>
        {loading && !data && <Loading />}
        {error && <ErrorBox text={error} onRetry={reload} />}
        {data && !lesson && <ErrorBox text="Dars topilmadi" />}
        {lesson && (
          <>
            <div className="hero-card">
              <p className="hero-label">{formatDate(lesson.lesson_date)}</p>
              <h2 className="hero-title">{lesson.title}</h2>
              {lesson.description && <p className="hero-sub">{lesson.description}</p>}
            </div>
            <h2 className="section-title">Materiallar</h2>
            {lesson.materials.length === 0
              ? <p className="muted small">Bu darsga hali material qo'shilmagan.</p>
              : (
                <Card className="card-flush">
                  {lesson.materials.map((m) => (
                    <Material key={m.id} m={m} track={track} percent={m.kind === 'video' ? (progress[m.id] ?? (track ? 0 : undefined)) : undefined}
                      open={activeId === m.id} onToggle={() => setOpenId(activeId === m.id ? -1 : m.id)} />
                  ))}
                </Card>
              )}
            {track && firstVideo && (
              <p className="muted small center"><Pill tone="grey">Maslahat</Pill> Videoni oxirigacha ko'ring — mentor ko'rganingizni biladi.</p>
            )}
          </>
        )}
      </Content>
    </>
  );
}
