import { describe, it, expect } from 'vitest';
import { levelBudgetFrames, stepUpScreen, levelStats, whatChanged, topTradersOverall, seriesSidecar, type LevelStats } from '../src/series.js';
import type { GameEntry, LogStep } from '../src/gamelog.js';
import type { TradeRow } from '../src/level.js';

// docs/level-video.md, "The series cut: every level in one continuous video".

const stats = (over: Partial<LevelStats>): LevelStats => ({ level: 1, size: 4, cells: 16, span: '3h 22m', moves: 200, deaths: 58, trades: 99, traders: 3, credits: 4000, ...over });

describe('a level\'s time budget in the series', () => {
  it('is 40 + 1.7 x cells seconds, at most 150', () => {
    expect(levelBudgetFrames(4)).toBe(Math.round((40 + 1.7 * 16) * 30));
    expect(levelBudgetFrames(6)).toBe(Math.round((40 + 1.7 * 36) * 30));
    expect(levelBudgetFrames(8)).toBe(Math.round((40 + 1.7 * 64) * 30));
    expect(levelBudgetFrames(10)).toBe(150 * 30);
    expect(levelBudgetFrames(30)).toBe(150 * 30);
  });
});

describe('the step-up screen between two levels', () => {
  it('level 2: step it up a notch, how about a 6×6 grid', () => {
    expect(stepUpScreen(1, 2, 6)).toEqual({ label: 'LEVEL 1 FILLED', lines: ["Let's step it up a notch.", 'How about a 6×6 grid?'], gold: '6×6' });
  });
  it('level 3: too easy, the size and its cells', () => {
    expect(stepUpScreen(2, 3, 8)).toEqual({ label: 'LEVEL 2 FILLED', lines: ['Too easy.', '8×8: 64 cells to fill.'], gold: '8×8' });
  });
  it('level 4 and from level 5 on', () => {
    expect(stepUpScreen(3, 4, 10).lines).toEqual(['Bigger again.', '10×10: 100 cells to fill.']);
    expect(stepUpScreen(4, 5, 12).lines[0]).toBe('And again.');
    expect(stepUpScreen(8, 9, 20).lines).toEqual(['And again.', '20×20: 400 cells to fill.']);
  });
});

