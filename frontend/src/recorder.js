/**
 * Ekrandan dars yozish (brauzer: getDisplayMedia + MediaRecorder).
 *
 * Video yozilayotgan paytning o'zida bo'lak-bo'lak (16 MB) omborga yuklanadi:
 * - dars tugaganda deyarli hammasi yuklangan bo'ladi, kutish qisqa;
 * - brauzer xotirasi to'lib qolmaydi (1,5 soatlik dars ham muammosiz);
 * - internet uzilsa yozish to'xtamaydi, bo'laklar navbatda turadi va ulanganda yuklanadi.
 * Pauza paytida hech narsa yozilmaydi (MediaRecorder.pause).
 */
import { api, tg } from './api.js';
import { absoluteUrl, putPart } from './materials.js';

const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
];

export function isPhone() {
  return ['android', 'ios'].includes(tg?.platform) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function insideTelegram() {
  return !!tg?.initData;
}

/** Shu qurilma/oynada ekranni yozish mumkinmi. */
export function recordingSupport() {
  const phone = isPhone();
  const api_ = !!navigator.mediaDevices?.getDisplayMedia && typeof window.MediaRecorder !== 'undefined'
    && MIME_TYPES.some((t) => window.MediaRecorder.isTypeSupported?.(t));
  return { phone, supported: api_ && !phone };
}

function pickMime() {
  return MIME_TYPES.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RecorderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // screen-denied | mic-denied | unsupported | server | not-monitor
  }
}

export class ScreenRecorder {
  constructor({ lessonId, mic = true, systemAudio = false, allowWindow = false, onUpdate = () => {} }) {
    this.lessonId = lessonId;
    this.allowWindow = allowWindow;
    this.withMic = mic;
    this.withSystemAudio = systemAudio;
    this.onUpdate = onUpdate;

    this.streams = [];
    this.buffer = [];
    this.bufferBytes = 0;
    this.queue = [];      // yuklanishi kerak bo'lgan bo'laklar: { n, blob }
    this.done = [];       // yuklangan bo'laklar: { part_number, etag }
    this.partNo = 0;
    this.uploading = false;

    this.recordedBytes = 0;
    this.uploadedBytes = 0;
    this.activeMs = 0;
    this.lastTick = 0;
    this.paused = false;
    this.pauses = 0;
    this.pausedMs = 0;
    this.level = 0;
    this.offline = false;
    this.stopped = false;
    this.cancelled = false;
  }

  snapshot() {
    return {
      elapsedMs: this.activeMs,
      paused: this.paused,
      pauses: this.pauses,
      pausedMs: this.pausedMs,
      recordedBytes: this.recordedBytes,
      uploadedBytes: this.uploadedBytes,
      pendingBytes: this.recordedBytes - this.uploadedBytes,
      level: this.level,
      offline: this.offline,
      hasMic: !!this.analyser,
      surface: this.surface,
      material: this.material,
    };
  }

  emit() {
    this.onUpdate(this.snapshot());
  }

