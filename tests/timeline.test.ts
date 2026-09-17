import { describe, it, expect } from 'vitest';
import { fullTimeline, shortTimeline, positionAt, runFrames, SPEED_LADDER, TL_FPS, FULL_MAX, SHORT_MAX, CREDITS_FRAMES, type Segment, hookCaption } from '../src/timeline.js';
import { momentsOf } from '../src/moments.js';
import { bigDeaths } from '../src/attempts.js';
import { frameAt } from '../src/frames.js';
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

/** A plain level from a move string on a size x size serpentine: m moves, e eats, d dies. */
function plainLevel(moves: string, size: number): LogStep[] {
  const path: Cell[] = [];
  for (let y = 0; y < size; y++) for (let k = 0; k < size; k++) path.push({ x: y % 2 ? size - 1 - k : k, y });
  const out: LogStep[] = [];
  let length = 2, deaths = 0;
  const push = (i: number) => out.push({ step: i, at: at(i), snake: path.slice(0, length).reverse(), food: path[Math.min(length, path.length - 1)], heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PR, length, deaths });
  push(0);
  [...moves].forEach((c, k) => { if (c === 'e') length++; if (c === 'd') { deaths++; length = 2; } push(k + 1); });
  return out;
}
const whale = (move: number, credits: number): TradeRow => ({ id: `w${move}`, at: at(move), kind: 'trade', actor: { id: 'w', handle: 'whale' }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: credits, callBefore: 1, callAfter: 2, marketId: 'm' } } as TradeRow);

describe('a run\'s length', () => {
  it('a faster run never takes longer, eased or not, however short', () => {
    for (const D of [1, 5, 12, 13, 40, 400]) for (const ease of [[false, false], [true, false], [false, true], [true, true]] as const) {
      let prev = Infinity;
      for (const s of SPEED_LADDER) {
        const f = runFrames(D, s, ease[0], ease[1]);
        expect(f, JSON.stringify({ D, s, ease })).toBeLessThanOrEqual(prev);
        prev = f;
      }
    }
  });
  it('a run too short for its ramps is shortened: one eased move takes less than a single full ramp', () => {
    for (const s of SPEED_LADDER) expect(runFrames(1, s, true, true), String(s)).toBeLessThan(12);
  });

  it('covers its distance exactly with the frames it is given', () => {
    for (const D of [1, 5, 12, 40]) for (const s of [4, 24, 128]) {
      const seg = { kind: 'run' as const, from: 100, to: 100 + D, speed: s, easeIn: true, easeOut: true, frames: runFrames(D, s, true, true) };
      expect(positionAt(seg, 0)).toBe(100);
      expect(positionAt(seg, seg.frames)).toBe(100 + D);
    }
  });
});

