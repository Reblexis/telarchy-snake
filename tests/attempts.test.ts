import { describe, it, expect } from 'vitest';
import { attempts, fxOf } from '../src/attempts.js';
import type { LogStep } from '../src/gamelog.js';

// docs/level-video.md, "Moments": attempts and what happens on a move.

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (min: number, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000).toISOString();

/** A level from a move string: m moves, e eats, d dies. */
function level(moves: string): LogStep[] {
  const out: LogStep[] = [];
  let length = 2, deaths = 0;
  const push = (i: number, action: LogStep['action']) => out.push({
    step: i, at: at(i), snake: [{ x: 1, y: 0 }, { x: 0, y: 0 }], food: { x: 1, y: 1 }, heading: 'right',
    action, direction: 'right', undecided: false, prices: { forward: 2, left: 3, right: 4 }, length, deaths,
  });
  push(0, null);
  [...moves].forEach((c, k) => {
    if (c === 'e') length++;
    if (c === 'd') { deaths++; length = 2; }
    push(k + 1, 'forward');
  });
  return out;
}

// Size 2, so length 4 fills. a0 dies at 2 (record), a1 eats to 3 and dies (record),
// a2 dies at 2 (not a record, sped up), a3 fills.
const L = level('md' + 'emd' + 'md' + 'mee');
const SIZE = 2;
describe('attempts', () => {
  it('splits the level at every death, with the length each attempt reached', () => {
    expect(attempts(L, SIZE).map(x => [x.start, x.end, x.reached])).toEqual([[0, 2, 2], [2, 5, 3], [5, 7, 2], [7, 10, 4]]);
  });
  it('an attempt is a record when it reaches above every earlier attempt; the last one fills', () => {
    const a = attempts(L, SIZE);
    expect(a.map(x => x.record)).toEqual([true, true, false, true]);
    expect(a.map(x => x.fills)).toEqual([false, false, false, true]);
  });
});

describe('a record is strictly above every earlier attempt', () => {
  it('an attempt that only ties the best so far is not a record', () => {
    expect(attempts(level('md' + 'md' + 'm'), SIZE).map(x => x.record)).toEqual([true, false, false]);
  });
});

describe('what happens on a move', () => {
  it('a death, an eat, the fill, or nothing', () => {
    expect(fxOf(L, 0, SIZE)).toBeNull();
    expect(fxOf(L, 1, SIZE)).toBeNull();
    expect(fxOf(L, 2, SIZE)).toBe('death');
    expect(fxOf(L, 3, SIZE)).toBe('eat');
    expect(fxOf(L, 9, SIZE)).toBe('eat');
    expect(fxOf(L, 10, SIZE)).toBe('fill');
  });
});
