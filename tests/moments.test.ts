import { describe, it, expect } from 'vitest';
import { momentsOf, scriptOf } from '../src/moments.js';
import type { LogStep } from '../src/gamelog.js';
import type { TradeRow } from '../src/level.js';

// docs/level-video.md, "Moments" and "The script".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();
type Cell = { x: number; y: number };
const c = (x: number, y: number): Cell => ({ x, y });
const LEVEL = { forward: 10, left: 4, right: 3 };

function step(i: number, snake: Cell[], over: Partial<LogStep> = {}): LogStep {
  return { step: i, at: at(i), snake, food: c(3, 0), heading: 'up', action: i ? 'forward' : null, direction: 'up', undecided: false, prices: LEVEL, length: snake.length, deaths: 0, ...over };
}
function trade(i: number, credits: number, handle = 'ann'): TradeRow {
  return { id: `t${i}${handle}${credits}`, at: new Date(T0 + (i - 1) * 60_000 + 30_000).toISOString(), kind: 'trade', actor: { id: handle, handle }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: credits, callBefore: 1, callAfter: 2, marketId: `m${handle}` } };
}

// A 4x4 board. Before move 1 the snake's head is at (0,1) heading up, 9 long: west is the wall,
// east (1,1) is its own body, so only continuing up to (0,0) lives.
const coiled = [c(0, 1), c(0, 2), c(0, 3), c(1, 3), c(2, 3), c(2, 2), c(2, 1), c(1, 1), c(1, 0)];
const after = [c(0, 0), ...coiled.slice(0, -1)];

describe('a near miss', () => {
  it('is the only move that would not kill the snake, taken and survived, at length 6 or more', () => {
    const entries = [step(0, coiled), step(1, after)];
    const m = momentsOf(entries, 4, [[]]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ move: 1, kinds: ['near miss'], weight: 5 });
  });
  it('is not a near miss when the snake was shorter than 6', () => {
    const short = [c(0, 1), c(0, 2), c(1, 2), c(1, 1)]; // east (1,1) is body, west the wall: one way out, but only 4 long
    const entries = [step(0, short), step(1, [c(0, 0), c(0, 1), c(0, 2), c(1, 2)])];
    expect(momentsOf(entries, 4, [[]])).toEqual([]);
  });
  it('the tail cell counts as free, because the tail moves away', () => {
    // east of the head is the tail: two ways out, so no near miss
    const snake = [c(0, 1), c(0, 2), c(0, 3), c(1, 3), c(2, 3), c(2, 2), c(1, 2), c(1, 1)];
    const entries = [step(0, snake), step(1, [c(0, 0), ...snake.slice(0, -1)])];
    expect(momentsOf(entries, 4, [[]]).filter(x => x.kinds.includes('near miss'))).toEqual([]);
  });
  it('is not a near miss when the snake died', () => {
    const entries = [step(0, coiled), step(1, [c(1, 1), c(1, 2)], { deaths: 1, length: 2 })];
    expect(momentsOf(entries, 4, [[]]).filter(x => x.kinds.includes('near miss'))).toEqual([]);
  });
});

describe('the market kinds', () => {
  const open = [c(1, 1), c(1, 2)];
  const moved = [c(1, 0), c(1, 1)];
  it('a whale is 300 credits or more on the move, weighing log2(credits) minus 5', () => {
    const entries = [step(0, open), step(1, moved)];
    const m = momentsOf(entries, 4, [[trade(1, 200), trade(1, 150, 'bob')]]);
    expect(m[0].kinds).toEqual(['whale']);
    expect(m[0].weight).toBeCloseTo(Math.log2(350) - 5, 6);
    expect(momentsOf(entries, 4, [[trade(1, 299)]])).toEqual([]);
  });
  it('a crowd is 3 different traders', () => {
    const entries = [step(0, open), step(1, moved)];
    const m = momentsOf(entries, 4, [[trade(1, 1, 'a'), trade(1, 1, 'b'), trade(1, 1, 'c'), trade(1, 1, 'a')]]);
    expect(m[0]).toMatchObject({ kinds: ['crowd'], weight: 2 });
    expect(momentsOf(entries, 4, [[trade(1, 1, 'a'), trade(1, 1, 'b'), trade(1, 1, 'a')]])).toEqual([]);
  });
  it('a tie is the top two prices within 0.5 and the third at least 5 below', () => {
    const tie = [step(0, open), step(1, moved, { prices: { forward: 12, left: 11.6, right: 6 } })];
    expect(momentsOf(tie, 4, [[]])[0]).toMatchObject({ kinds: ['tie'], weight: 2 });
    const close = [step(0, open), step(1, moved, { prices: { forward: 12, left: 11.6, right: 8 } })];
    expect(momentsOf(close, 4, [[]])).toEqual([]);
  });
});

describe('the story kinds', () => {
  it('a new best is an eat reaching a length no earlier move reached; a milestone a multiple of 10', () => {
    const s = (n: number) => Array.from({ length: n }, (_, k) => c(k % 4, Math.floor(k / 4)));
    const entries = [step(0, s(9)), step(1, s(10), { length: 10 }), step(2, s(2), { deaths: 1, length: 2 }), step(3, s(3), { length: 3 })];
    const m = momentsOf(entries, 8, [[], [], []]);
    const one = m.find(x => x.move === 1)!;
    expect(one.kinds).toEqual(expect.arrayContaining(['new best', 'milestone']));
    expect(m.find(x => x.move === 3)?.kinds ?? []).not.toContain('new best');
  });
  it('the crash that ends a record attempt, and the fill', () => {
    const s = (n: number) => Array.from({ length: n }, (_, k) => c(k % 2, Math.floor(k / 2)));
    const entries = [step(0, s(2)), step(1, s(3), { length: 3 }), step(2, s(2), { deaths: 1, length: 2 }), step(3, s(3), { length: 3, deaths: 1 }), step(4, s(4), { length: 4, deaths: 1 })];
    const m = momentsOf(entries, 2, [[], [], [], []]);
    expect(m.find(x => x.move === 2)?.kinds).toContain('record crash');
    expect(m.find(x => x.move === 4)?.kinds).toContain('fill');
  });
});

describe('the script', () => {
  it('names the level, then every moment in order with its move, time, kinds and weight, the strongest ten marked', () => {
    const entries = [step(0, coiled), step(1, after)];
    const text = scriptOf({ number: 2, size: 4, startedAt: at(0), endedAt: at(1), steps: 1, bestLength: 9, deaths: 0 }, entries, [[trade(1, 5000, 'vi0'), trade(1, 1, 'b'), trade(1, 1, 'c')]]);
    expect(text).toMatch(/level 2 \(4x4\)/);
    expect(text).toMatch(/1 moves/);
    expect(text).toMatch(/move 1 .* near miss/);
    expect(text).toMatch(/whale/);
    expect(text).toMatch(/crowd/);
    expect(text).toMatch(/\*/);
  });
});
