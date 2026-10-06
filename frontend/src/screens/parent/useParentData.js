import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../hooks.jsx';

const KEY = 'parent.child';
const readSaved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

/** Farzandlar ro'yxati va tanlangan farzand (oxirgi tanlov eslab qolinadi). */
export function useChildren() {
  const children = useApi('/parent/children');
  const [savedId, setSavedId] = useState(readSaved);
  const child = children.data?.find((c) => String(c.id) === savedId) ?? children.data?.[0] ?? null;

  useEffect(() => {
    if (child) try { localStorage.setItem(KEY, String(child.id)); } catch { /* */ }
  }, [child]);

  return { children, child, select: (id) => setSavedId(String(id)) };
}

export function useChildProgress(childId) {
  const raw = useApi(childId ? `/learn/students/${childId}/video-progress` : null);
  return useMemo(() => Object.fromEntries((raw.data ?? []).map((p) => [p.material_id, p.percent])), [raw.data]);
}
