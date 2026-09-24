import { expect, it } from 'vitest';
import { NativeBackupGate } from './nativeBackupGate';

it('does not claim a debounced attempt until it starts', () => {
  const gate = new NativeBackupGate();
  expect(gate.canStart('a', 0)).toBe(true);
  expect(gate.canStart('a', 0)).toBe(true);
  expect(gate.start('a', 0)).toBe(true);
  expect(gate.start('b', 0)).toBe(false);
  gate.finish(false, 0);
  expect(gate.start('a', 1)).toBe(false);
  expect(gate.start('b', 1)).toBe(true);
});

it('failure diagnostics cannot retry the same snapshot or bypass cooldown with edits', () => {
  const gate = new NativeBackupGate();
  gate.start('a', 0);
  gate.finish(true, 0);
  for (let now = 1500; now < 300_000; now += 1500) {
    expect(gate.start('a', now)).toBe(false);
    expect(gate.start(`edited:${now}`, now)).toBe(false);
  }
  expect(gate.start('a', 300_000)).toBe(false);
  expect(gate.start('b', 300_000)).toBe(true);
});