describe('a level\'s figures', () => {
  const at = (m: number) => new Date(Date.parse('2026-09-11T20:00:00Z') + m * 60_000).toISOString();
  const e = (i: number, deaths: number): LogStep => ({ step: i, at: at(i), snake: [{ x: 0, y: 0 }], food: { x: 1, y: 1 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: { forward: 1, left: 1, right: 1 }, length: 1, deaths });
  const t = (id: string, handle: string, cost: number): TradeRow => ({ id, at: at(1), kind: 'trade', actor: { id: handle, handle }, detail: { side: 'buy', direction: 'higher', shares: 1, cost, callBefore: 1, callAfter: 2, marketId: 'm' } });
  const game: GameEntry = { number: 2, size: 6, startedAt: at(0), endedAt: at(125), steps: 3, bestLength: 36, deaths: 2 };
  it('counts moves, deaths, trades, distinct traders and the credits traded whichever way', () => {
    const s = levelStats(game, [e(0, 0), e(1, 0), e(2, 1), e(3, 2)], [t('1', 'ann', 10.4), t('2', 'ann', -5.2), t('3', 'bob', 100)]);
    expect(s).toEqual({ level: 2, size: 6, cells: 36, span: '2h 5m', moves: 3, deaths: 2, trades: 3, traders: 2, credits: 115.6 });
  });
  it('a level nobody traded has zero trades, traders and credits', () => {
    expect(levelStats(game, [e(0, 0), e(1, 0)], [])).toMatchObject({ trades: 0, traders: 0, credits: 0, moves: 1 });
  });
});

describe('what changed is measured, never asserted', () => {
  const three = [stats({}), stats({ level: 2, size: 6, cells: 36, moves: 2042, deaths: 228, trades: 2404, credits: 90000 }), stats({ level: 3, size: 8, cells: 64, moves: 5456, deaths: 39, trades: 37217, credits: 2_900_000 })];
  it('each line is a rate per level, first to last, with its reading', () => {
    expect(whatChanged(three)).toEqual([
      'Deaths per cell filled fell: 3.6 → 6.3 → 0.6',
      'Trades per move rose: 0.5 → 1.2 → 6.8',
      'Credits traded per move rose: 20 → 44 → 532',
      'Moves per cell filled rose: 12.5 → 56.7 → 85.3',
    ]);
  });
  it('a rate whose first and last level differ by less than a fifth held', () => {
    const flat = [stats({ deaths: 16 }), stats({ level: 2, deaths: 18 })];
    expect(whatChanged(flat)[0]).toBe('Deaths per cell filled held: 1.0 → 1.1');
  });
  it('a first level at zero that then moves rose; zero throughout held', () => {
    expect(whatChanged([stats({ trades: 0 }), stats({ level: 2, trades: 50 })])[1]).toBe('Trades per move rose: 0.0 → 0.3');
    expect(whatChanged([stats({ trades: 0 }), stats({ level: 2, trades: 0 })])[1]).toBe('Trades per move held: 0.0 → 0.0');
  });
  it('one level alone has nothing to compare', () => {
    expect(whatChanged([stats({})])).toEqual([]);
  });
});

describe('the top traders over all levels', () => {
  const t = (handle: string, cost: number): TradeRow => ({ id: handle + cost, at: '2026-09-11T20:00:00Z', kind: 'trade', actor: { id: handle, handle }, detail: { side: 'buy', direction: 'higher', shares: 1, cost, callBefore: 1, callAfter: 2, marketId: 'm' } });
  it('sums credits traded across levels, largest first, five at most', () => {
    const top = topTradersOverall([[t('ann', 10), t('bob', 5)], [t('ann', -30), t('cy', 20), t('d', 1), t('e', 2), t('f', 3), t('g', 4)]]);
    expect(top).toEqual([{ handle: 'ann', credits: 40 }, { handle: 'cy', credits: 20 }, { handle: 'bob', credits: 5 }, { handle: 'g', credits: 4 }, { handle: 'f', credits: 3 }]);
  });
});

describe('the series sidecar', () => {
  it('is titled by the first and last level', () => {
    const sc = seriesSidecar([stats({}), stats({ level: 2, size: 6 }), stats({ level: 3, size: 8 })], 398.5);
    expect(sc.title).toBe('A prediction market plays snake: levels 1 to 3');
    expect(sc.levels).toEqual([1, 2, 3]);
    expect(sc.durationSeconds).toBe(398.5);
    expect(sc.description).toContain('https://telarchy.com/snake');
    expect(sc.description).toContain('4x4');
  });
});

// ---------------------------------------------------------------------------------------------
// the comparison screens at the end of the series

import { drawSeriesEnd, SERIES_END_FRAMES, type SeriesEnd } from '../src/draw.js';

describe('the comparison after the last fill', () => {
  const end: SeriesEnd = {
    levels: [stats({}), stats({ level: 2, size: 6, cells: 36, span: '34h 42m', moves: 2042, deaths: 228, trades: 2404, traders: 9, credits: 90000 }), stats({ level: 3, size: 8, cells: 64, span: '91h 7m', moves: 5456, deaths: 39, trades: 37217, traders: 16, credits: 2_900_000.4 })],
    changed: ['Deaths per cell filled fell: 3.6 → 6.3 → 0.6', 'Trades per move rose: 0.5 → 1.2 → 6.8', 'Credits traded per move rose: 20 → 44 → 532', 'Moves per cell filled rose: 12.5 → 56.7 → 85.3'],
    top: [{ handle: 'vi0', credits: 2443345 }, { handle: 'bobalobascrob', credits: 514947 }, { handle: 'Wobert', credits: 12000 }],
  };
  const texts = (screen: 'table' | 'changed' | 'close', frame: number) => drawSeriesEnd(end, screen, frame).texts;
  const words = (screen: 'table' | 'changed' | 'close', frame: number) => texts(screen, frame).map(t => t.text);
  const overlaps = (ts: ReturnType<typeof texts>) => { for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const a = ts[i], b = ts[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.text} over ${b.text}`; } return null; };

  it('the screens last 300, 270 and 300 frames', () => {
    expect(SERIES_END_FRAMES).toEqual({ table: 300, changed: 270, close: 300 });
  });
  it('the table has a column per level and a row per figure, every figure in full', () => {
    const w = words('table', 250);
    for (const t of ['EVERY LEVEL, SIDE BY SIDE', '4×4', '6×6', '8×8', 'REAL TIME', 'MOVES', 'DEATHS', 'TRADES', 'TRADERS', 'CREDITS TRADED', '91h 7m', '5,456', '228', '37,217', '16', '2,900,000']) expect(w, t).toContain(t);
  });
  it('the table\'s rows arrive one after another, 12 frames apart, and stay', () => {
    const rows = ['REAL TIME', 'MOVES', 'DEATHS', 'TRADES', 'TRADERS', 'CREDITS TRADED'];
    const shown = (f: number) => rows.filter(r => words('table', f).includes(r)).length;
    expect(shown(5)).toBe(0);
    // the first row at frame 14, the second at 26
    expect(shown(20)).toBe(1);
    expect(shown(30)).toBe(2);
    expect(shown(100)).toBe(6);
    expect(shown(299 - 20)).toBe(6);
  });
  it('what changed shows each sentence\'s reading and its figures, 40 frames apart', () => {
    const w = words('changed', 250);
    for (const t of ['WHAT CHANGED', 'Deaths per cell filled fell', '3.6 → 6.3 → 0.6', 'Trades per move rose', '0.5 → 1.2 → 6.8', 'Moves per cell filled rose', '12.5 → 56.7 → 85.3']) expect(w, t).toContain(t);
    const shown = (f: number) => end.changed.filter(c => words('changed', f).includes(c.split(': ')[0])).length;
    expect(shown(10)).toBe(0);
    expect(shown(30)).toBe(1);
    expect(shown(70)).toBe(2);
    expect(shown(150)).toBe(4);
  });
  it('the close names the top traders over all levels and carries the link; the other two carry none', () => {
    const w = words('close', 200);
    for (const t of ['TOP TRADERS · ALL LEVELS', 'vi0', '2,443,345 cr', 'bobalobascrob', 'Bet on the next move', 'telarchy.com/snake']) expect(w, t).toContain(t);
    expect(words('table', 250).some(t => /telarchy\.com/.test(t))).toBe(false);
    expect(words('changed', 250).some(t => /telarchy\.com/.test(t))).toBe(false);
  });
  it('the close stays still over its last 240 frames, for the end screen', () => {
    const a = drawSeriesEnd(end, 'close', 60).buffer, b = drawSeriesEnd(end, 'close', 299).buffer, c = drawSeriesEnd(end, 'close', 180).buffer;
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(true);
  });
  it('no two texts overlap, everything is inside the frame, and the big type shares one left margin', () => {
    for (const [screen, f] of [['table', 250], ['changed', 250], ['close', 200]] as const) {
      const ts = texts(screen, f);
      expect(overlaps(ts), screen).toBeNull();
      for (const t of ts) { expect(t.x, `${screen} ${t.text}`).toBeGreaterThanOrEqual(120); expect(t.x + t.w, `${screen} ${t.text}`).toBeLessThanOrEqual(1800); expect(t.y + t.h).toBeLessThanOrEqual(1040); }
    }
  });
  it('five levels still fit the table', () => {
    const many: SeriesEnd = { ...end, levels: [1, 2, 3, 4, 5].map(n => stats({ level: n, size: 2 + 2 * n, credits: 12_345_678 })) };
    const ts = drawSeriesEnd(many, 'table', 250).texts;
    expect(overlaps(ts)).toBeNull();
    for (const t of ts) expect(t.x + t.w).toBeLessThanOrEqual(1800);
  });
});
