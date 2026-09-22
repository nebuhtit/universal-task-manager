import { describe, expect, it } from 'vitest';
import { applyQuickEntryText, createQuickEntryItem, quickEntrySource, syncQuickEntrySource } from './quickEntry';
import { parseEntry } from '../../../quick-entry-lab/parser';
import { createPortablePackage, createWorkspace, parsePortablePackage, serializePortablePackage } from '@utm/core';

const now = new Date(2026, 8, 21, 16);
describe('quick entry item integration', () => {
  it('freezes English dates in a dashed range and updates its end in place', () => {
    const item = createQuickEntryItem('Meeting tomorrow 10:00 - tomorrow 11:00 travel 30m remind 15m', now);
    expect(item.title).toBe('Meeting');
    expect(item.schedule).toMatchObject({ startAt: new Date(2026, 8, 22, 10).toISOString(), endAt: new Date(2026, 8, 22, 11).toISOString(), travelDuration: 'PT30M' });
    expect(quickEntrySource(item)?.text).toContain('вт 22.09.2026 10:00 - вт 22.09.2026 11:00');
    const changed = syncQuickEntrySource(item, { ...item, schedule: { ...item.schedule!, endAt: new Date(2026, 8, 22, 12).toISOString(), travelDuration: 'PT45M' } });
    expect(quickEntrySource(changed)?.text).toContain('вт 22.09.2026 10:00 - вт 22.09.2026 12:00 travel 45м remind 15m');
    expect(parseEntry(quickEntrySource(changed)!.text, new Date(2026, 8, 29))).toMatchObject({ title: 'Meeting', end: new Date(2026, 8, 22, 12).toISOString(), travelMinutes: 45, errors: [] });
  });
  it('stores only the short title for Views and freezes relative dates in the source', () => {
    const item = createQuickEntryItem('Встреча с завтра 10:00 по завтра 11:00 срок след пт вечером', now);
    expect(item.title).toBe('Встреча');
    expect(item.bodyMarkdown).toBe('');
    expect(item.schedule).toMatchObject({
      startAt: new Date(2026, 8, 22, 10).toISOString(),
      endAt: new Date(2026, 8, 22, 11).toISOString(),
      dueAt: new Date(2026, 9, 2, 18).toISOString(),
    });
    const source = quickEntrySource(item)!;
    expect(source.text).toContain('вт 22.09.2026');
    expect(source.text).toContain('пт 02.10.2026');
    expect(parseEntry(source.text, new Date(2026, 8, 29, 12))).toMatchObject({ title: item.title, start: item.schedule?.startAt, end: item.schedule?.endAt, due: item.schedule?.dueAt, errors: [] });
    expect(quickEntrySource(JSON.parse(JSON.stringify(item)))).toEqual(source);
  });
  it('updates one range segment after a manual field edit', () => {
    const item = createQuickEntryItem('Встреча с завтра 10:00 по завтра 11:00 срок след пт вечером', now);
    const changed = syncQuickEntrySource(item, { ...item, schedule: { ...item.schedule!, startAt: new Date(2026, 8, 22, 9).toISOString() } });
    expect(quickEntrySource(changed)?.text).toContain('с вт 22.09.2026 09:00 по вт 22.09.2026 11:00');
    expect(quickEntrySource(changed)?.text).toContain('срок пт 02.10.2026 вечером');
  });
  it('renames a title between commands in place', () => {
    const item = createQuickEntryItem('начало завтра 15:00 стрижка у Маши дорога 45м', now);
    const changed = syncQuickEntrySource(item, { ...item, title: 'укладка у Маши' });
    expect(quickEntrySource(changed)?.text).toBe('начало вт 22.09.2026 15:00 укладка у Маши дорога 45м');
    expect(parseEntry(quickEntrySource(changed)!.text, now)).toMatchObject({ title: changed.title, errors: [] });
  });
  it('reparses edited source without changing unrelated item data', () => {
    const item = createQuickEntryItem('Встреча с завтра 10:00 по завтра 11:00', now);
    const updated = applyQuickEntryText({ ...item, tags: ['work'] }, 'Встреча с вт 22.09.2026 10:00 по вт 22.09.2026 12:00', new Date(2026, 8, 29, 12)).item;
    expect(updated.tags).toEqual(['work']);
    expect(updated.schedule?.endAt).toBe(new Date(2026, 8, 22, 12).toISOString());
    expect(quickEntrySource(updated)?.text).toContain('вт 22.09.2026');
  });
  it('freezes a relative-to-now reminder and mirrors manual reminder edits', () => {
    const item = createQuickEntryItem('Позвонить напомнить через45м', now);
    expect(quickEntrySource(item)?.text).toContain('напомнить в пн 21.09.2026 16:45');
    expect(parseEntry(quickEntrySource(item)!.text, new Date(2026, 8, 29)).reminders[0]?.at).toBe(new Date(2026, 8, 21, 16, 45).toISOString());
    const changed = syncQuickEntrySource(item, { ...item, reminders: [{ ...item.reminders[0]!, at: new Date(2026, 8, 21, 17).toISOString() }] });
    expect(quickEntrySource(changed)?.text).toContain('напомнить в пн 21.09.2026 17:00');
  });
  it('recomputes a departure reminder when travel changes', () => {
    const item = createQuickEntryItem('Стрижка начало завтра 15:00 дорога 45м напомнить выезд-2ч', now);
    const changed = syncQuickEntrySource(item, { ...item, schedule: { ...item.schedule!, travelDuration: 'PT60M' } });
    expect(quickEntrySource(changed)?.text).toContain('дорога 60м');
    expect(changed.reminders[0]?.at).toBe(new Date(2026, 8, 22, 12).toISOString());
  });
  it('moves an automatic reminder from due to event opens when a start is added', () => {
    const item = createQuickEntryItem('Позвонить срок завтра 15:00 напомнить 30м', now);
    expect(item.reminders[0]?.relativeTo).toBe('due');
    const changed = syncQuickEntrySource(item, { ...item, schedule: { ...item.schedule!, startAt: new Date(2026, 8, 22, 14).toISOString() } });
    expect(changed.reminders[0]?.relativeTo).toBe('start');
    expect(quickEntrySource(changed)?.text).toContain('напомнить 30м');
  });
  it('updates a bare due phrase instead of appending a conflicting command', () => {
    const item = createQuickEntryItem('Отчёт до завтра 15:00', now);
    const changed = syncQuickEntrySource(item, { ...item, schedule: { ...item.schedule!, dueAt: new Date(2026, 8, 23, 16).toISOString() } });
    expect(quickEntrySource(changed)?.text).toBe('Отчёт до ср 23.09.2026 16:00');
    expect(parseEntry(quickEntrySource(changed)!.text, now).errors).toEqual([]);
  });
  it('stores a plain date as a one-hour event and updates its bare start', () => {
    const item = createQuickEntryItem('Даша вс 15 00', now);
    expect(item.schedule).toMatchObject({ startAt: new Date(2026, 8, 27, 15).toISOString(), endAt: new Date(2026, 8, 27, 16).toISOString(), estimatedDuration: 'PT60M' });
    expect(item.schedule?.dueAt).toBeUndefined();
    const changed = syncQuickEntrySource(item, { ...item, schedule: { ...item.schedule!, startAt: new Date(2026, 8, 27, 14).toISOString() } });
    expect(quickEntrySource(changed)?.text).toContain('вс 27.09.2026 14:00');
  });
  it('stores до as a due-only ten-minute item', () => {
    const item = createQuickEntryItem('Домашнее задание до вс 15 00', now);
    expect(item.schedule).toMatchObject({ dueAt: new Date(2026, 8, 27, 15).toISOString(), estimatedDuration: 'PT10M' });
    expect(item.schedule?.startAt).toBeUndefined();
    expect(item.schedule?.endAt).toBeUndefined();
    expect(parseEntry(quickEntrySource(item)!.text, new Date(2026, 9, 10))).toMatchObject({ due: item.schedule!.dueAt, start: null, end: null, durationMinutes: 10, errors: [] });
  });
  it('stores a clock-only due at the next occurrence and freezes it', () => {
    const afternoon = new Date(2026, 8, 22, 14, 40);
    const item = createQuickEntryItem('Пук до 9 00', afternoon);
    expect(item.schedule).toMatchObject({ dueAt: new Date(2026, 8, 23, 9).toISOString(), estimatedDuration: 'PT10M' });
    expect(item.schedule?.startAt).toBeUndefined();
    expect(quickEntrySource(item)?.text).toContain('до ср 23.09.2026 09:00');
  });
  it('stores a same-day clock-only срок alongside the event start', () => {
    const afternoon = new Date(2026, 8, 22, 14, 55);
    const item = createQuickEntryItem('На залив сегодня 09:00 срок 18:00', afternoon);
    expect(item.schedule).toMatchObject({ startAt: new Date(2026, 8, 22, 9).toISOString(), dueAt: new Date(2026, 8, 22, 18).toISOString() });
    expect(quickEntrySource(item)?.text).toContain('срок:вт 22.09.2026 18:00');
  });
  it('labels an older bare due source before opening it under the new grammar', () => {
    const item = createQuickEntryItem('Отчёт завтра 15:00', now);
    const dueAt = new Date(2026, 8, 22, 15).toISOString();
    const legacy = { ...item, schedule: { timezone: item.schedule!.timezone, dueAt }, extensions: { ...item.extensions, 'utm:quickEntrySource': { text: 'Отчёт вт 22.09.2026 15:00', timezone: item.schedule!.timezone } } };
    const source = quickEntrySource(legacy)!;
    expect(source.text).toBe('Отчёт до вт 22.09.2026 15:00');
    expect(parseEntry(source.text, new Date(2026, 9, 1))).toMatchObject({ due: dueAt, start: null, errors: [] });
  });
  it('preserves the source through portable export and restore', () => {
    const workspace = createWorkspace('Quick entry');
    const item = createQuickEntryItem('Встреча с завтра 10:00 по завтра 11:00 срок пятница', now);
    workspace.items[item.id] = item;
    const restored = parsePortablePackage(serializePortablePackage(createPortablePackage(workspace, { kind: 'items', items: [item] }))).package.items[0]!;
    expect(restored.title).toBe('Встреча');
    expect(restored.bodyMarkdown).toBe('');
    expect(quickEntrySource(restored)).toEqual(quickEntrySource(item));
  });
});
