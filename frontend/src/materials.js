import { api, tg } from './api.js';

export const absoluteUrl = (u) => new URL(u, window.location.origin).href;

export function openExternal(url) {
  try {
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener');
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Faylni ko'rish (download=false) yoki yuklab olish (download=true). */
export async function openMaterial(material, { download = false } = {}) {
  if (material.kind === 'link') {
    openExternal(material.url);
    return;
  }
  const r = await api(`/materials/${material.id}/url${download ? '?download=true' : ''}`);
  const url = absoluteUrl(r.url);
  // Telegram 8.0+: ilova ichidan to'g'ridan-to'g'ri yuklab olish oynasi
  if (download && tg?.downloadFile && tg.isVersionAtLeast?.('8.0')) {
    tg.downloadFile({ url, file_name: r.filename || material.name });
    return;
  }
  openExternal(url);
}

export async function sendToTelegram(material) {
  await api(`/materials/${material.id}/send`, { method: 'POST' });
}

export function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Bitta bo'lakni omborga yuklaydi va ETag qaytaradi. */
function putPart(url, blob, onLoaded) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (new URL(url).origin === window.location.origin) xhr.setRequestHeader('ngrok-skip-browser-warning', '1');
    xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader('ETag');
      if (xhr.status >= 200 && xhr.status < 300 && etag) {
        onLoaded(blob.size);
        resolve(etag);
      } else {
        reject(new Error(`Yuklashda xato (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Internet aloqasi uzildi'));
    xhr.send(blob);
  });
}

/**
 * Videoni bo'laklab, to'g'ridan-to'g'ri omborga yuklaydi.
 * Har bir bo'lak xato bo'lsa 4 martagacha qayta urinadi. onProgress(0..1).
 */
export async function uploadVideo(lessonId, file, name, onProgress) {
  const start = await api(`/mentor/lessons/${lessonId}/videos`, {
    method: 'POST',
    body: { filename: file.name, size: file.size, content_type: file.type || null, name: name || null },
  });
  const { material, part_size: partSize, parts } = start;
  const loaded = new Array(parts.length).fill(0);
  const done = [];
  const report = () => onProgress(Math.min(1, loaded.reduce((a, b) => a + b, 0) / file.size));

  async function uploadOne(part) {
    const i = part.part_number - 1;
    const blob = file.slice(i * partSize, Math.min((i + 1) * partSize, file.size));
    for (let attempt = 1; ; attempt += 1) {
      try {
        const etag = await putPart(absoluteUrl(part.url), blob, (n) => { loaded[i] = n; report(); });
        done.push({ part_number: part.part_number, etag });
        return;
      } catch (e) {
        loaded[i] = 0;
        report();
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  let next = 0;
  const lane = async () => {
    while (next < parts.length) {
      const part = parts[next];
      next += 1;
      await uploadOne(part);
    }
  };

  try {
    await Promise.all([lane(), lane(), lane()]); // 3 ta bo'lak parallel
    return await api(`/mentor/videos/${material.id}/complete`, { method: 'POST', body: { parts: done } });
  } catch (e) {
    api(`/mentor/videos/${material.id}/abort`, { method: 'POST' }).catch(() => {});
    throw e;
  }
}
