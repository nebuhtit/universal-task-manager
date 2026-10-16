import { expect, it } from 'vitest';
import { createItem } from '@utm/core';
import { withinOrganizationOffer } from './withinOrganization';
import { applyEditorTitleDraft } from './editor/itemEditorTitle';
import { quickEntryEditorText } from './quickEntry';

it('copies missing memberships only after accepting the offer and retains them on reopening', () => {
  const now = new Date('2026-10-16T10:00:00Z');
  const target = createItem('Work block'); target.id = 'work';
  target.areas = ['Work', 'Work']; target.projects = ['Next week']; target.tags = ['urgent', 'review'];
  const current = createItem('Task'); current.tags = ['urgent'];
  current.schedule = { timezone: 'UTC', estimatedDuration: 'PT10M' };
  const source = 'Task rr [Work block](item:work)';
  const unaccepted = applyEditorTitleDraft(current, current, source, current.tags.join(', '), now);
  expect(unaccepted.areas).toEqual([]); expect(unaccepted.projects).toEqual([]); expect(unaccepted.tags).toEqual(['urgent']);
  const offer = withinOrganizationOffer(target, source, current)!;
  expect(offer.areas).toEqual(['Work']); expect(offer.tags).toEqual(['review']);
  const copied = applyEditorTitleDraft(current, current, `${source} ${offer.insert}`, current.tags.join(', '), now);
  const reopened = JSON.parse(JSON.stringify(copied));
  const savedAgain = applyEditorTitleDraft(reopened, reopened, quickEntryEditorText(reopened), reopened.tags.join(', '), now);
  expect(savedAgain.areas).toEqual(['Work']); expect(savedAgain.projects).toEqual(['Next week']); expect(savedAgain.tags).toEqual(['urgent', 'review']);
  expect(savedAgain.relations).toContainEqual(expect.objectContaining({ targetId: 'work', type: 'scheduled_within' }));
  expect(withinOrganizationOffer(target, quickEntryEditorText(savedAgain), savedAgain)).toBeNull();
});

it('supports legacy organization fields and ignores literal text, empty or already assigned metadata', () => {
  const target = createItem('Legacy'); target.area = 'Work'; target.project = 'Launch'; target.tags = ['important'];
  expect(withinOrganizationOffer(target, 'Task area:Work project:Launch #important')).toBeNull();
  expect(withinOrganizationOffer(target, '. Task rr [Legacy](item:legacy)')).toBeNull();
  expect(withinOrganizationOffer(createItem('Empty'), 'Task')).toBeNull();
  expect(withinOrganizationOffer(target, 'Task')).toMatchObject({ areas: ['Work'], projects: ['Launch'], tags: ['important'] });
});
