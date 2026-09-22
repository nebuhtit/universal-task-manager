import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PersistedDetails, persistUiBoolean } from './PersistedDetails';

afterEach(() => vi.unstubAllGlobals());
describe('persisted calendar disclosure', () => {
  it('restores collapsed and expanded state for either calendar display', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } });
    const render = () => renderToStaticMarkup(<PersistedDetails uiKey="calendar:all-day" defaultOpen><summary>All day</summary></PersistedDetails>);
    expect(render()).toContain('open=""');
    persistUiBoolean('calendar:all-day', false);
    expect(render()).not.toContain('open=');
    persistUiBoolean('calendar:all-day', true);
    expect(render()).toContain('open=""');
  });
});
