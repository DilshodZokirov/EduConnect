import { useMemo } from 'react';
import { useAuth } from '../../auth.jsx';
import { useApi } from '../../hooks.jsx';

/** O'quvchining guruhlari va videolarni ko'rish holati (material_id -> foiz). */
export function useStudentData() {
  const { user } = useAuth();
  const groups = useApi('/student/groups');
  const progressRaw = useApi(`/learn/students/${user.id}/video-progress`);
  const progress = useMemo(
    () => Object.fromEntries((progressRaw.data ?? []).map((p) => [p.material_id, p.percent])),
    [progressRaw.data],
  );
  return { user, groups, progress, reloadProgress: progressRaw.reload };
}