  async start() {
    // 1) Ekran (va xohlasa — kompyuter ovozi)
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        // "Butun ekran" taklif qilinadi: o'qituvchi prezentatsiya va boshqa dasturlarga bemalol o'tadi
        video: { displaySurface: 'monitor', frameRate: { ideal: 15, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: this.withSystemAudio,
        selfBrowserSurface: 'exclude',
        systemAudio: this.withSystemAudio ? 'include' : 'exclude',
      });
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        throw new RecorderError('screen-denied', "Ekranni ulashishga ruxsat berilmadi");
      }
      throw new RecorderError('unsupported', "Bu oynada ekranni yozib bo'lmaydi");
    }
    this.streams.push(display);
    // Faqat bitta oyna yoki brauzer varag'i tanlansa — boshqa dasturga o'tganda u yozilmaydi
    this.surface = display.getVideoTracks()[0]?.getSettings?.().displaySurface;
    if (!this.allowWindow && this.surface && this.surface !== 'monitor') {
      this.cleanupStreams();
      throw new RecorderError('not-monitor', "Butun ekran tanlanmadi");
    }

    // 2) Mikrofon — shovqin va aks-sado kamaytiriladi
    let micStream = null;
    if (this.withMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        this.streams.push(micStream);
      } catch {
        this.cleanupStreams();
        throw new RecorderError('mic-denied', "Mikrofonga ruxsat berilmadi");
      }
    }

    // 3) Ovozlarni bitta yo'lakka aralashtiramiz (mikrofon + kompyuter ovozi)
    const audioTracks = [];
    const displayAudio = display.getAudioTracks();
    if (micStream || displayAudio.length) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = this.ctx.createMediaStreamDestination();
      if (micStream) {
        const src = this.ctx.createMediaStreamSource(micStream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        src.connect(this.analyser);
        src.connect(dest);
      }
      if (displayAudio.length) {
        const src = this.ctx.createMediaStreamSource(new MediaStream(displayAudio));
        const gain = this.ctx.createGain();
        gain.gain.value = 0.7; // o'qituvchi ovozi ustun bo'lsin
        src.connect(gain).connect(dest);
      }
      audioTracks.push(...dest.stream.getAudioTracks());
    }
    const stream = new MediaStream([...display.getVideoTracks(), ...audioTracks]);

    // 4) Serverda yozuv ochiladi
    this.mime = pickMime();
    try {
      const r = await api(`/mentor/lessons/${this.lessonId}/recordings`, {
        method: 'POST', body: { content_type: this.mime || 'video/webm' },
      });
      this.material = r.material;
      this.partSize = r.part_size;
      this.maxMs = r.max_minutes * 60 * 1000;
    } catch (e) {
      this.cleanupStreams();
      throw new RecorderError('server', e.message);
    }

    // 5) Yozish
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mime || undefined,
      videoBitsPerSecond: 1_000_000, // ekran uchun yetarli; serverda yana siqiladi
      audioBitsPerSecond: 64_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      this.buffer.push(e.data);
      this.bufferBytes += e.data.size;
      this.recordedBytes += e.data.size;
      if (this.bufferBytes >= this.partSize) this.cutPart();
    };
    this.stoppedPromise = new Promise((resolve) => { this.recorder.onstop = resolve; });
    // Foydalanuvchi brauzerning "Ulashishni to'xtatish" tugmasini bossa — yozuv yakunlanadi
    display.getVideoTracks()[0]?.addEventListener('ended', () => this.onScreenEnded?.());

    this.recorder.start(4000);
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 250);
    this.lockScreen();
    this.emit();
  }

  tick() {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.paused) this.pausedMs += dt;
    else this.activeMs += dt;

    if (this.analyser && !this.paused) {
      const data = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128));
      this.level = Math.min(1, peak / 64);
    } else {
      this.level = 0;
    }
    if (this.maxMs && this.activeMs >= this.maxMs) this.onLimit?.();
    this.emit();
  }

  async lockScreen() {
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* qo'llab-quvvatlanmaydi */ }
  }

  pause() {
    if (this.recorder?.state !== 'recording') return;
    this.recorder.pause();
    this.paused = true;
    this.pauses += 1;
    this.emit();
  }

  resume() {
    if (this.recorder?.state !== 'paused') return;
    this.recorder.resume();
    this.paused = false;
    this.emit();
  }

  cutPart() {
    if (!this.buffer.length) return;
    const blob = new Blob(this.buffer, { type: this.mime || 'video/webm' });
    this.buffer = [];
    this.bufferBytes = 0;
    this.partNo += 1;
    this.queue.push({ n: this.partNo, blob });
    this.pump();
  }

  /** Navbatdagi bo'laklarni ketma-ket yuklaydi; xato bo'lsa kutib, qayta urinadi (to'xtovsiz). */
  async pump() {
    if (this.uploading) return;
    this.uploading = true;
    let attempt = 0;
    while (this.queue.length && !this.cancelled) {
      const item = this.queue[0];
      try {
        const { url } = await api(`/mentor/recordings/${this.material.id}/parts/${item.n}`, { method: 'POST' });
        const etag = await putPart(absoluteUrl(url), item.blob);
        this.done.push({ part_number: item.n, etag });
        this.uploadedBytes += item.blob.size;
        this.queue.shift();
        attempt = 0;
        if (this.offline) { this.offline = false; this.emit(); }
      } catch {
        attempt += 1;
        this.offline = true;
        this.emit();
        await sleep(Math.min(30000, 2000 * 2 ** Math.min(attempt, 4)));
      }
    }
    this.uploading = false;
    this.drained?.();
  }

  cleanupStreams() {
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.streams = [];
    try { this.ctx?.close(); } catch { /* */ }
    try { this.wakeLock?.release(); } catch { /* */ }
  }

  /** Yozishni to'xtatadi, qolgan bo'laklarni yuklaydi va serverga "tayyor" deydi. */
  async finish(onProgress = () => {}) {
    if (this.stopped) return this.material;
    this.stopped = true;
    clearInterval(this.timer);
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
      await this.stoppedPromise;
    }
    this.cleanupStreams();
    this.cutPart(); // oxirgi bo'lak 5 MB dan kichik bo'lishi mumkin — S3 bunga ruxsat beradi

    // Hammasi yuklanguncha kutamiz
    while (this.queue.length || this.uploading) {
      onProgress(this.snapshot());
      await new Promise((resolve) => {
        this.drained = resolve;
        setTimeout(resolve, 500);
      });
    }
    onProgress(this.snapshot());
    if (!this.done.length) throw new Error("Yozuv bo'sh — hech narsa yozilmadi");
    const parts = [...this.done].sort((a, b) => a.part_number - b.part_number);
    return api(`/mentor/videos/${this.material.id}/complete`, { method: 'POST', body: { parts } });
  }

  /** Yozuvni bekor qiladi va serverdagi chala faylni o'chiradi. */
  async cancel() {
    this.cancelled = true;
    this.stopped = true;
    clearInterval(this.timer);
    try { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* */ }
    this.cleanupStreams();
    if (this.material) await api(`/mentor/videos/${this.material.id}/abort`, { method: 'POST' }).catch(() => {});
  }
}
