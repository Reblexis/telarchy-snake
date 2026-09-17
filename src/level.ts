// The level videos, docs/snake.md "The level videos": one video per complete
// game, every frame the stream frame drawn from the game's record and the
// public actions log instead of /state. Everything here is pure except
// readLevel, which only makes public reads.
import type { GameEntry, LogStep } from './gamelog.js';
import { ACTIONS, directionsFrom, type Action } from './decide.js';
import { NEXT_LABEL, span } from './frame.js';

/** The workspace the actions log is read for. */
export const WORKSPACE_SLUG = 'snake';

/** One trade row of Telarchy's public actions log (docs/data-room.md). */
export interface TradeRow {
  id: string;
  at: string;
  kind: string;
  actor: { id: string; handle: string } | null;
  detail: { side: 'buy' | 'sell'; direction: 'higher' | 'lower'; shares: number; cost: number; callBefore: number; callAfter: number; marketId: string; [k: string]: unknown };
  /** The row's link on telarchy.com; it carries the trade's proposal. */
  href?: string;
  /** The way the trade was bet, when its proposal said so (nameTradesByProposal). */
  option?: Action | null;
}

/** One row of the video's panel, already worded. */

/** A level video shows a whole complete level or does not exist. */
export function refuseUnlessWhole(g: GameEntry): void {
  if (!g.endedAt) throw new Error(`game ${g.number} is not complete`);
  if (g.partial) throw new Error(`game ${g.number} is partial: its log began mid-game, so its earlier moves are not recorded`);
}

const ms = (iso: string) => Date.parse(iso);
const newestFirst = (a: TradeRow, b: TradeRow) => ms(b.at) - ms(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The trades of each entry's following move: after the entry's `at`, at or
 *  before the next entry's, newest first. The last entry has none. */
export function tradesByMove(entries: LogStep[], trades: TradeRow[]): TradeRow[][] {
  const out: TradeRow[][] = entries.map(() => []);
  const times = entries.map(e => ms(e.at));
  for (const t of trades) {
    const when = ms(t.at);
    if (!Number.isFinite(when)) continue;
    // the first entry at or after the trade ends its move
    let lo = 1, hi = times.length - 1, end = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] >= when) { end = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (end > 0 && when > times[end - 1]) out[end - 1].push(t);
  }
  for (const list of out) list.sort(newestFirst);
  return out;
}

const tenths = (v: number) => Math.round(v * 10) / 10;

/** The option a book belongs to, named only when its last call on the move
 *  equals (to one decimal) exactly one option's recorded price. */
export function optionOfBook(bookTrades: TradeRow[], prices: Record<Action, number | null>): Action | null {
  if (bookTrades.length === 0) return null;
  const last = [...bookTrades].sort(newestFirst)[0];
  const call = Number(last.detail?.callAfter);
  if (!Number.isFinite(call)) return null;
  const matches = ACTIONS.filter(a => {
    const p = prices?.[a];
    return p !== null && p !== undefined && Number.isFinite(p) && tenths(p) === tenths(call);
  });
  return matches.length === 1 ? matches[0] : null;
}

function age(fromIso: string, toIso: string): string {
  const secs = Math.max(0, Math.round((ms(toIso) - ms(fromIso)) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

/** The panel of one move: its trades newest first, at most five, aged from
 *  the entry that ended the move (`next`). */
/** Each book's option among a move's trades, named only when unambiguous. */
function optionsByBook(trades: TradeRow[], next: LogStep): Map<string, Action | null> {
  const books = new Map<string, TradeRow[]>();
  for (const t of trades) {
    const id = String(t.detail?.marketId ?? '');
    books.set(id, [...(books.get(id) ?? []), t]);
  }
  const option = new Map<string, Action | null>();
  for (const [id, list] of books) option.set(id, id ? optionOfBook(list, next.prices) : null);
  return option;
}

/** A move's trades for its bet beat (docs/snake.md, "The fun cuts"), oldest first. */
export interface BetRow { handle: string; option: Action | null; credits: number; from: number; to: number; at: string }

export function betRows(trades: TradeRow[], next: LogStep): BetRow[] {
  const option = optionsByBook(trades, next);
  return [...trades].sort((a, b) => newestFirst(b, a)).map(t => ({
    handle: t.actor?.handle ?? '?',
    // the proposal's word comes before the price match
    option: t.option ?? option.get(String(t.detail?.marketId ?? '')) ?? null,
    credits: Math.abs(Number(t.detail?.cost) || 0),
    from: Number(t.detail?.callBefore),
    to: Number(t.detail?.callAfter),
    at: t.at,
  }));
}

// ---------------------------------------------------------------------------------------------
// which way a trade was bet, docs/snake.md "Which way a trade was bet, and the prices the feed did not record"

/** What the video needs of GET /api/proposals/:id. */
export interface ProposalRead { title?: string; options?: unknown; conditionalMarketIds?: string[]; markets?: Array<{ options?: Array<{ id?: string; marketId?: string }> | null }> }

export function proposalIdOf(t: Pick<TradeRow, 'href'>): string | null {
  return /[#&?]proposal=([0-9a-zA-Z-]+)/.exec(String(t?.href ?? ''))?.[1] ?? null;
}

const ENDINGS: Array<[RegExp, Action]> = [[/Continue forward\s*$/, 'forward'], [/Turn left\s*$/, 'left'], [/Turn right\s*$/, 'right']];
/** The option a book belongs to, by its proposal: the option listed with that market id, or, for an older
 *  one-option proposal, the way its title names, on its approved book alone. */
export function optionFromProposal(p: ProposalRead | null | undefined, marketId: string): Action | null {
  if (!p || !marketId) return null;
  for (const m of p.markets ?? []) for (const o of m.options ?? []) {
    if (o.marketId === marketId) return (ACTIONS as readonly string[]).includes(String(o.id)) ? (o.id as Action) : null;
  }
  if (p.options) return null;
  if (p.conditionalMarketIds?.[0] !== marketId) return null;
  return ENDINGS.find(([re]) => re.test(String(p.title ?? '')))?.[1] ?? null;
}

/** The trades with `option` set wherever their proposal names it. Each proposal is read once (the cache is
 *  filled as it goes); a read that fails leaves its trades as they were. */
export async function nameTradesByProposal(trades: TradeRow[], read: (id: string) => Promise<ProposalRead>, cache: Map<string, ProposalRead | null>, concurrency = 8): Promise<TradeRow[]> {
  const wanted = [...new Set(trades.map(proposalIdOf).filter((id): id is string => !!id && !cache.has(id)))];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, wanted.length) }, async () => {
    while (next < wanted.length) {
      const id = wanted[next++];
      try { cache.set(id, await read(id)); } catch { /* unreadable: its trades stay unnamed */ }
    }
  }));
  return trades.map(t => {
    const id = proposalIdOf(t);
    const option = id ? optionFromProposal(cache.get(id), String(t.detail?.marketId ?? '')) : null;
    return option ? { ...t, option } : t;
  });
}

