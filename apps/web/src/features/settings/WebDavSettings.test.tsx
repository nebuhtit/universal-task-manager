import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebDavSettings } from './WebDavSettings';
import type { WebDavController } from '../../hooks/useWebDavSync';

const controller: WebDavController = { settings: null, save: vi.fn(), check: vi.fn(), workspaceId: undefined, synchronize: vi.fn(), stop: vi.fn(), resume: vi.fn(), paused: false, stopping: false, running: false, status: 'webdav-not-configured', failureStage: null, connectionSteps: [], connectionComplete: false, transportStep: null, lastSuccess: '', conflict: null, logError: false };
it('distinguishes passed, failed and unstarted checks without claiming relay receipt', () => {
  const html = renderToStaticMarkup(<WebDavSettings controller={{ ...controller, status: 'webdav-relay-response-timeout', connectionSteps: ['webdav-test-folder', 'webdav-test-create'], failureStage: 'webdav-test-create', transportStep: 'relay-request' }} language="en" />);
  expect(html).toContain('Passed'); expect(html).toContain('Failed'); expect(html).toContain('Not started');
  expect(html).toContain('Receipt by the relay is unconfirmed');
  expect(html).not.toContain('relay access confirmed');
});
it('does not hide connection failure and its stage while synchronization is paused', () => {
  const html = renderToStaticMarkup(<WebDavSettings controller={{ ...controller, paused: true, status: 'webdav-proxy-upstream-timeout', failureStage: 'webdav-test-create' }} language="en" />);
  expect(html).toContain('The relay is reachable');
  expect(html).toContain('Safely creating a test file (PUT / MOVE)');
  expect(html).toContain('Synchronization stopped');
});
it.each(['ru', 'en'])('starts with empty private connection fields and auto sync off (%s)', language => {
  const html = renderToStaticMarkup(<WebDavSettings controller={controller} language={language} />);
  expect(html).toContain('https://example.com/webdav/');
  expect(html).toContain('value="UniversalSync"');
  expect(html).not.toContain('keenetic');
  expect((html.match(/type="password"/g) ?? []).length).toBe(2);
  expect((html.match(/checked=""/g) ?? []).length).toBe(1); // safe logs on, automatic sync off
  expect(html).toContain('OPTIONS'); expect(html).toContain('ETag');
  if (language === 'en') expect(html).not.toMatch(/[А-Яа-яЁё]/);
});
