import type { ReactNode } from 'react';
import './field-icon.css';

type FieldIconName =
  | 'title' | 'description' | 'state' | 'type' | 'habit' | 'range' | 'role' | 'priority'
  | 'tag' | 'context' | 'list' | 'calendar' | 'start' | 'end' | 'due' | 'duration'
  | 'globe' | 'repeat' | 'progress' | 'bell' | 'link' | 'branch' | 'attachment'
  | 'history' | 'user' | 'id' | 'template' | 'script' | 'custom' | 'system';

export const fieldIconName = (path: string): FieldIconName => {
  if (path === 'custom' || path.startsWith('custom.')) return 'custom';
  if (path === 'script' || path === 'scripts' || path.startsWith('script.')) return 'script';
  if (path === 'title') return 'title';
  if (path === 'bodyMarkdown' || path === 'description') return 'description';
  if (path === 'state') return 'state';
  if (path === 'preset') return 'type';
  if (path === 'isHabit' || path.startsWith('habit.')) return 'habit';
  if (path === 'activeRange' || path === 'activeDuration') return 'range';
  if (path === 'role') return 'role';
  if (path === 'priority') return 'priority';
  if (path === 'tags') return 'tag';
  if (path === 'contexts') return 'context';
  if (path === 'area') return 'globe';
  if (path === 'project') return 'branch';
  if (path === 'list') return 'list';
  if (path === 'schedule.startAt') return 'start';
  if (path === 'schedule.endAt') return 'end';
  if (path === 'schedule.dueAt') return 'due';
  if (path === 'schedule.timezone' || path === 'recurrence.timezone') return 'globe';
  if (path === 'schedule.estimatedDuration' || path === 'schedule.actualDuration' || path.endsWith('Offset')) return 'duration';
  if (path.startsWith('schedule.')) return 'calendar';
  if (path === 'recurrence.closeAt') return 'end';
  if (path === 'recurrence.anchor') return 'start';
  if (path.startsWith('recurrence.')) return 'repeat';
  if (path.startsWith('progress.')) return 'progress';
  if (path === 'reminders') return 'bell';
  if (path === 'attachments') return 'attachment';
  if (['relations', 'subtasks', 'parent', 'isSubtask', 'isParent', 'parentDepth', 'childDepth'].includes(path)) return 'branch';
  if (path === 'closure.actor' || path === 'createdWithAppName') return 'user';
  if (path.startsWith('closure.') || path.startsWith('occurrence.') || path === 'cycleHistory') return 'history';
  if (path === 'id' || path.endsWith('Id')) return 'id';
  if (path === 'isTemplate') return 'template';
  return 'system';
};

const paths: Record<FieldIconName, ReactNode> = {
  title: <path d="M5 6h14M12 6v12M8 18h8"/>,
  description: <><path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/></>,
  state: <><circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  type: <><path d="m12 3 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
  habit: <><path d="M7 17c-2-4 1-7 4-10 0 3 2 4 3 1 3 3 4 6 2 9-2 3-7 3-9 0Z"/><path d="M10 18c0-2 1-3 2-4 0 2 2 2 2 4"/></>,
  range: <><path d="M5 7V4h3M16 4h3v3M19 17v3h-3M8 20H5v-3"/><path d="M8 12h8"/></>,
  role: <><circle cx="12" cy="8" r="3"/><path d="M6 20c.5-4 2.5-6 6-6s5.5 2 6 6"/></>,
  priority: <><path d="M6 21V4"/><path d="M6 5h11l-2 4 2 4H6"/></>,
  tag: <><path d="m4 5 7-1 9 9-7 7-9-9z"/><circle cx="9" cy="9" r="1"/></>,
  context: <><circle cx="12" cy="10" r="3"/><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12Z"/></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
  start: <><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/></>,
  end: <><circle cx="12" cy="12" r="9"/><path d="M9 9h6v6H9z"/></>,
  due: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
  duration: <><circle cx="12" cy="13" r="8"/><path d="M9 3h6M12 5v2M12 13l3-3"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
  repeat: <><path d="M17 7H7l3-3M7 17h10l-3 3"/><path d="m7 7 3 3M17 17l-3-3"/></>,
  progress: <><path d="M5 19V11M12 19V5M19 19v-8"/><path d="M3 19h18"/></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 6-3 6-3 8h18c0-2-3-2-3-8"/><path d="M10 21h4"/></>,
  link: <><path d="m10 14 4-4"/><path d="M8 17H6a4 4 0 0 1 0-8h4M14 7h4a4 4 0 0 1 0 8h-4"/></>,
  branch: <><path d="M7 4v12a4 4 0 0 0 4 4h6"/><path d="m14 17 3 3-3 3M7 9h7l3-3M14 3l3 3-3 3"/></>,
  attachment: <path d="m9 12 5-5a3 3 0 0 1 4 4l-7 7a5 5 0 0 1-7-7l7-7"/>,
  history: <><path d="M4 12a8 8 0 1 0 2-5.5L3 9"/><path d="M3 4v5h5M12 7v5l3 2"/></>,
  user: <><circle cx="12" cy="8" r="3"/><path d="M5 20c1-4 3-6 7-6s6 2 7 6"/></>,
  id: <><path d="M9 3 7 21M17 3l-2 18M4 9h16M3 15h16"/></>,
  template: <><rect x="7" y="7" width="12" height="14" rx="2"/><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"/></>,
  script: <><path d="M8 5H5v14h3M16 5h3v14h-3"/><path d="m10 15 4-6"/></>,
  custom: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
  system: <><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></>,
};

export function FieldIcon({ path, label, className = '' }: { path: string; label: string; className?: string }) {
  const name = fieldIconName(path);
  return <span className={`property-icon ${className}`.trim()} title={label} aria-hidden>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>
  </span>;
}

export function FieldIconLabel({ path, label }: { path: string; label: ReactNode }) {
  const accessibleLabel = typeof label === 'string' ? label : path;
  return <span className="property-label"><FieldIcon path={path} label={accessibleLabel} />{label}</span>;
}
