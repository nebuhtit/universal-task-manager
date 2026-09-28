import { beforeEach, expect, it, vi } from 'vitest';
import { hasFaceIdConfiguredHint, setFaceIdConfiguredHint } from './faceIdHint';

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

it('stores only a non-secret configured marker', () => {
  expect(hasFaceIdConfiguredHint()).toBe(false);
  setFaceIdConfiguredHint(true);
  expect(hasFaceIdConfiguredHint()).toBe(true);
  expect(values.size).toBe(1);
  setFaceIdConfiguredHint(false);
  expect(hasFaceIdConfiguredHint()).toBe(false);
});
