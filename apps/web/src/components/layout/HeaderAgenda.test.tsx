import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWorkspace } from '@utm/core';
import { HeaderAgenda } from './HeaderAgenda';

const clock = vi.hoisted(() => ({ now: Date.parse('2026-10-09T18:00:00Z') }));
vi.mock('../../hooks/useClock', () => ({ useWorkspaceNow: () => new Date(clock.now) }));
vi.mock('../../hooks/useHeaderAgenda', () => ({ useHeaderAgenda: () => ({
  concurrent: [], additional: 0,
  next: { id: 'meeting', title: '[[travel-to]] Meeting', kind: 'event', at: clock.now + 20 * 60000, eventAt: clock.now + 40 * 60000 },
}) }));

it('keeps departure countdown, both clocks and travel symbols in the inline status, with event time bold', () => {
  const workspace = createWorkspace('Status');
  workspace.calendarPreferences.timezone = 'Europe/Moscow';
  workspace.calendarPreferences.language = 'en';
  const html = renderToStaticMarkup(<HeaderAgenda workspace={workspace} />);
  expect(html).toContain('in');
  expect(html).toContain('20');
  expect(html).toContain('21:20');
  expect(html).toContain('<strong>21:40</strong>');
  expect(html).toContain('M17 12H3');
  expect(html).toContain('M12 17v4');
  expect(html).not.toContain('<br');
});
