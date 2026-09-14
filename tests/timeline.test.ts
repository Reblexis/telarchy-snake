import { describe, it, expect } from 'vitest';
import { fullTimeline, shortTimeline, positionAt, SPEED_LADDER, TL_FPS, FULL_MAX, SHORT_MAX, CREDITS_FRAMES, type Segment } from '../src/timeline.js';
import { momentsOf } from '../src/moments.js';
import type { LogStep } from '../src/gamelog.js';
import type { TradeRow } from '../src/level.js';

// docs/level-video.md, "The timeline".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();
type Cell = { x: number; y: number };
const PR = { forward: 10, left: 4, right: 3 };

/** A synthetic level: many quick deaths, a few records, then a winning attempt on a 6x6 grid.
 *  Snake cells are placed on a serpentine so near misses are not accidental; moments come from trades and eats. */
function bigLevel(): { entries: LogStep[]; byMove: TradeRow[][]; size: number } {
  const size = 6;
  const path: Cell[] = [];
  for (let y = 0; y < size; y++) for (let k = 0; k < size; k++) path.push({ x: y % 2 ? size - 1 - k : k, y });
  const entries: LogStep[] = [];
  let length = 2, deaths = 0, i = 0, best = 2;
  const push = () => entries.push({ step: i, at: at(i), snake: path.slice(0, length).reverse(), food: path[Math.min(length, path.length - 1)], heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PR, length, deaths });
  push();
  const move = (c: 'm' | 'e' | 'd') => { i++; if (c === 'e') length++; if (c === 'd') { deaths++; length = 2; } best = Math.max(best, length); push(); };
  for (let a = 0; a < 200; a++) {
    const grow = a % 25 === 0 ? Math.min(20, 3 + a / 10) : 0;
    for (let g = 0; g < grow; g++) { move('m'); move('e'); }
    move('m'); move('m'); move('d');
  }
  while (length < size * size) { move('m'); move('e'); }
  const byMove: TradeRow[][] = entries.map((_, k) => (k % 9 === 0 ? [{ id: `t${k}`, at: at(k), kind: 'trade', actor: { id: 'a', handle: k % 18 === 0 ? 'vi0' : 'bob' }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: k % 90 === 0 ? 900 : 20, callBefore: 1, callAfter: 2, marketId: 'm' } } as TradeRow] : []));
  return { entries, byMove, size };
}
const frames = (tl: Segment[]) => tl.reduce((a, s) => a + s.frames, 0);

