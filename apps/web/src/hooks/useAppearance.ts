import { useEffect } from 'react';
import type { WorkspaceDocument } from '@utm/core';
import { scheduledTheme } from '../utils/dates';

export function useAppearance(appearance: WorkspaceDocument['calendarPreferences']['appearance'] | undefined, active: boolean, now = new Date()) {
  useEffect(() => {
    const apply = () => {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const mode = appearance?.mode ?? 'system';
      const theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode === 'scheduled' ? scheduledTheme(appearance?.lightAt ?? '07:00', appearance?.darkAt ?? '19:00', now) : mode;
      document.documentElement.dataset.theme = theme;
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    apply(); media.addEventListener('change', apply);
    const timer = window.setInterval(apply, 30_000);
    return () => { media.removeEventListener('change', apply); window.clearInterval(timer); };
  }, [appearance?.mode, appearance?.lightAt, appearance?.darkAt, active, now.getHours(), now.getMinutes()]);
}
