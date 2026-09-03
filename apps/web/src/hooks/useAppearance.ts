import { useEffect } from 'react';
import { effectiveWorkspaceNow, type WorkspaceDocument } from '@utm/core';
import { clockService } from '../services/clockService';
import { scheduledTheme } from '../utils/dates';

export function useAppearance(workspace: WorkspaceDocument | undefined, active: boolean) {
  const appearance = workspace?.calendarPreferences.appearance;
  useEffect(() => {
    if (!active) return;
    const apply = () => {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const mode = appearance?.mode ?? 'system';
      const now = workspace ? effectiveWorkspaceNow(workspace, clockService.now()) : clockService.now();
      const theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode === 'scheduled' ? scheduledTheme(appearance?.lightAt ?? '07:00', appearance?.darkAt ?? '19:00', now) : mode;
      document.documentElement.dataset.theme = theme;
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    apply(); media.addEventListener('change', apply);
    const unsubscribe = clockService.subscribe(apply, 30_000);
    return () => { media.removeEventListener('change', apply); unsubscribe(); };
  }, [appearance?.mode, appearance?.lightAt, appearance?.darkAt, active, workspace?.calendarPreferences.testClock]);
}
