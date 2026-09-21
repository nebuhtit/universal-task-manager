import { describe, expect, it } from 'vitest';
import { formatProgramText, parseProgramText } from './programText';

const origin = Date.parse('2030-09-21T14:00:00Z');
const zone = 'Europe/Moscow';
describe('program text', () => {
  it('round trips parallel blocks, gaps, days, seconds and IDs', () => {
    const source = '17:00–17:45 Урок\n17:00:30-17:15:40 Параллельно\n18:15—21:00 Чай\n23:30–+1 00:15 Ночь\n+1 09:00–10:00 Завтрак';
    const blocks = parseProgramText(source, origin, zone);
    expect(blocks).toHaveLength(5);
    expect(blocks[0]?.startOffsetSeconds).toBe(0);
    expect(blocks[4]?.endOffsetSeconds).toBe(17 * 3600);
    expect(parseProgramText(formatProgramText(blocks, origin, zone), origin, zone, blocks)).toEqual(blocks);
    const moved = parseProgramText(source.split('\n').reverse().join('\n'), origin, zone, blocks);
    expect(moved.map((entry) => entry.id)).toEqual(blocks.map((entry) => entry.id).reverse());
  });
  it('preserves edited IDs and rejects invalid lines without changing previous blocks', () => {
    const blocks = parseProgramText('17:00–18:00 First', origin, zone);
    expect(parseProgramText('17:15–18:30 Changed', origin, zone, blocks)[0]?.id).toBe(blocks[0]?.id);
    expect(() => parseProgramText('17:00–18:00 First\n23:30–00:15 Wrong', origin, zone, blocks)).toThrow('Line 2');
    expect(blocks[0]?.title).toBe('First');
    expect(() => parseProgramText('25:00–26:00 Wrong', origin, zone)).toThrow();
  });
  it('rejects nonexistent DST times', () => {
    expect(() => parseProgramText('02:30–03:30 Missing', Date.parse('2026-03-29T00:00:00Z'), 'Europe/Berlin')).toThrow();
  });
});
