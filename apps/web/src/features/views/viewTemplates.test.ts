import { describe, expect, it } from 'vitest';
import { STANDARD_ATTENTION_VIEW_SORT_SOURCE, compileQuery, createItem } from '@utm/core';
import { BUILT_IN_VIEW_TEMPLATES, isViewTemplate, VIEW_TEMPLATE_FIELDS, viewFromTemplate } from './viewTemplates';

describe('view templates', () => {
  it('provides the requested reusable built-in templates with compact fields', () => {
    expect(VIEW_TEMPLATE_FIELDS).toEqual(['title', 'bodyMarkdown', 'schedule.startAt', 'schedule.dueAt', 'tags', 'area', 'project']);
    expect(BUILT_IN_VIEW_TEMPLATES.map((view) => view.name)).toEqual(['Inbox', 'All', 'Today', 'Tomorrow', 'This week', 'Some Area', 'Some Project']);
    expect(BUILT_IN_VIEW_TEMPLATES[3]?.query.source).toContain('scheduleInPeriod("tomorrow", "event_open,active,due", false');
    expect(BUILT_IN_VIEW_TEMPLATES[2]?.query.source).toContain('scheduleInPeriod("today", "event_open,event,active,due", true');
    expect(BUILT_IN_VIEW_TEMPLATES[2]?.query.source).toContain('activeRangeWhenSet == true');
    expect(BUILT_IN_VIEW_TEMPLATES[4]?.query.source).toContain('activeRangeWhenSet == true');
    expect(BUILT_IN_VIEW_TEMPLATES[3]?.fields).toEqual(BUILT_IN_VIEW_TEMPLATES[2]?.fields);
    expect(BUILT_IN_VIEW_TEMPLATES.every(isViewTemplate)).toBe(true);
    expect(BUILT_IN_VIEW_TEMPLATES.every((view) => JSON.stringify(view.fields) === JSON.stringify(VIEW_TEMPLATE_FIELDS))).toBe(true);
    expect(BUILT_IN_VIEW_TEMPLATES.every((view) => view.sortSource === STANDARD_ATTENTION_VIEW_SORT_SOURCE)).toBe(true);
    BUILT_IN_VIEW_TEMPLATES.forEach((view) => expect(() => compileQuery(view.query.source)).not.toThrow());
  });

  it('keeps Inbox limited to unorganized active items', () => {
    const inbox = BUILT_IN_VIEW_TEMPLATES[0]!;
    const matches = compileQuery(inbox.query.source);
    const item = createItem('Unsorted');
    expect(matches(item)).toBe(true);
    item.areas = ['Work'];
    expect(matches(item)).toBe(false);
  });

  it('turns a template into an ordinary view without carrying manual order', () => {
    const source = { ...BUILT_IN_VIEW_TEMPLATES[1]!, extensions: { 'utm:view-template': true, 'utm:manualOrder': ['old'], custom: true } };
    const view = viewFromTemplate(source, 'new-id');
    expect(view.id).toBe('new-id');
    expect(isViewTemplate(view)).toBe(false);
    expect(view.extensions).toEqual({ custom: true });
  });
});
