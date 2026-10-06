import { describe, it, expect } from 'vitest';
import { withinSuggestions, extractWithinRelations, joinWithinText } from '../../../quick-entry-lab/relations';
import { createQuickEntryItem, applyQuickEntryText, syncQuickEntrySource, quickEntrySource } from './quickEntry';
const now = new Date('2026-10-06T07:00:00Z');
describe('Live Text within relations', () => {
  it.each(['rr', 'рр'])('searches %s and preserves distinct IDs with the same title', command => {
    const input = `Помыть машину ${command} wo`;
    const result = withinSuggestions(input, input.length, [{ id: 'a', title: 'Work' }, { id: 'b', title: 'Work' }])!;
    expect(result.options).toHaveLength(2);
    const text = input.slice(0, result.start) + result.options[1]!.insert + 'дл 30м';
    const item = createQuickEntryItem(text, now);
    expect(item.title).toBe('Помыть машину');
    expect(item.relations).toEqual([{ id: expect.any(String), targetId: 'b', type: 'scheduled_within' }]);
    expect(JSON.parse(JSON.stringify(item)).relations).toEqual(item.relations);
  });
  it('edits selected relations without duplicating them and clears stale source on removal', () => {
    const text = 'Wash rr [Work](item:a) rr [Cleaning](item:b) дл 30м';
    const item = createQuickEntryItem(text, now);
    expect(item.relations.map(r => r.targetId)).toEqual(['a', 'b']);
    const again = applyQuickEntryText(item, text, now).item;
    expect(again.relations).toHaveLength(2);
    expect(quickEntrySource(syncQuickEntrySource(again, { ...again, relations: [] }))).toBeNull();
  });
  it('does not intercept the numeric alarm shorthand', () => {
    expect(withinSuggestions('Call rr 15', 10, [])).toBeNull();
  });
  it('leaves quoted prose intact', () => {
    expect(extractWithinRelations('"rr [Work](item:a)"').ids).toEqual([]);
  });
  it('hides long IDs while retaining selected identities and editable whitespace', () => {
    const token = 'rr [Work](item:google%3Along-calendar-id%40group.calendar.google.com)';
    const source = joinWithinText('Wash  дл 30м ', [token]);
    expect(extractWithinRelations(source).displayText).toBe('Wash  дл 30м ');
    const edited = joinWithinText('Wash car дл 1ч', extractWithinRelations(source).tokens);
    expect(createQuickEntryItem(edited, now).relations[0]?.targetId).toBe('google:long-calendar-id@group.calendar.google.com');
    expect(createQuickEntryItem(edited, now).title).toBe('Wash car');
  });
});