describe('the full cut timeline', () => {
  const { entries, byMove, size } = bigLevel();
  const moments = () => momentsOf(entries, size, byMove);
  const tl = () => fullTimeline(entries, size, byMove, moments());

  it('runs at 30 frames a second, at most two and a half minutes, credits last', () => {
    const t = tl();
    expect(TL_FPS).toBe(30);
    expect(FULL_MAX).toBe(150 * 30);
    expect(frames(t)).toBeLessThanOrEqual(FULL_MAX);
    expect(t.at(-1)).toMatchObject({ kind: 'credits', frames: CREDITS_FRAMES });
    expect(CREDITS_FRAMES).toBe(540);
  });

  it('opens game, screen, game, screen, game: the hook, screen 1, the game from move 1, screen 2, the rules beat, screen 3', () => {
    const t = tl();
    const m = moments().filter(x => x.kinds.includes('near miss') && x.credits > 0 && x.move < entries.length - 1 - 7).sort((a, b) => b.weight - a.weight)[0];
    expect(m).toBeTruthy();
    expect(t[0]).toMatchObject({ kind: 'beat', cold: true, slow: true, move: m.move });
    expect((t[0] as any).caption).toBeUndefined();
    expect(t[1]).toEqual({ kind: 'card', card: 'market', entry: m.move, frames: 135 });
    const first = t[2];
    expect(first.kind === 'run' ? (first as any).from === 0 : first.kind !== 'beat' || (first as any).move === 1, JSON.stringify(first)).toBe(true);
    const k = t.findIndex(x => x.kind === 'beat' && !(x as any).cold && (x as any).slow);
    const rules = t[k] as { move: number };
    expect(t[k - 1]).toEqual({ kind: 'card', card: 'bets', entry: rules.move - 1, frames: 240 });
    expect(t[k + 1]).toEqual({ kind: 'card', card: 'move', entry: rules.move, frames: 120 });
    expect(t.filter(x => x.kind === 'card').map(x => (x as any).card)).toEqual(['market', 'bets', 'move']);
  });

  it('at least 90 frames of game separate screen 1 from screen 2, so the screens never flicker past', () => {
    for (const lv of [bigLevel()]) {
      const by = lv.entries.map((_, k) => (k >= 1 && k <= 30 ? [whale(k + 1, 50)] : [])) as TradeRow[][];
      const t = fullTimeline(lv.entries, lv.size, by, momentsOf(lv.entries, lv.size, by));
      const a = t.findIndex(x => x.kind === 'card' && (x as any).card === 'market'), b = t.findIndex(x => x.kind === 'card' && (x as any).card === 'bets');
      expect(b).toBeGreaterThan(a);
      expect(t.slice(a + 1, b).reduce((n, x) => n + x.frames, 0)).toBeGreaterThanOrEqual(90);
      expect((t[b + 1] as any).move).toBeGreaterThanOrEqual(13);
    }
  });

  it('the explanation screen is way too fast: each screen stays long enough to read at three words a second, with a second to spare', () => {
    const words = { market: 10, bets: 20, move: 8 };
    for (const c of tl().filter(x => x.kind === 'card') as Array<{ card: keyof typeof words; frames: number }>) expect(c.frames, c.card).toBeGreaterThanOrEqual((words[c.card] / 3 + 1) * 30);
  });

  it('the hook never gives away the fill: its moment comes from before the finale\'s last 8 moves', () => {
    const last = entries.length - 1;
    const nearMiss = (move: number, weight: number) => ({ move, at: entries[move].at, kinds: ['near miss', 'whale'] as any, weight, credits: 1000, traders: 1 });
    const t = fullTimeline(entries, size, byMove, [nearMiss(60, 8), nearMiss(last - 2, 20)]);
    expect(t[0]).toMatchObject({ kind: 'beat', cold: true, move: 60 });
  });

  it('a level with no traded near miss opens on screen 1 over move 0; with no rules beat the other screens follow it', () => {
    const plain = plainLevel('me'.repeat(34), 6);
    const none = plain.map(() => [] as TradeRow[]);
    const t = fullTimeline(plain, 6, none, momentsOf(plain, 6, none));
    expect(t.slice(0, 3)).toEqual([{ kind: 'card', card: 'market', entry: 0, frames: 135 }, { kind: 'card', card: 'bets', entry: 0, frames: 240 }, { kind: 'card', card: 'move', entry: 0, frames: 120 }]);
  });

  it('a beat is 20 frames a chip up to three, 18 of lock, 18 of move; the rules beat twice that', () => {
    const beats = tl().filter(x => x.kind === 'beat') as Array<Extract<Segment, { kind: 'beat' }>>;
    // no caption is laid over the game: the cards said it
    expect(beats.some(s => s.caption)).toBe(false);
    // half speed: the hook and the rules beat, nothing else
    expect(beats.filter(s => s.slow && !s.cold).length).toBe(1);
    expect(beats.filter(s => s.cold).every(s => s.slow)).toBe(true);
    for (const s of beats) {
      expect(s.frames).toBe((20 * s.chips + 18 + 18) * (s.slow ? 2 : 1));
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

  it('two beats 13 moves apart still get 90 frames of run between them, however fast the level runs', () => {
    const size = 6;
    const lv = plainLevel('m'.repeat(6000) + 'e'.repeat(34), size);
    const by: TradeRow[][] = lv.map(() => []);
    by[999] = [whale(1000, 5000)];
    by[1012] = [whale(1013, 5000)];
    const t = fullTimeline(lv, size, by, momentsOf(lv, size, by));
    const k1 = t.findIndex(s => s.kind === 'beat' && (s as any).move === 1000);
    const k2 = t.findIndex(s => s.kind === 'beat' && (s as any).move === 1013);
    expect(k1).toBeGreaterThanOrEqual(0);
    expect(k2).toBeGreaterThan(k1);
    expect(frames(t.slice(k1 + 1, k2))).toBeGreaterThanOrEqual(90);
  });

  it('after a beat a fast run eases in: its advance climbs over its first 12 frames', () => {
    const lv = plainLevel('m'.repeat(6000) + 'e'.repeat(34), 6);
    const by: TradeRow[][] = lv.map(() => []);
    by[999] = [whale(1000, 5000)];
    const t = fullTimeline(lv, 6, by, momentsOf(lv, 6, by));
    // the game goes on gently after a beat, also when a screen popped up in between
    const before = (k: number) => { let j = k - 1; while (j >= 0 && t[j].kind === 'card') j--; return t[j]; };
    const eased = t.filter((s, k) => s.kind === 'run' && before(k)?.kind === 'beat' && (s as any).speed >= 8 && s.frames > 40) as Array<Extract<Segment, { kind: 'run' }>>;
    expect(eased.length).toBeGreaterThan(0);
    for (const s of eased) {
      const first = positionAt(s, 1) - positionAt(s, 0), twelfth = positionAt(s, 12) - positionAt(s, 11);
      expect(twelfth, JSON.stringify(s)).toBeGreaterThan(first * 1.3);
    }
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

  it('the first traded decision from move 13 on is the rules beat: at half speed, with no caption', () => {
    // the first traded decision from move 13 on (byMove[k] holds the trades of move k + 1)
    const first = byMove.findIndex((l, k) => k + 1 >= 13 && l.some(r => Math.abs(Number(r.detail.cost)) >= 1)) + 1;
    const beat = tl().find(s => s.kind === 'beat' && !(s as any).cold && (s as any).move === first);
    expect(beat).toMatchObject({ slow: true });
    expect((beat as any).caption).toBeUndefined();
  });

  it('the finale: the last 8 moves are beats, the fill holds 4 frames and then FILLED for 90', () => {
    const t = tl();
    const last = entries.length - 1;
    const beats = t.filter(s => s.kind === 'beat' && !(s as any).cold).map(s => (s as any).move);
    for (let m = last - 7; m <= last; m++) expect(beats).toContain(m);
    const fill = t.filter(s => s.kind === 'hold' && s.fx !== 'freeze');
    expect(fill.map(s => [(s as any).fx, s.frames])).toEqual([['hitstop', 4], ['filled', 90]]);
  });

  it('the winning attempt slows as the grid fills', () => {
    const t = tl();
    const winStart = entries.findIndex((e, k) => k > 0 && e.deaths === entries.at(-1)!.deaths && entries[k - 1].deaths < e.deaths);
    // a short run between two beats (easing in and out) slows only itself and is not part of the fall
    const runs = t.filter(s => s.kind === 'run' && (s as any).from >= winStart && !((s as any).easeIn && (s as any).easeOut)) as Array<Extract<Segment, { kind: 'run' }>>;
    expect(runs.length).toBeGreaterThan(1);
    for (let k = 1; k < runs.length; k++) expect(runs[k].speed).toBeLessThanOrEqual(runs[k - 1].speed);
    if (runs[0].speed > 4) expect(runs[runs.length - 1].speed).toBeLessThan(runs[0].speed);
  });

  it('after a long, fast struggle the winning attempt ends clearly slower than it starts', () => {
    const size = 6;
    // 1,500 quick deaths force a fast struggle, then an attempt that fills the grid
    const lv = plainLevel('md'.repeat(1500) + 'me'.repeat(34), size);
    const by: TradeRow[][] = lv.map(() => []);
    const t = fullTimeline(lv, size, by, momentsOf(lv, size, by));
    const winStart = lv.findIndex((e, k) => k > 0 && e.deaths === lv.at(-1)!.deaths && lv[k - 1].deaths < e.deaths);
    const runs = t.filter(s => s.kind === 'run' && (s as any).from >= winStart && !((s as any).easeIn && (s as any).easeOut)) as Array<Extract<Segment, { kind: 'run' }>>;
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[0].speed).toBeGreaterThan(4);
    expect(runs[runs.length - 1].speed).toBeLessThan(runs[0].speed);
  });

  it('a level short enough plays its whole story slowly, still within the rules', () => {
    const size = 2;
    const e: LogStep[] = [0, 1, 2].map(i => ({ step: i, at: at(i), snake: [{ x: 0, y: 0 }, { x: 1, y: 0 }].slice(0, 2 + (i === 2 ? 0 : 0)), food: { x: 1, y: 1 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PR, length: [2, 3, 4][i], deaths: 0 }));
    const t = fullTimeline(e, size, [[], []], momentsOf(e, size, [[], []]));
    expect(frames(t)).toBeLessThanOrEqual(FULL_MAX);
    expect(t.at(-1)!.kind).toBe('credits');
  });
});

describe('the rules beat teaches on real prices', () => {
  it('it skips traded moves whose prices were not recorded and takes the first one that has all three', () => {
    const entries = plainLevel('m'.repeat(60) + 'me'.repeat(34), 6).map((e, i) => (i < 20 ? { ...e, prices: { forward: null, left: null, right: null } } : e)) as unknown as LogStep[];
    const byMove = entries.map(() => [] as TradeRow[]);
    byMove[4] = [whale(5, 50)];
    byMove[24] = [whale(25, 50)];
    const tl = fullTimeline(entries, 6, byMove, momentsOf(entries, 6, byMove));
    const rules = tl.find(s => s.kind === 'beat' && s.slow) as { move: number };
    expect(rules.move).toBe(25);
  });
});

describe('a level inside the series cut', () => {
  const lv = bigLevel();
  const ms = momentsOf(lv.entries, lv.size, lv.byMove);
  const step = { label: 'LEVEL 1 FILLED', lines: ["Let's step it up a notch.", 'How about a 6×6 grid?'], gold: '6×6' };
  it('a later level starts straight on move 1: no hook, no screens, no rules beat', () => {
    const t = fullTimeline(lv.entries, lv.size, lv.byMove, ms, { opening: false, credits: false });
    expect(t.some(s => s.kind === 'card')).toBe(false);
    expect(t.some(s => s.kind === 'beat' && (s.cold || s.slow))).toBe(false);
    expect(t[0].kind === 'run' ? (t[0] as any).from : (t[0] as any).move - 1).toBe(0);
  });
  it('no credits between levels: it ends on the fill, then its step-up screen over the filled board', () => {
    const last = lv.entries.length - 1;
    const t = fullTimeline(lv.entries, lv.size, lv.byMove, ms, { opening: false, credits: false, stepUp: step });
    expect(t.some(s => s.kind === 'credits')).toBe(false);
    expect(t.slice(-3)).toEqual([{ kind: 'hold', fx: 'hitstop', entry: last, frames: 4 }, { kind: 'hold', fx: 'filled', entry: last, frames: 90 }, { kind: 'card', card: 'text', entry: last, frames: 105, ...step }]);
  });
  it('the last level ends on the fill alone', () => {
    const t = fullTimeline(lv.entries, lv.size, lv.byMove, ms, { opening: false, credits: false });
    expect(t.at(-1)).toMatchObject({ kind: 'hold', fx: 'filled' });
  });
  it('a level keeps inside its own budget, step-up screen included', () => {
    for (const max of [2010, 3036]) {
      const t = fullTimeline(lv.entries, lv.size, lv.byMove, ms, { opening: false, credits: false, stepUp: step, maxFrames: max });
      expect(frames(t)).toBeLessThanOrEqual(max);
    }
  });
  it('the first level of a series keeps the opening', () => {
    const t = fullTimeline(lv.entries, lv.size, lv.byMove, ms, { credits: false, stepUp: step });
    expect(t.filter(s => s.kind === 'card').map(s => (s as any).card)).toEqual(['market', 'bets', 'move', 'text']);
  });
  it('with no options it is the full cut as before', () => {
    expect(fullTimeline(lv.entries, lv.size, lv.byMove, ms)).toEqual(fullTimeline(lv.entries, lv.size, lv.byMove, ms, {}));
    expect(fullTimeline(lv.entries, lv.size, lv.byMove, ms).at(-1)).toMatchObject({ kind: 'credits' });
  });
});

describe('the full cut is short', () => {
  it('two and a half minutes at most, whatever the level', () => {
    expect(FULL_MAX).toBe(150 * TL_FPS);
  });
});

describe("the hook's caption", () => {
  const entries = plainLevel('mmmm', 6);
  it('says how many credits were traded on the move, whichever way they were bet', () => {
    const byMove = entries.map(() => [] as TradeRow[]);
    byMove[2] = [whale(3, 9000), whale(3, 989.4)];
    expect(hookCaption(entries, byMove, 3)).toBe('One way out. 9,989 credits on this move.');
    // it never claims the credits backed the way played: most may have been bet against it
    expect(hookCaption(entries, byMove, 3)).not.toMatch(/say/);
  });
  it('is the short sentence alone when nobody traded the move, or under one credit', () => {
    const byMove = entries.map(() => [] as TradeRow[]);
    expect(hookCaption(entries, byMove, 3)).toBe('One way out.');
    byMove[2] = [whale(3, 0.4)];
    expect(hookCaption(entries, byMove, 3)).toBe('One way out.');
  });
  it('the Short opens under it too', () => {
    const big = bigLevel();
    const ms = momentsOf(big.entries, big.size, big.byMove);
    const s0 = shortTimeline(big.entries, big.size, big.byMove, ms)[0] as { move: number; caption?: string };
    expect(s0.caption).toBe(hookCaption(big.entries, big.byMove, s0.move));
  });
});

describe('big deaths', () => {
  // 6x6: 40 percent of the grid is 14.4, so an attempt that reached 15 dies big and one that reached 14 does not
  const grow = (n: number) => 'me'.repeat(n - 2);
  const level = () => plainLevel(`${grow(5)}mmd${grow(15)}mmd${grow(14)}mmd${'mmd'.repeat(30)}${grow(16)}mmd${grow(36)}`, 6);
  const crashes = (entries: LogStep[]) => entries.map((e, i) => (i > 0 && e.deaths > entries[i - 1].deaths ? i : -1)).filter(i => i > 0);
  it('a death after reaching 40 percent of the grid is big; one short of it is not', () => {
    expect(bigDeaths(level(), 6).map(i => level()[i - 1].length)).toEqual([15, 16]);
  });
  it('every big death is a beat on the move that kills the snake, and no small death is', () => {
    const entries = level();
    const byMove = entries.map(() => [] as TradeRow[]);
    const tl = fullTimeline(entries, 6, byMove, momentsOf(entries, 6, byMove));
    const beats = new Set(tl.filter(s => s.kind === 'beat').map(s => (s as { move: number }).move));
    const big = bigDeaths(entries, 6);
    expect(big.length).toBe(2);
    for (const c of crashes(entries)) expect(beats.has(c), `crash at ${c}`).toBe(big.includes(c));
  });
  it('the run into a big death eases down, so the snake never jumps from fast to slow', () => {
    const entries = level();
    const byMove = entries.map(() => [] as TradeRow[]);
    const tl = fullTimeline(entries, 6, byMove, momentsOf(entries, 6, byMove));
    for (const c of bigDeaths(entries, 6)) {
      const k = tl.findIndex(s => s.kind === 'beat' && s.move === c);
      const before = tl[k - 1];
      expect(before.kind).toBe('run');
      if (before.kind === 'run') expect(before.easeOut).toBe(true);
    }
  });
  it('the winning attempt is never a death, and a level with no big death gets no such beat', () => {
    const entries = plainLevel(`${'mmd'.repeat(10)}${grow(36)}`, 6);
    expect(bigDeaths(entries, 6)).toEqual([]);
  });
  it('a big death that set no record shows DIED AT, a record crash keeps its record card', () => {
    // attempt 2 reached 15 (a record), attempt 34 reached 16 (a record); make a later big death below the record
    const entries = plainLevel(`${grow(20)}mmd${grow(15)}mmd${grow(36)}`, 6);
    const byMove = entries.map(() => [] as TradeRow[]);
    const tl = fullTimeline(entries, 6, byMove, momentsOf(entries, 6, byMove));
    const texts = new Set<string>();
    const total = tl.reduce((a, s2) => a + s2.frames, 0);
    for (let f = 0; f < total; f += 5) { const c = frameAt(tl, entries, f).lowerThird; if (c) texts.add(c.text); }
    expect([...texts]).toContain('RECORD 20 · attempt 1');
    expect([...texts]).toContain('DIED AT 15 · attempt 2');
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
    expect(t[0]).toMatchObject({ kind: 'beat', caption: 'One way out.' });
    // the Short's hook plays at normal speed
    expect((t[0] as any).slow).toBeFalsy();
    expect(t[0].frames).toBe(20 * (t[0] as any).chips + 36);
    const crashes = t.filter(s => s.kind === 'run' && (s as any).crash);
    expect(crashes.every(s => (s as any).speed === 16)).toBe(true);
    expect(crashes.length).toBeGreaterThan(0);
    expect(crashes.length).toBeLessThanOrEqual(4);
  });
  it('the fill comes by frame 1,200 even when a slower speed would still end before frame 1,400', () => {
    const size = 18; // 324 cells: the winning attempt grows by eating on every other move
    const lv = plainLevel('md'.repeat(3) + 'me'.repeat(160) + 'e'.repeat(2), size);
    const by: TradeRow[][] = lv.map(() => []);
    const t = shortTimeline(lv, size, by, momentsOf(lv, size, by));
    let f = 0, fillAt = -1;
    for (const s of t) { if (s.kind === 'hold' && fillAt < 0) fillAt = f; f += s.frames; }
    expect(fillAt).toBeGreaterThan(0);
    expect(fillAt).toBeLessThanOrEqual(1200);
  });

  it('the Short\'s hook never gives away the fill', () => {
    const last = entries.length - 1;
    const winStart = entries.findIndex((e, k) => k > 0 && e.deaths === entries[last].deaths && entries[k - 1].deaths < e.deaths);
    const nearMiss = (move: number, weight: number) => ({ move, at: entries[move].at, kinds: ['near miss'] as any, weight, credits: 0, traders: 0 });
    // the winning attempt's last near miss is in its final moves; an earlier one exists
    const t = shortTimeline(entries, size, byMove, [nearMiss(winStart + 5, 5), nearMiss(last - 1, 9)]);
    expect(t[0]).toMatchObject({ kind: 'beat', move: winStart + 5 });
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
