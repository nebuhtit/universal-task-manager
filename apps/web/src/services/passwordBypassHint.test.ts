import { beforeEach, expect, it, vi } from 'vitest';
import { hasPasswordBypassHint, setPasswordBypassHint } from './passwordBypassHint';

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

it('retains and clears the explicit password-bypass preference', () => {
  expect(hasPasswordBypassHint()).toBe(false);
  setPasswordBypassHint(true);
  expect(hasPasswordBypassHint()).toBe(true);
  setPasswordBypassHint(false);
  expect(hasPasswordBypassHint()).toBe(false);
});
