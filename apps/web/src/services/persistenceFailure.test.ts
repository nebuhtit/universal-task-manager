import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '@utm/core';
import { createAutomergeDocument } from '@utm/sdk';
import { persistWorkspace } from './workspacePersistence';
const fallback = vi.hoisted(() => vi.fn());
vi.mock('@utm/sdk', async original => ({ ...await original<typeof import('@utm/sdk')>(), prepareLocalWorkspaceSave: fallback }));
afterEach(() => vi.unstubAllGlobals());
it('does not repeat failed worker processing on the UI thread', async () => {
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class {
    onerror?: () => void;
    terminate = terminate;
    postMessage() { queueMicrotask(() => this.onerror?.()); }
  });
  await expect(persistWorkspace({ document: createAutomergeDocument(createWorkspace('test')), dataKey: new Uint8Array(32) })).rejects.toThrow('Existing saved data is retained');
  expect(fallback).not.toHaveBeenCalled();
  expect(terminate).toHaveBeenCalled();
});
