import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import { createWorkspace, googleCalendarEventToItem } from '@utm/core';
import { createAutomergeDocument } from '@utm/sdk';
import { persistenceExportSafeSnapshot } from './persistencePrivacy';

const googleItem = () => googleCalendarEventToItem({
  id: 'private-event',
  summary: 'PRIVATE GOOGLE EVENT',
  start: { dateTime: '2026-09-03T10:00:00.000Z' },
  end: { dateTime: '2026-09-03T11:00:00.000Z' },
}, 'private@example.com', 'private-connection', '2026-09-03T09:00:00.000Z')!;

describe('persistence export privacy', () => {
  it('does not create a second snapshot for an ordinary workspace', () => {
    const document = createAutomergeDocument(createWorkspace('Ordinary'));
    expect(persistenceExportSafeSnapshot(document, Automerge.getAllChanges(document))).toBeUndefined();
  });

  it('removes current Google Calendar values from the export-safe snapshot', () => {
    const workspace = createWorkspace('Private');
    const item = googleItem();
    workspace.items[item.id] = item;
    workspace.calendarPreferences.googleCalendar = { connectionId: 'private-connection', accountEmail: 'private@example.com', calendars: [], syncTokens: {} };
    const document = createAutomergeDocument(workspace);
    const snapshot = persistenceExportSafeSnapshot(document, Automerge.getAllChanges(document));
    expect(snapshot).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE GOOGLE EVENT');
    expect(JSON.stringify(snapshot)).not.toContain('private@example.com');
  });

  it('forces a fresh snapshot when Google values survive only in Automerge history', () => {
    let document = createAutomergeDocument(createWorkspace('History'));
    document = Automerge.change(document, (draft) => { const item = googleItem(); draft.items[item.id] = item; });
    document = Automerge.change(document, (draft) => { delete draft.items[googleItem().id]; });
    const snapshot = persistenceExportSafeSnapshot(document, Automerge.getAllChanges(document));
    expect(snapshot).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE GOOGLE EVENT');
  });
});
