/** O'qilmagan bildirishnomalar soni: har 30 soniyada va ilovaga qaytilganda yangilanadi. */
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.js';

let count = 0;
const listeners = new Set();
let timer = null;
let users = 0;

function set(n) {
  if (n === count) return;
  count = n;
  listeners.forEach((l) => l());
}

export async function refreshUnread() {
  try {
    const r = await api('/notifications/unread');
    set(r.count);
  } catch { /* tarmoq yo'q — keyingi safar */ }
}

export function setUnread(n) { set(Math.max(0, n)); }

const onVisible = () => { if (document.visibilityState === 'visible') refreshUnread(); };

/** Hisoblagichni ishga tushiradi (bitta komponent ishlatsa ham, bir nechtasi ishlatsa ham). */
export function useUnreadCount() {
  useEffect(() => {
    users += 1;
    if (users === 1) {
      refreshUnread();
      timer = setInterval(refreshUnread, 30000);
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      users -= 1;
      if (users === 0) {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => count);
}
