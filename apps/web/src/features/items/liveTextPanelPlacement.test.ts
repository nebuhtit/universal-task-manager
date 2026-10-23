import { describe, expect, it } from 'vitest';
import { liveTextPanelPlacement } from './liveTextPanelPlacement';

const input = { top: 400, bottom: 448, viewportTop: 0, viewportBottom: 500, gap: 8, accessory: 32, minimum: 60, preferBelow: false };
describe('Live Text panel keyboard placement', () => {
  it('keeps an upper-anchored panel above the input when space is available', () => {
    expect(liveTextPanelPlacement(input)).toEqual({ side: 'above', height: 392 });
  });
  it('flips a non-dock panel instead of shrinking to a sliver after Safari pans', () => {
    expect(liveTextPanelPlacement({ ...input, top: 120, bottom: 168, viewportTop: 110 })).toEqual({ side: 'below', height: 292 });
  });
  it('flips an editor panel above the input when the keyboard covers its lower side', () => {
    expect(liveTextPanelPlacement({ ...input, preferBelow: true })).toEqual({ side: 'above', height: 392 });
  });
  it('retains the preferred side when it fits and never returns a negative height', () => {
    expect(liveTextPanelPlacement({ ...input, top: 50, bottom: 98, preferBelow: true }).side).toBe('below');
    expect(liveTextPanelPlacement({ ...input, viewportTop: 450, viewportBottom: 460 }).height).toBe(0);
  });
});
