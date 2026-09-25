import { expect, it } from 'vitest';
import { applyQuickEntryEditorText, createQuickEntryItem, formatQuickEntryForEditor, quickEntrySource } from './quickEntry';

it('hides numeric duplicates while preserving dates after a later reopening and title edit', () => {
  const created = new Date(2026, 8, 25, 9);
  const item = createQuickEntryItem('Даша вт 29.09.2026 16:00 тт 60м тб 60м', created);
  const visible = formatQuickEntryForEditor(quickEntrySource(item)!.text);
  expect(visible).toContain('Даша вт 16:00');
  expect(visible).not.toContain('29.09.2026');
  const edited = applyQuickEntryEditorText(item, visible.replace('Даша', 'Встреча'), new Date(2026, 9, 5)).item;
  expect(edited.schedule?.startAt).toBe(item.schedule?.startAt);
  expect(edited.schedule?.travelDuration).toBe(item.schedule?.travelDuration);
  expect(edited.reminders.map(r => r.at)).toEqual(item.reminders.map(r => r.at));
});
it('freezes tomorrow and permits an explicitly changed date', () => {
  const item = createQuickEntryItem('Встреча завтра 16:00', new Date(2026, 8, 25));
  const visible = formatQuickEntryForEditor(quickEntrySource(item)!.text);
  const reopened = applyQuickEntryEditorText(item, visible, new Date(2026, 9, 5)).item;
  expect(reopened.schedule?.startAt).toBe(item.schedule?.startAt);
  const changed = applyQuickEntryEditorText(item, visible.replace('сб', 'сб 03.10.2026'), new Date(2026, 8, 25)).item;
  expect(new Date(changed.schedule!.startAt!).getDate()).toBe(3);
});
it('leaves quoted date text and standalone numeric dates untouched', () => {
  expect(formatQuickEntryForEditor('"Рассказать вт 29.09.2026"')).toBe('"Рассказать вт 29.09.2026"');
  expect(formatQuickEntryForEditor('Даша 29.09.2026 16:00')).toContain('29.09.2026');
});
