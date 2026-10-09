/** Kunduzgi / tungi rejim. Tanlov shu qurilmada eslab qolinadi; birinchi marta — Telegram mavzusiga qarab. */
import { useSyncExternalStore } from 'react';
import { tg } from './api.js';

const KEY = 'educonnect.theme';
const listeners = new Set();

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* */ }
  return tg?.colorScheme === 'dark' ? 'dark' : 'light';
}

let theme = initial();

function apply() {
  document.documentElement.dataset.theme = theme;
  const bg = theme === 'dark' ? '#0f1923' : '#f4f5f7';
  const surface = theme === 'dark' ? '#16222f' : '#ffffff';
  try {
    tg?.setHeaderColor?.(surface);
    tg?.setBackgroundColor?.(bg);
    tg?.setBottomBarColor?.(surface);
  } catch { /* eski Telegram */ }
}
apply();

export function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, theme); } catch { /* */ }
  apply();
  listeners.forEach((l) => l());
}

export function useTheme() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => theme);
}
