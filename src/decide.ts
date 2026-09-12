// The decision rule, docs/snake.md "The step".
import type { Direction } from './engine.js';

/** The three actions, relative to the heading; the order is the option order on the proposal and forward is the default. */
export type Action = 'forward' | 'left' | 'right';
export const ACTIONS: Action[] = ['forward', 'left', 'right'];
/** The option label a trader reads on the proposal (Telarchy: at most 40 characters). */
export const OPTION_LABEL: Record<Action, string> = { forward: 'Continue forward', left: 'Turn left', right: 'Turn right' };
/** The same words, where the code still calls them titles. */
export const ACTION_TITLE = OPTION_LABEL;

/** One option of the step's proposal, as Telarchy takes it: the action is the id. */
export interface ProposalOption { id: Action; label: string }
/** docs/snake.md "The step": the three options in their fixed order, ids forward, left, right. */
export function proposalOptions(): ProposalOption[] {
  return ACTIONS.map(a => ({ id: a, label: OPTION_LABEL[a] }));
}

/** docs/snake.md "The step": `Game G, attempt A, move N`, the game, the
 *  attempt (deaths plus one) and the move within it that the proposal
 *  decides. No action: the actions are the proposal's options. */
export function proposalTitle(gameNumber: number, attempt: number, move: number): string {
  return `Game ${gameNumber}, attempt ${attempt}, move ${move}`;
}

const COMPASS: Direction[] = ['up', 'right', 'down', 'left'];
/** The compass direction an action takes from a heading. */
export function turn(heading: Direction, action: Action): Direction {
  const i = COMPASS.indexOf(heading);
  if (action === 'forward') return heading;
  return COMPASS[(i + (action === 'right' ? 1 : 3)) % 4];
}
export function directionsFrom(heading: Direction): Record<Action, Direction> {
  return { forward: turn(heading, 'forward'), left: turn(heading, 'left'), right: turn(heading, 'right') };
}

export interface Quote {
  /** The option book's consensus: the length the market expects if the snake takes this option. */
  price: number | null;
  /** Telarchy's delta for the option: its price minus the best other option's, positive for the leader. */
  lead: number | null;
  /** The option's market id, when known, so a bot can trade from /state. */
  marketId?: string;
  /** Why the price is missing (docs/snake.md "The step", `undecidedReason`):
   *  no book on the cell, no options on the row, no consensus, no answer, or
   *  the error. Absent on a priced option. */
  reason?: string;
}
/** The one horizon: the attempt's cell, an hour after it starts (docs/snake.md, "The workspace"). */
export type Horizon = 'm60';
export const HORIZONS: Horizon[] = ['m60'];
export type DirectionQuotes = Record<Horizon, Quote>;
export type Quotes = Record<Action, DirectionQuotes>;

/** Before the first poll of a step: no price yet, and the quote says so, which
 *  is what tells a bot "not read yet" from "this option has no book"
 *  (docs/snake.md, "What a bot trades on is never dropped"). */
const nullQuote = (): Quote => ({ price: null, lead: null, reason: 'not polled yet' });

/** A fresh read laid over the last one: an option whose price could not be read
 *  keeps the market id that was already published, so the one field a bot needs
 *  to trade is never dropped once known (docs/snake.md, "The feed"). */
export function mergeQuotes(prev: Quotes | null | undefined, fresh: Quotes): Quotes {
  if (!prev) return fresh;
  const out = {} as Quotes;
  for (const a of ACTIONS) {
    const before = prev[a]?.m60;
    const now = fresh[a]?.m60 ?? nullQuote();
    out[a] = { m60: { ...now, marketId: now.marketId ?? before?.marketId } };
  }
  return out;
}
export const emptyDirectionQuotes = (): DirectionQuotes => ({ m60: nullQuote() });
export const emptyQuotes = (): Quotes => ({ forward: emptyDirectionQuotes(), left: emptyDirectionQuotes(), right: emptyDirectionQuotes() });

/** The option's price on the 60-move horizon, or null when it has none. */
export function priceOf(q: DirectionQuotes | undefined): number | null {
  const p = q?.m60?.price;
  if (p === null || p === undefined) return null;
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  return p;
}
/** Every option's price, as the record keeps it. */
export function pricesOf(quotes: Quotes | null | undefined): Record<Action, number | null> {
  return { forward: priceOf(quotes?.forward), left: priceOf(quotes?.left), right: priceOf(quotes?.right) };
}

/** Two prices within this of each other are a tie (docs/snake.md, "The step"). */
const TIE = 1e-9;

export interface Decision {
  /** The chosen option, or null when the step is undecided. */
  approved: Action | null;
  /** The compass direction the snake moves: the chosen action from the heading, or straight on. */
  direction: Direction;
  undecided: boolean;
}

/** docs/snake.md "The step": the option with the highest price is chosen;
 *  ties go to the current heading (forward), then to the option whose
 *  direction comes first in up, right, down, left; no price at all is
 *  undecided and the snake continues forward. */
export function decide(quotes: Quotes, heading: Direction): Decision {
  let bestPrice = -Infinity;
  for (const a of ACTIONS) {
    const p = priceOf(quotes[a]);
    if (p !== null && p > bestPrice) bestPrice = p;
  }
  if (bestPrice === -Infinity) return { approved: null, direction: heading, undecided: true };
  const tied = ACTIONS.filter(a => { const p = priceOf(quotes[a]); return p !== null && bestPrice - p <= TIE; });
  let best: Action;
  if (tied.includes('forward')) best = 'forward';
  else best = tied.sort((x, y) => COMPASS.indexOf(turn(heading, x)) - COMPASS.indexOf(turn(heading, y)))[0];
  return { approved: best, direction: turn(heading, best), undecided: false };
}
