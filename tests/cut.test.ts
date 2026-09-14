import { describe, it, expect } from 'vitest';
import { attempts, fullCutPlan, interestScores, planAtSpeed, cutReport, SPEEDS, FULL_MAX_FRAMES, type Shot } from '../src/fun.js';
import { FPS } from '../src/level.js';
import type { LogStep } from '../src/gamelog.js';

// docs/snake.md, "The fun cuts": the full cut runs five minutes at most, and the boring parts go fast.

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();
type P = { forward: number | null; left: number | null; right: number | null };
const LEVEL: P = { forward: 2, left: 2.5, right: 3 };

/** A level from a move string: m moves, e eats, d dies; prices per entry optional. */
function level(moves: string, prices: (i: number) => P = () => LEVEL): LogStep[] {
  const out: LogStep[] = [];
  let length = 2, deaths = 0;
  const push = (i: number) => out.push({
    step: i, at: at(i), snake: [{ x: 1, y: 0 }, { x: 0, y: 0 }], food: { x: 1, y: 1 }, heading: 'right',
    action: i === 0 ? null : 'forward', direction: 'right', undecided: false, prices: prices(i), length, deaths,
  });
  push(0);
  [...moves].forEach((c, k) => {
    if (c === 'e') length++;
    if (c === 'd') { deaths++; length = 2; }
    push(k + 1);
  });
  return out;
}
const kind = (s: Shot) => (s.card ? s.card : (s.bet ?? 0) > 0 ? 'bet' : s.fx === 'death' ? 'crash' : s.fx === 'fill' ? 'fill' : 'move');
const total = (plan: Shot[]) => plan.reduce((a, s) => a + s.frames, 0);

describe('the interest score', () => {
  // a0 dies at 2 (record), a1 eats to 3 and dies (record), a2 dies at 2 (no record), a3 wins by filling a 2x2 grid
  const L = level('md' + 'emd' + 'md' + 'mee', i => (i === 4 ? { forward: 1, left: 9, right: 2 } : LEVEL));
  const scores = (credits: number[] = []) => interestScores(L, 2, credits.map(c => (c > 0 ? 1 : 0)), credits);

  it('the fill and the crash that ends a record attempt are always kept', () => {
    const s = scores();
    expect(s[10]).toBe(Infinity); // the fill
    expect(s[2]).toBe(Infinity); // a0's crash, a record
    expect(s[5]).toBe(Infinity); // a1's crash, a record
    expect(Number.isFinite(s[7])).toBe(true); // a2's crash set no record
  });
  it('an eat scores 3', () => {
    const s = scores();
    expect(s[9] - s[8]).toBe(3); // both in the winning attempt at level prices; only move 9 eats
  });
  it('credits traded score log2(1 + credits)', () => {
    const credits = Array(10).fill(0);
    credits[5] = 100; // the move from entry 5 into entry 6, in a2
    const s = scores(credits);
    expect(s[6] - scores()[6]).toBeCloseTo(Math.log2(101), 6);
  });
  it('options 5 or more apart score 2, level prices nothing', () => {
    const s = scores();
    // move 4 has prices 1 / 9 / 2; move 3 is level but eats (3); both in a record attempt
    expect(s[4]).toBe(2 + 2);
    expect(s[3]).toBe(3 + 2);
  });
  it('a record or filling attempt scores 2, the winning attempt 2 more, a plain move of a failed attempt nothing', () => {
    const s = scores();
    expect(s[1]).toBe(2); // a0, record, plain move
    expect(s[6]).toBe(0); // a2, no record, plain move
    expect(s[8]).toBe(4); // a3, the winning attempt, plain move
  });
});

describe('a level short enough plays whole at normal pace', () => {
  const L = level('md' + 'emd' + 'md' + 'mee');
  const TC = [2, 1, 0, 0, 0, 4, 0, 0, 5, 0];
  it('every move at four a second, every traded move with its beat, no badge', () => {
    const plan = fullCutPlan(L, 2, TC, TC.map(n => n * 10));
    expect(plan.some(s => s.badge)).toBe(false);
    expect(plan.map(s => [s.entry, kind(s)])).toEqual([
      [0, 'move'],
      [0, 'bet'], [1, 'move'],
      [1, 'bet'], [1, 'crash'], [2, 'move'],
      [3, 'move'], [4, 'move'],
      [4, 'crash'], [5, 'move'],
      [5, 'bet'], [6, 'move'],
      [6, 'crash'], [7, 'move'],
      [8, 'move'],
      [8, 'bet'], [9, 'move'],
      [10, 'fill'],
    ]);
    expect(plan.filter(s => kind(s) === 'move').every(s => s.frames === 6)).toBe(true);
    expect(plan.filter(s => kind(s) === 'crash').every(s => s.frames === FPS)).toBe(true);
    expect(plan.at(-1)!.frames).toBe(5 * FPS);
  });
});

/** Level 2's shape: 228 quick deaths (a few records among them), then a long winning attempt, most moves traded a little. */
function longLevel() {
  let moves = '';
  for (let a = 0; a < 228; a++) moves += a % 40 === 0 ? 'e'.repeat(Math.min(4, 1 + a / 40)) + 'md' : 'md';
  moves += 'me'.repeat(30) + 'm'.repeat(300) + 'eeee'; // the winning attempt grows 2 + 30 + 4 = 36, filling 6x6
  const lv = level(moves, i => (i % 7 === 0 ? { forward: 1, left: 20, right: 3 } : LEVEL));
  const tc = lv.map((_, i) => (i % 3 === 0 ? 1 : i % 11 === 0 ? 4 : 0));
  const cr = tc.map((n, i) => (n === 0 ? 0 : i % 29 === 0 ? 900 : 10 * n));
  return { lv, tc, cr, size: 6 };
}

