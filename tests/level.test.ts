import { describe, it, expect } from 'vitest';
import {
  refuseUnlessWhole, tradesByMove, optionOfBook, panelRows, videoState, holds, sidecar, readLevel, FPS,
  type TradeRow,
} from '../src/level.js';
import { drawnTexts, renderFrame, pillRects, WIDTH, LAYOUT } from '../src/frame.js';
import type { GameEntry, LogStep } from '../src/gamelog.js';

// docs/snake.md, "The level videos".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (min: number, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000).toISOString();

function entry(i: number, over: Partial<LogStep> = {}): LogStep {
  return {
    step: i, at: at(i), snake: [{ x: 2, y: 1 }, { x: 1, y: 1 }], food: { x: 3, y: 3 }, heading: 'right',
    action: i === 0 ? null : 'forward', direction: 'right', undecided: false,
    prices: i === 0 ? { forward: null, left: null, right: null } : { forward: 2, left: 3, right: 4 },
    length: 2, deaths: 0, ...over,
  };
}

const game: GameEntry = { number: 2, size: 4, startedAt: at(0), endedAt: at(4), steps: 4, bestLength: 16, deaths: 1 };
const earlier: GameEntry = { number: 1, size: 4, startedAt: at(-300), endedAt: at(-100), steps: 200, bestLength: 16, deaths: 58 };

function trade(id: string, when: string, over: Partial<{ handle: string; side: 'buy' | 'sell'; direction: 'higher' | 'lower'; cost: number; callAfter: number; marketId: string }> = {}): TradeRow {
  const o = { handle: 'vi0', side: 'buy' as const, direction: 'higher' as const, cost: 10, callAfter: 3, marketId: 'm1', ...over };
  return {
    id: `trade:${id}`, at: when, kind: 'trade', actor: { id: o.handle, handle: o.handle },
    detail: { side: o.side, direction: o.direction, shares: 1, cost: o.cost, callBefore: 2, callAfter: o.callAfter, marketId: o.marketId },
  };
}

describe('a level video shows a whole complete level or does not exist', () => {
  it('refuses a game that is not complete', () => {
    expect(() => refuseUnlessWhole({ ...game, endedAt: null })).toThrow(/not complete/);
  });
  it('refuses a game whose log is partial', () => {
    expect(() => refuseUnlessWhole({ ...game, partial: true })).toThrow(/partial/);
  });
  it('accepts a complete game recorded from its start', () => {
    expect(() => refuseUnlessWhole(game)).not.toThrow();
  });
});

describe('which trades belong to which move', () => {
  const entries = [entry(0), entry(1), entry(2)];
  it('a trade after an entry and at or before the next entry belongs to that entry', () => {
    const byMove = tradesByMove(entries, [trade('a', at(0, 30)), trade('b', at(1)), trade('c', at(1, 1))]);
    expect(byMove[0].map(t => t.id)).toEqual(['trade:b', 'trade:a']);
    expect(byMove[1].map(t => t.id)).toEqual(['trade:c']);
  });
  it('a trade exactly at an entry belongs to the move that entry ended, not the next one', () => {
    const byMove = tradesByMove(entries, [trade('edge', at(2))]);
    expect(byMove[1].map(t => t.id)).toEqual(['trade:edge']);
    expect(byMove[2]).toEqual([]);
  });
  it('drops trades before the first entry and after the last', () => {
    const byMove = tradesByMove(entries, [trade('before', at(-1)), trade('at-start', at(0)), trade('after', at(2, 1))]);
    expect(byMove.flat()).toEqual([]);
  });
  it('the last entry has no trades, since no move follows it', () => {
    expect(tradesByMove(entries, [])).toEqual([[], [], []]);
  });
  it('orders each move\'s trades newest first', () => {
    const byMove = tradesByMove(entries, [trade('old', at(0, 10)), trade('new', at(0, 50)), trade('mid', at(0, 30))]);
    expect(byMove[0].map(t => t.id)).toEqual(['trade:new', 'trade:mid', 'trade:old']);
  });
});

