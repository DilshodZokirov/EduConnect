/**
 * Dars yozuvi butun ilova uchun bitta: o'qituvchi yozuv paytida ilovaning boshqa sahifalariga,
 * prezentatsiyaga yoki boshqa dasturlarga o'tishi mumkin — yozuv faqat «Tugatish» bosilganda
 * (yoki brauzerning «Ulashishni to'xtatish» tugmasida) to'xtaydi.
 *
 * Kompyuterdagi Chrome'da «suzuvchi panel» (Document Picture-in-Picture) ochiladi: u har doim
 * boshqa oynalar ustida turadi — prezentatsiya ko'rsatayotganda ham pauza va to'xtatish qo'l ostida.
 */
import { useSyncExternalStore } from 'react';
import { tg } from './api.js';
import { formatDuration } from './materials.js';
import { ScreenRecorder } from './recorder.js';

const initial = {
  phase: 'idle', // idle | starting | live | finishing | done
  gid: null,
  lid: null,
  lessonTitle: '',
  stats: null,
  material: null,
  duration: '',
  error: null, // { code, message }
  pipOpen: false,
};

let snapshot = initial;
const listeners = new Set();
let recorder = null;
let pipWindow = null;

function set(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
  renderPip();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRecording() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export const isRecordingActive = () => ['starting', 'live', 'finishing'].includes(snapshot.phase);

// ---------- Ilovani tasodifan yopishdan himoya ----------
function onBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
}

function guard(on) {
  try {
    if (on) tg?.enableClosingConfirmation?.();
    else tg?.disableClosingConfirmation?.();
  } catch { /* eski Telegram */ }
  if (on) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

// ---------- Amallar ----------
export async function startRecording({ gid, lid, lessonTitle, mic, systemAudio, allowWindow }) {
  if (isRecordingActive()) return;
  set({ ...initial, phase: 'starting', gid, lid, lessonTitle });
  const r = new ScreenRecorder({
    lessonId: lid, mic, systemAudio, allowWindow,
    onUpdate: (stats) => set({ stats }),
  });
  r.onScreenEnded = () => finishRecording();
  r.onLimit = () => finishRecording();
  recorder = r;
  guard(true);
  try {
    await r.start();
    set({ phase: 'live', stats: r.snapshot() });
  } catch (e) {
    recorder = null;
    guard(false);
    set({ phase: 'idle', error: { code: e.code || 'server', message: e.message } });
  }
}

export function pauseRecording() { recorder?.pause(); }
export function resumeRecording() { recorder?.resume(); }

export async function finishRecording() {
  const r = recorder;
  if (!r || r.stopped) return;
  closePip();
  set({ phase: 'finishing', duration: formatDuration(Math.floor(r.activeMs / 1000)) });
  try {
    const material = await r.finish((stats) => set({ stats }));
    set({ phase: 'done', material });
  } catch (e) {
    set({ phase: 'idle', error: { code: 'server', message: e.message } });
  } finally {
    recorder = null;
    guard(false);
  }
}

export async function cancelRecording() {
  const r = recorder;
  recorder = null;
  closePip();
  guard(false);
  set({ ...initial });
  if (r) await r.cancel();
}

export function resetRecording() {
  if (!isRecordingActive()) set({ ...initial });
}

// ---------- Suzuvchi panel (Document Picture-in-Picture, Chrome 116+) ----------
export const pipSupported = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

const PIP_CSS = `
  *{box-sizing:border-box;margin:0}
  body{font-family:Manrope,Inter,system-ui,sans-serif;background:#10263d;color:#fff;display:flex;flex-direction:column;
    justify-content:center;gap:10px;padding:12px 14px;height:100vh;user-select:none}
  .top{display:flex;align-items:center;gap:10px}
  .dot{width:12px;height:12px;border-radius:50%;background:#e5484d;box-shadow:0 0 0 4px rgba(229,72,77,.3);animation:b 1.2s infinite}
  .paused .dot{background:#f3a24a;box-shadow:0 0 0 4px rgba(243,162,74,.3);animation:none}
  @keyframes b{50%{opacity:.35}}
  .time{font-size:28px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.5px}
  .label{font-size:11px;font-weight:800;letter-spacing:1.4px;color:#c9d6e4}
  .row{display:flex;gap:8px}
  button{flex:1;height:40px;border:none;border-radius:10px;font:inherit;font-size:14px;font-weight:800;color:#fff;cursor:pointer}
  .pause{background:#f3a24a}.resume{background:#1f6fb2}.stop{background:#d93a3f}
  .net{font-size:11px;color:#ffc9a0}
`;

export async function openPip() {
  if (!pipSupported() || pipWindow || snapshot.phase !== 'live') return false;
  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 280, height: 150 });
  } catch {
    pipWindow = null;
    return false;
  }
  const style = pipWindow.document.createElement('style');
  style.textContent = PIP_CSS;
  pipWindow.document.head.append(style);
  pipWindow.document.title = 'Dars yozuvi';
  pipWindow.document.body.innerHTML = `
    <div class="top"><span class="dot"></span><div><div class="label" data-k="label"></div><div class="time" data-k="time"></div></div></div>
    <div class="net" data-k="net"></div>
    <div class="row"><button data-k="toggle"></button><button class="stop" data-k="stop">■ Tugatish</button></div>`;
  pipWindow.document.querySelector('[data-k="toggle"]').addEventListener('click', () => {
    if (snapshot.stats?.paused) resumeRecording(); else pauseRecording();
  });
  // Tasodifan bosilmasligi uchun ikki bosqichli: birinchi bosish — «Tasdiqlang», ikkinchisi — tugatadi
  let armed = null;
  const stopBtn = pipWindow.document.querySelector('[data-k="stop"]');
  stopBtn.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      finishRecording();
      return;
    }
    stopBtn.textContent = 'Tasdiqlang ✓';
    armed = setTimeout(() => { armed = null; stopBtn.textContent = '■ Tugatish'; }, 3000);
  });
  pipWindow.addEventListener('pagehide', () => {
    pipWindow = null;
    set({ pipOpen: false });
  });
  set({ pipOpen: true });
  return true;
}

function closePip() {
  try { pipWindow?.close(); } catch { /* */ }
  pipWindow = null;
  if (snapshot.pipOpen) snapshot = { ...snapshot, pipOpen: false };
}

function renderPip() {
  if (!pipWindow) return;
  const d = pipWindow.document;
  const s = snapshot.stats;
  if (!s) return;
  d.body.classList.toggle('paused', s.paused);
  d.querySelector('[data-k="label"]').textContent = s.paused ? 'PAUZA' : 'YOZILMOQDA';
  d.querySelector('[data-k="time"]').textContent = formatDuration(Math.floor(s.elapsedMs / 1000)) || '0:00';
  d.querySelector('[data-k="net"]').textContent = s.offline ? 'Internet uzildi — yozish davom etmoqda' : '';
  const toggle = d.querySelector('[data-k="toggle"]');
  toggle.textContent = s.paused ? '▶ Davom etish' : '❚❚ Pauza';
  toggle.className = s.paused ? 'resume' : 'pause';
}