describe('a long level: five minutes at most, the boring parts fast', () => {
  it('never runs past five minutes', () => {
    const { lv, tc, cr, size } = longLevel();
    const plan = fullCutPlan(lv, size, tc, cr);
    expect(FULL_MAX_FRAMES).toBe(5 * 60 * FPS);
    expect(total(plan)).toBeLessThanOrEqual(FULL_MAX_FRAMES);
  });

  it('boring runs share one speed from the ladder, shown as a badge, and it is the slowest that fits', () => {
    const { lv, tc, cr, size } = longLevel();
    const plan = fullCutPlan(lv, size, tc, cr);
    const badges = [...new Set(plan.map(s => s.badge).filter(Boolean))];
    expect(badges).toHaveLength(1);
    const speed = Number(String(badges[0]).slice(1));
    expect(SPEEDS).toContain(speed);
    const i = SPEEDS.indexOf(speed);
    if (i > 0) expect(total(planAtSpeed(lv, size, tc, cr, SPEEDS[i - 1]))).toBeGreaterThan(FULL_MAX_FRAMES);
  });

  it('the fill, the record crashes and the opening are never cut', () => {
    const { lv, tc, cr, size } = longLevel();
    const plan = fullCutPlan(lv, size, tc, cr);
    const recordEnds = attempts(lv, size).slice(0, -1).filter(a => a.record).map(a => a.end - 1);
    const crashes = plan.filter(s => s.fx === 'death' && !s.badge).map(s => s.entry);
    for (const e of recordEnds) expect(crashes).toContain(e);
    expect(plan.at(-1)).toMatchObject({ fx: 'fill', frames: 5 * FPS });
    expect(plan[0].caption).toBe('A market picks every move.');
  });

  it('a kept move scores at least as high as any boring move', () => {
    const { lv, tc, cr, size } = longLevel();
    const plan = fullCutPlan(lv, size, tc, cr);
    const scores = interestScores(lv, size, tc, cr);
    const keptMoves = plan.filter(s => kind(s) === 'move' && !s.badge && s.entry > 0).map(s => scores[s.entry]).filter(Number.isFinite);
    const boringMoves = plan.filter(s => s.badge && s.fx !== 'death').map(s => scores[s.entry]);
    expect(keptMoves.length).toBeGreaterThan(0);
    expect(boringMoves.length).toBeGreaterThan(0);
    expect(Math.min(...keptMoves)).toBeGreaterThanOrEqual(Math.max(...boringMoves));
  });

  it('only kept moves have beats, every traded kept move has one, and kept moves play at normal pace', () => {
    const { lv, tc, cr, size } = longLevel();
    const plan = fullCutPlan(lv, size, tc, cr);
    plan.forEach((s, i) => {
      if (kind(s) === 'bet') {
        const next = plan.slice(i + 1).find(x => kind(x) !== 'crash')!;
        expect(next.badge, JSON.stringify(s)).toBeNull();
      }
      if (kind(s) === 'move' && !s.badge && s.entry > 0) {
        expect(s.frames).toBe(6);
        if ((tc[s.entry - 1] ?? 0) > 0) {
          const before = plan.slice(0, i).reverse().find(x => kind(x) !== 'crash');
          expect(kind(before!), JSON.stringify(s)).toBe('bet');
        }
      }
    });
  });

  it('kept moves and their beats take three fifths of the five minutes at most', () => {
    const { lv, tc, cr, size } = longLevel();
    const plan = fullCutPlan(lv, size, tc, cr);
    const scores = interestScores(lv, size, tc, cr);
    const kept = plan.filter(s => !s.badge && s.fx !== 'fill' && !(s.fx === 'death' && scores[s.entry + 1] === Infinity) && s.entry > 0);
    expect(total(kept)).toBeLessThanOrEqual((FULL_MAX_FRAMES * 3) / 5);
  });

  it('a run at x12 shows every second boring move for one frame', () => {
    const { lv, tc, cr, size } = longLevel();
    const plan = planAtSpeed(lv, size, tc, cr, 12);
    const run: number[] = [];
    for (const s of plan) {
      if (s.badge === 'x12' && s.fx === null) run.push(s.entry);
      else if (run.length > 6) break;
      else run.length = 0;
    }
    expect(run.length).toBeGreaterThan(6);
    for (let k = 1; k < run.length; k++) expect(run[k] - run[k - 1]).toBe(2);
    expect(plan.filter(s => s.badge === 'x12').every(s => s.frames === 1)).toBe(true);
  });

  it('the cut runs forward through the level', () => {
    const { lv, tc, cr, size } = longLevel();
    let last = 0;
    for (const s of fullCutPlan(lv, size, tc, cr)) {
      expect(s.entry, JSON.stringify(s)).toBeGreaterThanOrEqual(last - 1);
      last = Math.max(last, s.entry);
    }
  });

  it('the cut report says where the time goes and what was called boring', () => {
    const { lv, tc, cr, size } = longLevel();
    const report = cutReport(lv, size, tc, cr);
    expect(report).toMatch(/kept moves/);
    expect(report).toMatch(/boring moves/);
    expect(report).toMatch(/speed x(3|6|12|24|48)/);
    expect(report).toMatch(/total \d+:\d\d/);
  });
});