describe('an option is named on a trade only when the match is unambiguous', () => {
  const prices = { forward: 2, left: 3, right: 4 };
  it('names the option whose recorded price equals the book\'s last call, to one decimal', () => {
    expect(optionOfBook([trade('a', at(0, 20), { callAfter: 2.9 }), trade('b', at(0, 40), { callAfter: 3.04 })], prices)).toBe('left');
  });
  it('uses the book\'s last trade on the move, whatever order the rows come in', () => {
    expect(optionOfBook([trade('b', at(0, 40), { callAfter: 4 }), trade('a', at(0, 20), { callAfter: 3 })], prices)).toBe('right');
  });
  it('names nothing when two options share the matching price', () => {
    expect(optionOfBook([trade('a', at(0, 20), { callAfter: 2 })], { forward: 2, left: 2, right: 4 })).toBeNull();
  });
  it('names nothing when no option matches', () => {
    expect(optionOfBook([trade('a', at(0, 20), { callAfter: 7 })], prices)).toBeNull();
  });
  it('names nothing when the prices were not recorded', () => {
    expect(optionOfBook([trade('a', at(0, 20), { callAfter: 2 })], { forward: null, left: null, right: null })).toBeNull();
  });
  it('names nothing for a book with no trades', () => {
    expect(optionOfBook([], prices)).toBeNull();
  });
});

describe('the panel rows', () => {
  const next = entry(1, { prices: { forward: 2, left: 3, right: 4 } });
  it('at most five, newest first, aged from the next entry, the option named when unambiguous', () => {
    const trades = [
      trade('1', at(0, 55), { marketId: 'L', callAfter: 3, handle: 'ann' }),
      trade('2', at(0, 50), { marketId: 'X', callAfter: 9, side: 'sell', direction: 'lower', cost: -12.4, handle: 'bob' }),
      trade('3', at(0, 40)), trade('4', at(0, 30)), trade('5', at(0, 20)), trade('6', at(0, 10)),
    ];
    const rows = panelRows(trades, next);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ age: '5s', handle: 'ann', what: 'bought higher on Turn left at 3.0', cr: '10 cr' });
    expect(rows[1]).toEqual({ age: '10s', handle: 'bob', what: 'sold lower at 9.0', cr: '12 cr' });
    expect(rows[4].age).toBe('40s');
  });
  it('is empty for a move nobody traded', () => {
    expect(panelRows([], next)).toEqual([]);
  });
});

