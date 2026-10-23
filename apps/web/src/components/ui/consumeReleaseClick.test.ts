import { afterEach, expect, it, vi } from 'vitest';
import { consumeReleaseClick } from './consumeReleaseClick';

afterEach(() => vi.useRealTimers());
const fixture = () => new EventTarget() as unknown as Document;
const release = (document: Document, type = 'click') => {
  const event = new Event(type, { cancelable: true });
  document.dispatchEvent(event); return event;
};
it('consumes a release click regardless of which item became its target', () => {
  vi.useFakeTimers(); const document = fixture();
  consumeReleaseClick(document);
  expect(release(document).defaultPrevented).toBe(true);
  document.dispatchEvent(new Event('pointerdown'));
  expect(release(document).defaultPrevented).toBe(false);
});
it('consumes both compatibility touchend and click, without eating the next real tap', () => {
  vi.useFakeTimers(); const document = fixture();
  consumeReleaseClick(document);
  expect(release(document, 'touchend').defaultPrevented).toBe(true);
  expect(release(document).defaultPrevented).toBe(true);
  document.dispatchEvent(new Event('pointerdown'));
  expect(release(document).defaultPrevented).toBe(false);
});
it('does not block keyboard activation or leave a permanent guard behind', () => {
  vi.useFakeTimers(); const document = fixture();
  consumeReleaseClick(document);
  document.dispatchEvent(new Event('keydown'));
  expect(release(document).defaultPrevented).toBe(false);
  consumeReleaseClick(document);
  vi.advanceTimersByTime(801);
  expect(release(document).defaultPrevented).toBe(false);
});
