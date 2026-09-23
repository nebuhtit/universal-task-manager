import { describe, expect, it } from 'vitest';
import { STANDARD_ATTENTION_VIEW_SORT_SOURCE, VIEW_CREATION_DUE_PERIOD_EXTENSION, compileQuery, createItem } from '@utm/core';
import { BUILT_IN_VIEW_TEMPLATES, isViewTemplate, VIEW_TEMPLATE_FIELDS, viewFromTemplate } from './viewTemplates';

describe('view templates', () => {
  it('provides the requested reusable built-in templates with compact fields', () => {
    expect(VIEW_TEMPLATE_FIELDS).toEqual(['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project', 'scripts']);
    expect(BUILT_IN_VIEW_TEMPLATES.map((view) => view.name)).toEqual(['Inbox', 'Today', 'No date', 'Tomorrow', 'This week', 'All items', 'Some Area', 'Some Project']);
    expect(BUILT_IN_VIEW_TEMPLATES[3]?.query.source).toContain('scheduleInPeriod("tomorrow", "event_open,active,due", false');
    expect(BUILT_IN_VIEW_TEMPLATES[1]?.query.source).toContain('scheduleInPeriod("today", "event_open,event,active,due", true');
    expect(BUILT_IN_VIEW_TEMPLATES[1]?.query.source).toContain('activeRangeWhenSetOrOverdue == true');
    expect(BUILT_IN_VIEW_TEMPLATES[4]?.query.source).toContain('activeRangeWhenSetOrOverdue == true');
    expect(BUILT_IN_VIEW_TEMPLATES[3]?.fields).toEqual(BUILT_IN_VIEW_TEMPLATES[1]?.fields);
    expect(BUILT_IN_VIEW_TEMPLATES[1]?.extensions?.[VIEW_CREATION_DUE_PERIOD_EXTENSION]).toBe('today');
    expect(BUILT_IN_VIEW_TEMPLATES[3]?.extensions?.[VIEW_CREATION_DUE_PERIOD_EXTENSION]).toBe('tomorrow');
    expect(BUILT_IN_VIEW_TEMPLATES.every(isViewTemplate)).toBe(true);
    expect(BUILT_IN_VIEW_TEMPLATES.every((view) => JSON.stringify(view.fields) === JSON.stringify(VIEW_TEMPLATE_FIELDS))).toBe(true);
    expect(BUILT_IN_VIEW_TEMPLATES.every((view) => view.sortSource === STANDARD_ATTENTION_VIEW_SORT_SOURCE)).toBe(true);
    expect(BUILT_IN_VIEW_TEMPLATES.every(view => view.query.source.includes('canComplete == true'))).toBe(true);
    BUILT_IN_VIEW_TEMPLATES.forEach((view) => expect(() => compileQuery(view.query.source)).not.toThrow());
  });

  it('matches only items that can actually be completed, including default tasks', () => {
    const matches = compileQuery(BUILT_IN_VIEW_TEMPLATES.find(view => view.name === 'All items')!.query.source);
    const task = createItem('Task', 'task');
    expect(matches(task)).toBe(true);
    task.canBeCompleted = false;
    expect(matches(task)).toBe(false);
    const event = createItem('Event', 'event');
    event.schedule = { timezone: 'UTC', startAt: '2026-09-23T10:00:00Z', endAt: '2026-09-23T11:00:00Z' };
    expect(matches(event)).toBe(false);
    event.canBeCompleted = true;
    expect(matches(event)).toBe(true);
  });

  it('keeps Inbox limited to standalone unorganized items or IMPORTANT items', () => {
    const inbox = BUILT_IN_VIEW_TEMPLATES[0]!;
    const matches = compileQuery(inbox.query.source);
    const item = createItem('Unsorted');
    expect(matches(item)).toBe(true);
    item.areas = ['Work'];
    expect(matches(item)).toBe(false);
    item.tags = ['IMPORTANT'];
    expect(matches(item)).toBe(true);
    item.external = { provider: 'google_calendar', connectionId: 'account', calendarId: 'primary', eventId: 'event', sourceUrl: 'https://calendar.google.com/', readOnly: true, transparency: 'opaque', syncedAt: '2026-09-21T09:00:00.000Z' };
    expect(matches(item)).toBe(false);
    delete item.external;
    item.role = 'occurrence';
    expect(matches(item)).toBe(false);
  });

  it('turns a template into an ordinary view without carrying manual order', () => {
    const source = { ...BUILT_IN_VIEW_TEMPLATES[5]!, extensions: { 'utm:view-template': true, 'utm:manualOrder': ['old'], custom: true } };
    const view = viewFromTemplate(source, 'new-id');
    expect(view.id).toBe('new-id');
    expect(isViewTemplate(view)).toBe(false);
    expect(view.extensions).toEqual({ custom: true });
  });

  it('adds completion eligibility when an existing user template is applied', () => {
    const source = { ...BUILT_IN_VIEW_TEMPLATES[5]!, query: { source: 'state == "open"' } };
    const applied = viewFromTemplate(source, 'new-view');
    expect(applied.query.source).toBe('(state == "open") && canComplete == true');
    expect(source.query.source).toBe('state == "open"');
  });
});