describe('every frame is the stream frame drawn from the record', () => {
  const entries = [
    entry(0),
    entry(1, { action: 'left', direction: 'up', heading: 'up', prices: { forward: 5, left: 1.25, right: 3 } }),
    entry(2, { action: 'forward', direction: 'up', heading: 'up', deaths: 1, length: 2 }),
    entry(3, { undecided: true, action: 'forward', direction: 'up', heading: 'up', deaths: 1, prices: { forward: null, left: null, right: null } }),
    entry(4, { snake: Array.from({ length: 16 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4) })), length: 16, deaths: 1 }),
  ];
  const trades = [trade('t', at(0, 30), { handle: 'ann', callAfter: 1.25, marketId: 'L' })];
  const ctx = () => ({ game, games: [earlier, game], entries, byMove: tradesByMove(entries, trades) });
  const texts = (i: number) => { const { state, now } = videoState(ctx(), i); return drawnTexts(state, now); };

  it('the pills carry the next move\'s recorded prices, one decimal', () => {
    const t = texts(0);
    expect(t).toEqual(expect.arrayContaining(['5.0', '1.3', '3.0']));
  });

  it('outlines the chosen option in green even when another option priced higher', () => {
    const { state, now } = videoState(ctx(), 0);
    const buf = renderFrame(state, now);
    const rects = pillRects(state);
    const green = (r: { x: number; y: number; w: number }) => {
      const i = (r.y * WIDTH + Math.floor(r.x + r.w / 2)) * 3;
      return buf[i + 1] > 150 && buf[i] < 150;
    };
    // order is forward, left, right; the market chose left at 1.25 while forward read 5
    expect(rects.map(green)).toEqual([false, true, false]);
  });

  it('an undecided move outlines no option and says undecided', () => {
    const { state, now } = videoState(ctx(), 2);
    const buf = renderFrame(state, now);
    const lit = pillRects(state).some(r => { const i = (r.y * WIDTH + Math.floor(r.x + r.w / 2)) * 3; return buf[i + 1] > 150 && buf[i] < 150; });
    expect(lit).toBe(false);
    expect(drawnTexts(state, now)).toContain('undecided');
  });

  it('a decided move reads decided and no countdown is drawn', () => {
    const t = texts(0);
    expect(t).toContain('decided');
    expect(t.some(s => /^\d:\d\d$/.test(s))).toBe(false); // the countdown is m:ss; the timers are mm:ss
  });

  it('the panel is one page of this move\'s trades: no dots label, no Top traders', () => {
    const t = texts(0);
    expect(t).toContain('TRADES ON THIS MOVE');
    expect(t).not.toContain('TOP TRADERS');
    expect(t).toContain('ann');
    expect(t.some(s => s.startsWith('bought higher on Turn left at 1.3'))).toBe(true);
    expect(t).toContain('30s');
  });

  it('a move nobody traded says so', () => {
    expect(texts(1)).toContain('No trades on this move');
  });

  it('the attempt and its time count from the attempt\'s first entry', () => {
    const t = texts(3);
    expect(t).toContain('NOW · ATTEMPT 2');
    expect(t).toContain('01:00'); // attempt began at entry 2, this is entry 3
  });

  it('the level line is the grid and the time since the game started, then earlier games', () => {
    const t = texts(3);
    expect(t).toContain('LEVEL 4X4');
    expect(t).toContain('03:00');
    expect(t).toContain('4x4 3h 20m');
  });

  it('the chevron points at the next move and the last entry draws none', () => {
    expect(videoState(ctx(), 0).state.next).toEqual({ direction: 'up', decided: true });
    expect(videoState(ctx(), 4).state.next).toBeNull();
  });

  it('the last frame draws no chevron or wall bar on the board, whatever the heading', () => {
    const accentOnBoard = (i: number) => {
      const { state, now } = videoState(ctx(), i);
      const buf = renderFrame(state, now);
      let n = 0;
      for (let y = 24; y < 696; y++) for (let x = 24; x < 696; x++) {
        const k = (y * WIDTH + x) * 3;
        if (buf[k] > 150 && buf[k + 1] > 80 && buf[k + 1] < 180 && buf[k + 2] < 60) n++;
      }
      return n;
    };
    expect(accentOnBoard(0)).toBeGreaterThan(0); // the guard: a chevron is found when one is drawn
    expect(accentOnBoard(4)).toBe(0);
  });

  it('the complete game\'s lines sit below the level line, never over it', () => {
    expect(LAYOUT.completeBaseline - 20).toBeGreaterThan(LAYOUT.levelBaseline);
    expect(LAYOUT.completeBaseline + 28 + 6).toBeLessThan(LAYOUT.panelLabelBaseline - 13);
  });

  it('the last frame is the full grid with the complete line and the level\'s facts', () => {
    const t = texts(4);
    expect(t).toContain('The snake filled the grid.');
    expect(t).toContain('4 moves · 1 deaths · 1 trades · 04:00');
    expect(t).toContain('telarchy.com/snake');
  });

  it('never draws a price the record does not hold', () => {
    const t = texts(2); // the next move (entry 3) recorded no prices
    // the only one-decimal number left is the entry's own length
    expect(t.filter(s => /^\d+\.\d$/.test(s))).toEqual(['2.0']);
  });
});

describe('the pace', () => {
  it('24 frames a second', () => {
    expect(FPS).toBe(24);
  });
  it('the first entry holds 3 s, a move a quarter second, a death a second, the last 5 s', () => {
    const entries = [entry(0), entry(1), entry(2, { deaths: 1 }), entry(3, { deaths: 1 }), entry(4, { deaths: 1 })];
    expect(holds(entries)).toEqual([72, 6, 24, 6, 120]);
  });
  it('a one-entry level still holds its only frame for the closing 5 s', () => {
    expect(holds([entry(0)])).toEqual([120]);
  });
});

