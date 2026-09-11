// The decision rule, docs/snake.md "The step".
import type { Direction } from './engine.js';

/** The three actions, relative to the heading; the order is the tie order and forward is the default. */
export type Action = 'forward' | 'left' | 'right';
export const ACTIONS: Action[] = ['forward', 'left', 'right'];
export const ACTION_TITLE: Record<Action, string> = { forward: 'Continue forward', left: 'Turn left', right: 'Turn right' };
export const TITLE_ACTION: Record<string, Action> = { 'Continue forward': 'forward', 'Turn left': 'left', 'Turn right': 'right' };

/** docs/snake.md "The step": `Game G, move N: Turn left`, the game and the
 *  step the proposal decides, then the action after the colon. */
export function proposalTitle(action: Action, gameNumber: number, step: number): string {
  return `Game ${gameNumber}, move ${step}: ${ACTION_TITLE[action]}`;
}
/** The action a proposal title names: the part after the last colon, or the
 *  whole title when it is bare; null when it is none of the three. */
export function actionOfTitle(title: string): Action | null {
  const i = title.lastIndexOf(':');
  const tail = (i >= 0 ? title.slice(i + 1) : title).trim();
  return TITLE_ACTION[tail] ?? null;
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
  approved: number | null;
  declined: number | null;
  /** The pair's market ids, when known, so a bot can trade from /state. */
  approvedMarketId?: string;
  declinedMarketId?: string;
}
/** The one horizon: the record (max length achieved this game) in 60 moves. */
export type Horizon = 'm60';
export const HORIZONS: Horizon[] = ['m60'];
export type DirectionQuotes = Record<Horizon, Quote>;
export type Quotes = Record<Action, DirectionQuotes>;

const nullQuote = (): Quote => ({ approved: null, declined: null });
export const emptyDirectionQuotes = (): DirectionQuotes => ({ m60: nullQuote() });
export const emptyQuotes = (): Quotes => ({ forward: emptyDirectionQuotes(), left: emptyDirectionQuotes(), right: emptyDirectionQuotes() });

/** The predicted impact of a move on the 60-move horizon: approved minus
 *  declined, or null when either side has no price. */
export function impact60(q: DirectionQuotes | undefined): number | null {
  const m = q?.m60;
  if (!m) return null;
  const a = m.approved, d = m.declined;
  if (a === null || a === undefined || d === null || d === undefined) return null;
  if (!Number.isFinite(a) || !Number.isFinite(d)) return null;
  return a - d;
}

export interface Decision {
  approved: Action | null;
  declined: Action[];
  /** The compass direction the snake moves: the approved action from the heading, or straight on. */
  direction: Direction;
  undecided: boolean;
}

export function decide(quotes: Quotes, heading: Direction): Decision {
  let best: Action | null = null;
  let bestPrice = -Infinity;
  // Forward first, then left, then right: an exact tie continues forward.
  for (const a of ACTIONS) {
    const p = impact60(quotes[a]);
    if (p === null) continue;
    if (p > bestPrice) { best = a; bestPrice = p; }
  }
  if (best === null) {
    return { approved: null, declined: [...ACTIONS], direction: heading, undecided: true };
  }
  return { approved: best, declined: ACTIONS.filter(a => a !== best), direction: turn(heading, best), undecided: false };
}
