import { describe, it, expect } from 'vitest';
import {
  refuseUnlessWhole, tradesByMove, optionOfBook, sidecar, readLevel, betRows,
  proposalIdOf, optionFromProposal, nameTradesByProposal, fillPricesFromTrades,
  type TradeRow,
} from '../src/level.js';
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

describe('the sidecar', () => {
  const entries = [entry(0), entry(1), entry(2, { deaths: 1 }), entry(3, { deaths: 1 }), entry(4, { deaths: 1 })];
  const trades = [trade('a', at(0, 30), { handle: 'ann' }), trade('b', at(1, 30), { handle: 'bob' }), trade('c', at(2, 30), { handle: 'ann' })];
  const s = () => sidecar(game, entries, trades);
  it('counts moves, deaths, trades and distinct traders', () => {
    expect(s()).toMatchObject({ game: 2, size: 4, moves: 4, deaths: 1, trades: 3, traders: 2, startedAt: game.startedAt, endedAt: game.endedAt });
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

describe('which way a trade was bet, from its proposal', () => {
  const withOptions = { title: 'Game 3, attempt 40, move 4', options: [{ id: 'forward' }], conditionalMarketIds: ['a', 'b', 'c'], markets: [{ options: [{ id: 'forward', marketId: 'a' }, { id: 'left', marketId: 'b' }, { id: 'right', marketId: 'c' }] }] };
  const single = (ending: string) => ({ title: `Game 1, attempt 5, move 7: ${ending}`, options: null, conditionalMarketIds: ['yes', 'no'], markets: [] });
  it('a trade row links its proposal', () => {
    expect(proposalIdOf({ href: '/snake#proposal=ba1ef62f-ce5e-414a-806a-8dfe6f0fecc9&trade=4875' } as any)).toBe('ba1ef62f-ce5e-414a-806a-8dfe6f0fecc9');
    expect(proposalIdOf({ href: '/snake' } as any)).toBeNull();
    expect(proposalIdOf({} as any)).toBeNull();
  });
  it('a proposal with options names the book by its market id', () => {
    expect(optionFromProposal(withOptions, 'b')).toBe('left');
    expect(optionFromProposal(withOptions, 'c')).toBe('right');
    expect(optionFromProposal(withOptions, 'zzz')).toBeNull();
  });
  it('an older proposal is one option, named by its title; only its approved book is a bet on that way', () => {
    expect(optionFromProposal(single('Turn left'), 'yes')).toBe('left');
    expect(optionFromProposal(single('Continue forward'), 'yes')).toBe('forward');
    expect(optionFromProposal(single('Turn right'), 'yes')).toBe('right');
    expect(optionFromProposal(single('Turn left'), 'no')).toBeNull();
    expect(optionFromProposal(single('Something else'), 'yes')).toBeNull();
    expect(optionFromProposal(null, 'yes')).toBeNull();
  });
  const linked = (id: string, when: string, proposal: string, marketId: string, callAfter = 9) => ({ ...trade(id, when, { marketId, callAfter }), href: `/snake#proposal=${proposal}&trade=${id}` });
  it('each proposal is read once, a failed read leaves its trades unnamed and fails nothing', async () => {
    const trades = [linked('1', at(0, 10), 'p-left', 'yes'), linked('2', at(0, 20), 'p-left', 'yes'), linked('3', at(0, 30), 'p-gone', 'yes'), trade('4', at(0, 40))];
    const reads: string[] = [];
    const named = await nameTradesByProposal(trades, async id => { reads.push(id); if (id === 'p-gone') throw new Error('404'); return single('Turn left'); }, new Map());
    expect(reads.sort()).toEqual(['p-gone', 'p-left']);
    expect(named.map(t => t.option)).toEqual(['left', 'left', undefined, undefined]);
  });
  it('a proposal already in the cache is not read again', async () => {
    const cache = new Map<string, any>([['p-left', single('Turn left')]]);
    const named = await nameTradesByProposal([linked('1', at(0, 10), 'p-left', 'yes')], async () => { throw new Error('must not read'); }, cache);
    expect(named[0].option).toBe('left');
  });
  it('the proposal comes before the price match: a trade it names keeps that name whatever the prices say', () => {
    const entries = [entry(0), entry(1)];
    const t = { ...trade('1', at(0, 10), { marketId: 'm1', callAfter: 4 }), option: 'left' as const };
    // the price match alone would say right (4); the proposal said left
    expect(betRows([t], entries[1])[0].option).toBe('left');
    expect(betRows([trade('1', at(0, 10), { marketId: 'm1', callAfter: 4 })], entries[1])[0].option).toBe('right');
  });
});

describe('the prices the feed did not record', () => {
  const blank = { forward: null, left: null, right: null };
  it('an option with named trades takes the last of their calls; an option nobody traded stays without a price', () => {
    const entries = [entry(0), entry(1, { prices: { ...blank } }), entry(2)];
    const t1 = { ...trade('1', at(0, 10), { marketId: 'a', callAfter: 3 }), option: 'left' as const };
    const t2 = { ...trade('2', at(0, 40), { marketId: 'a', callAfter: 4 }), option: 'left' as const };
    const filled = fillPricesFromTrades(entries, tradesByMove(entries, [t1, t2]));
    expect(filled[1].prices).toEqual({ forward: null, left: 4, right: null });
    expect(entries[1].prices).toEqual(blank);
  });
  it('a recorded price is never replaced', () => {
    const entries = [entry(0), entry(1)];
    const t = { ...trade('1', at(0, 10), { marketId: 'a', callAfter: 9 }), option: 'left' as const };
    expect(fillPricesFromTrades(entries, tradesByMove(entries, [t]))[1].prices.left).toBe(3);
  });
  it('an unnamed trade fills nothing', () => {
    const entries = [entry(0), entry(1, { prices: { ...blank } })];
    expect(fillPricesFromTrades(entries, tradesByMove(entries, [trade('1', at(0, 10))]))[1].prices).toEqual(blank);
  });
});
