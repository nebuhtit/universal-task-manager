import { expect, it } from 'vitest';
import { safeItemTitleFailureDetails } from './itemEditorDiagnostics';

it('exports only structural title failure metadata', () => {
  const details = safeItemTitleFailureDetails(JSON.stringify({ stage: 'commit', draftLength: 12, hasStart: true, missingTitle: false, commit: '2f7b44d', title: 'private', error: 'private', itemId: 'secret', sourceLength: 'private' }));
  expect(JSON.parse(details!)).toEqual({ stage: 'commit', draftLength: 12, hasStart: true, missingTitle: false, commit: '2f7b44d' });
  expect(safeItemTitleFailureDetails('invalid')).toBeUndefined();
  expect(safeItemTitleFailureDetails(JSON.stringify({ stage: 'private' }))).toBeUndefined();
});
