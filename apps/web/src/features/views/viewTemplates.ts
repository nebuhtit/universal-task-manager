import type { SavedView } from '@utm/core';

export const VIEW_TEMPLATE_EXTENSION = 'utm:view-template';
export const VIEW_TEMPLATE_FIELDS = ['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project'];

const active = 'state == "open" && role != "series_template" && isTemplate != true';
const defaultSort = 'schedule.dueAt asc nulls last\nschedule.startAt asc nulls last\norganizationOrder asc nulls last';

const template = (id: string, name: string, source: string, accent: string): SavedView => ({
  id: `builtin:${id}`,
  name,
  accent,
  query: { source },
  renderer: 'table',
  sort: [
    { field: 'schedule.dueAt', direction: 'asc', nulls: 'last' },
    { field: 'schedule.startAt', direction: 'asc', nulls: 'last' },
    { field: 'organizationOrder', direction: 'asc', nulls: 'last' },
  ],
  sortSource: defaultSort,
  fields: [...VIEW_TEMPLATE_FIELDS],
  extensions: { [VIEW_TEMPLATE_EXTENSION]: true },
});

export const BUILT_IN_VIEW_TEMPLATES: SavedView[] = [
  template('inbox', 'Inbox', `${active} && length(areas) == 0 && length(projects) == 0`, '#d9485f'),
  template('all', 'All', active, '#4254a6'),
  template('today-overdue', 'Today', `${active} && (eventToday == true || dueTodayOrOverdue == true)`, '#c27a00'),
  template('week-overdue', 'This week', `${active} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`, '#087f73'),
  template('some-area', 'Some Area', active, '#7048b8'),
  template('some-project', 'Some Project', active, '#b83280'),
];

export const isViewTemplate = (view: SavedView): boolean => view.extensions?.[VIEW_TEMPLATE_EXTENSION] === true;

export function viewFromTemplate(source: SavedView, id: string): SavedView {
  const next: SavedView = JSON.parse(JSON.stringify(source)) as SavedView;
  next.id = id;
  const extensions = { ...next.extensions };
  delete extensions[VIEW_TEMPLATE_EXTENSION];
  delete extensions['utm:manualOrder'];
  if (Object.keys(extensions).length) next.extensions = extensions; else delete next.extensions;
  return next;
}