/** Entries with the prices the feed did not record filled from the named trades of their move: the last
 *  call on the option. A recorded price is never replaced. `byMove[i]` holds the trades of the move into entry i + 1. */
export function fillPricesFromTrades(entries: LogStep[], byMove: TradeRow[][]): LogStep[] {
  return entries.map((e, i) => {
    if (i === 0) return e;
    const missing = ACTIONS.filter(a => typeof e.prices?.[a] !== 'number');
    if (missing.length === 0) return e;
    const prices = { ...e.prices };
    // newest first within a move, so the first named trade seen is the last call
    for (const a of missing) {
      const last = (byMove[i - 1] ?? []).find(t => t.option === a && Number.isFinite(Number(t.detail?.callAfter)));
      if (last) prices[a] = Number(last.detail.callAfter);
    }
    return { ...e, prices };
  });
}

const levelSpan = (g: GameEntry) => span(ms(g.endedAt ?? g.startedAt) - ms(g.startedAt));
const tradesIn = (entries: LogStep[], trades: TradeRow[]) => tradesByMove(entries, trades).flat();

/** The sidecar JSON uploaded with the video: its title, description and facts. */
export function sidecar(game: GameEntry, entries: LogStep[], trades: TradeRow[]) {
  const inLevel = tradesIn(entries, trades);
  const moves = entries.length - 1;
  const deaths = entries[entries.length - 1]?.deaths ?? 0;
  const traders = new Set(inLevel.map(t => t.actor?.handle).filter(Boolean)).size;
  const s = game.size;
  return {
    game: game.number,
    size: s,
    title: `Futarchy snake, level ${game.number} (${s}x${s}): a market chose every move`,
    description: [
      'A prediction market played this game of snake. Every minute three options (continue, turn left, turn right) were priced by traders on telarchy.com, and the highest price was the move.',
      `Level ${game.number} on a ${s}x${s} grid: ${moves} moves over ${levelSpan(game)}, ${deaths} deaths, ${inLevel.length} trades by ${traders} traders.`,
      'Trade the next move: https://telarchy.com/snake',
      'Watch it live: https://www.twitch.tv/telarchy',
    ].join('\n'),
    moves,
    deaths,
    trades: inLevel.length,
    traders,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
  };
}

export interface ReadOptions {
  feedUrl: string;
  telarchyUrl: string;
  fetchFn?: (url: string) => Promise<Response>;
  /** /history window per read; the feed caps it at 2000. */
  pageSize?: number;
}

/** Reads one level from public reads only: the feed's /games and /history,
 *  and the actions log's trades over the game's span. Any failed read fails. */
export async function readLevel(n: number, opts: ReadOptions) {
  const fetchFn = opts.fetchFn ?? ((u: string) => fetch(u));
  const pageSize = opts.pageSize ?? 2000;
  const feed = opts.feedUrl.replace(/\/+$/, '');
  const telarchy = opts.telarchyUrl.replace(/\/+$/, '');
  const get = async (url: string): Promise<any> => {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return r.json();
  };

  const games: GameEntry[] = (await get(`${feed}/games`)).games ?? [];
  const game = games.find(g => g.number === n);
  if (!game) throw new Error(`no game ${n} in the record`);
  refuseUnlessWhole(game);

  const entries: LogStep[] = [];
  for (;;) {
    const page = await get(`${feed}/history?game=${n}&from=${entries.length}&limit=${pageSize}`);
    const steps: LogStep[] = page.steps ?? [];
    entries.push(...steps);
    if (steps.length === 0 || entries.length >= Number(page.total)) break;
  }
  if (entries.length === 0) throw new Error(`game ${n} has no recorded entries`);

  const trades: TradeRow[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ workspace: WORKSPACE_SLUG, kinds: 'trade', after: game.startedAt, before: game.endedAt!, limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const page = await get(`${telarchy}/api/data-room/actions?${q}`);
    trades.push(...((page.rows ?? []) as TradeRow[]).filter(r => r.kind === 'trade'));
    cursor = page.next ?? null;
  } while (cursor);

  return { game, games, entries, trades };
}
