import { test, expect } from '@playwright/test';
test('real agenda worker matches the synchronous model while UI timers run', async ({ page }) => {
  test.setTimeout(120_000);
  // Isolate the worker from unrelated app startup/WASM work.
  await page.route('**/__agenda_probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Agenda worker probe</title>' }));
  await page.goto('/__agenda_probe');
  const result = await page.evaluate(async () => {
    const path = '/src/services/agendaWorker.ts', modelPath = '/src/services/nativeAgendaWidget.ts';
    const { agendaInput, calculateAgendaInWorker } = await import(path);
    const { agendaWidgetSnapshot } = await import(modelPath);
    const now = Date.parse('2026-09-28T08:00:00Z');
    const items: Record<string, unknown> = {};
    for (let n = 0; n < 4; n++) items[`s${n}`] = {
      id: `s${n}`, title: 'Synthetic', role: 'series_template', state: 'open', reminders: [],
      schedule: { startAt: '2020-01-01T12:00:00Z', endAt: '2020-01-01T13:00:00Z', timezone: 'UTC' },
      recurrence: { rrule: 'FREQ=DAILY', timezone: 'UTC', activationOffset: 'PT0M', rdates: [], exdates: [] },
    };
    const workspace = { workspaceId: 'test', items, tombstones: {}, calendarPreferences: { timezone: 'UTC', language: 'en', appearance: {} } };
    const input = agendaInput(workspace);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const snapshot = await calculateAgendaInWorker(input.workspace, now, new AbortController().signal);
    clearInterval(timer);
    return { ticks, equal: JSON.stringify(snapshot) === JSON.stringify(agendaWidgetSnapshot(workspace, now)) };
  });
  expect(result.equal).toBe(true);
  expect(result.ticks).toBeGreaterThan(0);
});
