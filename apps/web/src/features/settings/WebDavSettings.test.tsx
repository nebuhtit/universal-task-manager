import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebDavSettings } from './WebDavSettings';
import type { WebDavController } from '../../hooks/useWebDavSync';

const controller: WebDavController = { settings: null, save: vi.fn(), check: vi.fn(), workspaceId: undefined, synchronize: vi.fn(), stop: vi.fn(), resume: vi.fn(), paused: false, stopping: false, running: false, status: 'webdav-not-configured', lastSuccess: '', conflict: null, logError: false };
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