describe('the sidecar', () => {
  const entries = [entry(0), entry(1), entry(2, { deaths: 1 }), entry(3, { deaths: 1 }), entry(4, { deaths: 1 })];
  const trades = [trade('a', at(0, 30), { handle: 'ann' }), trade('b', at(1, 30), { handle: 'bob' }), trade('c', at(2, 30), { handle: 'ann' })];
  const s = () => sidecar(game, entries, trades);
  it('counts moves, deaths, trades and distinct traders', () => {
    expect(s()).toMatchObject({ game: 2, size: 4, moves: 4, deaths: 1, trades: 3, traders: 2, startedAt: game.startedAt, endedAt: game.endedAt });
  });
  it('the video duration is the sum of the holds', () => {
    expect(s().durationSeconds).toBe((72 + 6 + 24 + 6 + 120) / 24);
  });
  it('the title and description are the doc\'s, filled in', () => {
    expect(s().title).toBe('Futarchy snake, level 2 (4x4): a market chose every move');
    expect(s().description).toBe([
      'A prediction market played this game of snake. Every minute three options (continue, turn left, turn right) were priced by traders on telarchy.com, and the highest price was the move.',
      'Level 2 on a 4x4 grid: 4 moves over 04:00, 1 deaths, 3 trades by 2 traders.',
      'Trade the next move: https://telarchy.com/snake',
      'Watch it live: https://www.twitch.tv/telarchy',
    ].join('\n'));
  });
});

describe('reading a level from public reads only', () => {
  it('pages /history from 0 until total and follows the actions log\'s next until null', async () => {
    const all = Array.from({ length: 5 }, (_, i) => entry(i));
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      let body: unknown;
      if (u.pathname === '/games') body = { games: [earlier, game] };
      else if (u.pathname === '/history') {
        const from = Number(u.searchParams.get('from'));
        body = { game, total: 5, from, steps: all.slice(from, from + 2) };
      } else if (u.pathname === '/api/data-room/actions') {
        body = u.searchParams.get('cursor')
          ? { rows: [trade('2', at(2, 5))], next: null }
          : { rows: [trade('1', at(0, 5))], next: 'c1' };
      } else throw new Error(`unexpected ${url}`);
      return { ok: true, status: 200, json: async () => body } as Response;
    };
    const level = await readLevel(2, { feedUrl: 'https://feed.test', telarchyUrl: 'https://t.test', fetchFn, pageSize: 2 });
    expect(level.entries.map(e => e.step)).toEqual([0, 1, 2, 3, 4]);
    expect(level.trades.map(t => t.id)).toEqual(['trade:1', 'trade:2']);
    expect(level.games).toHaveLength(2);
    const history = urls.filter(x => x.includes('/history'));
    expect(history).toHaveLength(3);
    const actions = urls.filter(x => x.includes('/actions')).map(x => new URL(x).searchParams);
    expect(actions[0].get('workspace')).toBe('snake');
    expect(actions[0].get('kinds')).toBe('trade');
    expect(actions[0].get('after')).toBe(game.startedAt);
    expect(actions[0].get('before')).toBe(game.endedAt);
    expect(actions[1].get('cursor')).toBe('c1');
    // no request carries a credential
    expect(urls.some(x => /key|token/i.test(x))).toBe(false);
  });

  it('refuses before reading history when the game is not whole', async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ games: [{ ...game, endedAt: null }] }) } as Response;
    };
    await expect(readLevel(2, { feedUrl: 'https://feed.test', telarchyUrl: 'https://t.test', fetchFn })).rejects.toThrow(/not complete/);
    expect(urls.every(u => u.includes('/games'))).toBe(true);
  });

  it('an unknown game is refused', async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ games: [game] }) } as Response);
    await expect(readLevel(9, { feedUrl: 'https://feed.test', telarchyUrl: 'https://t.test', fetchFn })).rejects.toThrow(/no game 9/);
  });

  it('a failed read fails the run instead of making a video with a hole in it', async () => {
    const fetchFn = async (url: string) => (url.includes('/games')
      ? { ok: true, status: 200, json: async () => ({ games: [game] }) }
      : { ok: false, status: 502, json: async () => ({}) }) as Response;
    await expect(readLevel(2, { feedUrl: 'https://feed.test', telarchyUrl: 'https://t.test', fetchFn })).rejects.toThrow(/502/);
  });
});