describe('the full cut timeline', () => {
  const { entries, byMove, size } = bigLevel();
  const moments = () => momentsOf(entries, size, byMove);
  const tl = () => fullTimeline(entries, size, byMove, moments());

  it('runs at 30 frames a second, at most five minutes, credits last', () => {
    const t = tl();
    expect(TL_FPS).toBe(30);
    expect(FULL_MAX).toBe(5 * 60 * 30);
    expect(frames(t)).toBeLessThanOrEqual(FULL_MAX);
    expect(t.at(-1)).toMatchObject({ kind: 'credits', frames: CREDITS_FRAMES });
    expect(CREDITS_FRAMES).toBe(540);
  });

  it('opens cold on the strongest traded near miss, then cuts to the first move', () => {
    const t = tl();
    const m = moments().filter(x => x.kinds.includes('near miss') && x.credits > 0).sort((a, b) => b.weight - a.weight)[0];
    if (m) {
      expect(t[0]).toMatchObject({ kind: 'beat', move: m.move, cold: true });
      const first = t[1];
      expect(first.kind === 'run' ? (first as any).from === 0 : first.kind === 'beat' && (first as any).move === 1, JSON.stringify(first)).toBe(true);
    } else {
      expect(t[0].kind).toBe('run');
    }
  });

  it('a beat is 10 frames a chip up to three, 3 of hit stop, 12 of the move', () => {
    for (const s of tl().filter(x => x.kind === 'beat') as Array<Extract<Segment, { kind: 'beat' }>>) {
      expect(s.frames).toBe(10 * s.chips + 3 + 12);
      expect(s.chips).toBeLessThanOrEqual(3);
      expect(s.chips).toBe(Math.min(3, (byMove[s.move - 1] ?? []).filter(r => Math.abs(Number(r.detail.cost)) >= 1).length));
    }
  });

  it('outside the finale, between two beats of the story there are always at least 90 frames of run', () => {
    const all = tl();
    const t = all[0].kind === 'beat' && (all[0] as any).cold ? all.slice(1) : all; // the cold open is a replay before the story
    const finaleFrom = entries.length - 1 - 7;
    let sinceBeat = Infinity;
    for (const s of t) {
      if (s.kind === 'beat' && (s as any).move >= finaleFrom) break;
      if (s.kind === 'beat') { expect(sinceBeat, JSON.stringify(s)).toBeGreaterThanOrEqual(90); sinceBeat = 0; }
      else if (s.kind === 'run') sinceBeat += s.frames;
      else if (s.kind === 'credits') break;
    }
  });

  it('runs use the ladder, go forward from their first entry to their last, and ease next to beats', () => {
    const t = tl();
    t.forEach((s, k) => {
      if (s.kind !== 'run') return;
      expect(SPEED_LADDER).toContain(s.speed);
      expect(positionAt(s, 0)).toBe(s.from);
      expect(positionAt(s, s.frames)).toBe(s.to);
      let last = s.from;
      for (let f = 1; f <= s.frames; f++) { const p = positionAt(s, f); expect(p).toBeGreaterThanOrEqual(last); last = p; }
      const beatBefore = t[k - 1]?.kind === 'beat', beatAfter = t[k + 1]?.kind === 'beat';
      if (beatBefore && s.frames > 24) expect(positionAt(s, 1) - positionAt(s, 0)).toBeLessThanOrEqual(4 / 30 + 1e-9 + (s.speed - 4) / 30 / 12);
      if (beatAfter && s.frames > 24) expect(positionAt(s, s.frames) - positionAt(s, s.frames - 1)).toBeLessThanOrEqual(4 / 30 + 1e-9 + (s.speed - 4) / 30 / 12);
    });
  });

  it('the story covers every move exactly once, in order', () => {
    const all = tl();
    const t = all[0].kind === 'beat' && (all[0] as any).cold ? all.slice(1) : all;
    let expectFrom = 0;
    for (const s of t) {
      if (s.kind === 'run') { expect(s.from, JSON.stringify(s)).toBe(expectFrom); expectFrom = s.to; }
      if (s.kind === 'beat') { expect(s.move, JSON.stringify(s)).toBe(expectFrom + 1); expectFrom = s.move; }
    }
    expect(expectFrom).toBe(entries.length - 1);
  });

  it('the first traded decision has a beat with the rules caption', () => {
    const first = byMove.findIndex(l => l.some(r => Math.abs(Number(r.detail.cost)) >= 1)) + 1;
    const beat = tl().find(s => s.kind === 'beat' && !(s as any).cold && (s as any).move === first);
    expect(beat).toMatchObject({ caption: 'Traders bet. The highest price moves.' });
  });

  it('the finale: the last 8 moves are beats, the fill holds 4 frames and then FILLED for 90', () => {
    const t = tl();
    const last = entries.length - 1;
    const beats = t.filter(s => s.kind === 'beat' && !(s as any).cold).map(s => (s as any).move);
    for (let m = last - 7; m <= last; m++) expect(beats).toContain(m);
    const fill = t.filter(s => s.kind === 'hold');
    expect(fill.map(s => [(s as any).fx, s.frames])).toEqual([['hitstop', 4], ['filled', 90]]);
  });

  it('the winning attempt slows as the grid fills', () => {
    const t = tl();
    const winStart = entries.findIndex((e, k) => k > 0 && e.deaths === entries.at(-1)!.deaths && entries[k - 1].deaths < e.deaths);
    const runs = t.filter(s => s.kind === 'run' && (s as any).from >= winStart) as Array<Extract<Segment, { kind: 'run' }>>;
    expect(runs.length).toBeGreaterThan(1);
    for (let k = 1; k < runs.length; k++) expect(runs[k].speed).toBeLessThanOrEqual(runs[k - 1].speed);
  });

  it('a level short enough plays its whole story slowly, still within the rules', () => {
    const size = 2;
    const e: LogStep[] = [0, 1, 2].map(i => ({ step: i, at: at(i), snake: [{ x: 0, y: 0 }, { x: 1, y: 0 }].slice(0, 2 + (i === 2 ? 0 : 0)), food: { x: 1, y: 1 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PR, length: [2, 3, 4][i], deaths: 0 }));
    const t = fullTimeline(e, size, [[], []], momentsOf(e, size, [[], []]));
    expect(frames(t)).toBeLessThanOrEqual(FULL_MAX);
    expect(t.at(-1)!.kind).toBe('credits');
  });
});

describe('the Short timeline', () => {
  const { entries, byMove, size } = bigLevel();
  const tl = () => shortTimeline(entries, size, byMove, momentsOf(entries, size, byMove));
  it('is at most 50 seconds and loops: the last 6 frames repeat the first', () => {
    const t = tl();
    expect(SHORT_MAX).toBe(1500);
    expect(frames(t)).toBeLessThanOrEqual(SHORT_MAX);
    expect(t.at(-1)).toMatchObject({ kind: 'loop', frames: 6 });
  });
  it('hooks on a beat with the caption, then the record crashes at 16 moves a second', () => {
    const t = tl();
    expect(t[0]).toMatchObject({ kind: 'beat', caption: 'A market picks every move.' });
    const crashes = t.filter(s => s.kind === 'run' && (s as any).crash);
    expect(crashes.every(s => (s as any).speed === 16)).toBe(true);
    expect(crashes.length).toBeGreaterThan(0);
    expect(crashes.length).toBeLessThanOrEqual(4);
  });
  it('the winning attempt ends by frame 1,200 with at most two beats, then the fill', () => {
    const t = tl();
    let f = 0, fillAt = -1, beats = 0;
    t.forEach((s, k) => { if (k > 0 && s.kind === 'beat') beats++; if (s.kind === 'hold' && fillAt < 0) fillAt = f; f += s.frames; });
    expect(fillAt).toBeGreaterThan(0);
    expect(fillAt).toBeLessThanOrEqual(1200);
    expect(beats).toBeLessThanOrEqual(2);
  });
});
