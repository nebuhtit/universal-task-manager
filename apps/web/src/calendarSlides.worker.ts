/// <reference lib="webworker" />
import type { UniversalItem, WorkspaceDocument } from '@utm/core';
import { createCalendarPageCache, prepareCalendarSlides, type CalendarSlideRequest } from './features/calendar/calendarPageCache';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let workspace: WorkspaceDocument, snapshot = 0;
let cache: ReturnType<typeof createCalendarPageCache>;
type Message = { kind: 'snapshot'; snapshot: number; json: string }
  | { kind: 'items'; snapshot: number; items: Array<[string, string]> }
  | { kind: 'prepare'; snapshot: number; id: number; request: CalendarSlideRequest };
scope.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  try {
    if (message.kind === 'snapshot') {
      snapshot = message.snapshot; workspace = JSON.parse(message.json) as WorkspaceDocument;
      workspace.items = {}; cache = createCalendarPageCache(workspace.workspaceId);
    } else if (message.snapshot === snapshot && message.kind === 'items') {
      for (const [id, json] of message.items) workspace.items[id] = JSON.parse(json) as UniversalItem;
    } else if (message.snapshot === snapshot && message.kind === 'prepare') {
      const started = performance.now();
      const result = prepareCalendarSlides(cache, workspace, message.request);
      scope.postMessage({ id: message.id, ok: true, result, durationMs: performance.now() - started });
    }
  } catch { if (message.kind === 'prepare') scope.postMessage({ id: message.id, ok: false }); }
};
