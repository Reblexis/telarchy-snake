// The decision rule, docs/snake.md "The step".
import type { Direction } from './engine.js';

export const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];

export interface Quote { approved: number | null; declined: number | null }
/** The three horizons: length in 1, 5 and 60 moves. */
export type Horizon = 'm1' | 'm5' | 'm60';
export const HORIZONS: Horizon[] = ['m1', 'm5', 'm60'];
export type DirectionQuotes = Record<Horizon, Quote>;
export type Quotes = Record<Direction, DirectionQuotes>;

const nullQuote = (): Quote => ({ approved: null, declined: null });
export const emptyDirectionQuotes = (): DirectionQuotes => ({ m1: nullQuote(), m5: nullQuote(), m60: nullQuote() });
export const emptyQuotes = (): Quotes => ({ up: emptyDirectionQuotes(), right: emptyDirectionQuotes(), down: emptyDirectionQuotes(), left: emptyDirectionQuotes() });

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
  approved: Direction | null;
  declined: Direction[];
  /** The direction the snake moves: the approved one, or the heading. */
  direction: Direction;
  undecided: boolean;
}

export function decide(quotes: Quotes, heading: Direction): Decision {
  let best: Direction | null = null;
  let bestPrice = -Infinity;
  // Heading first so an exact tie keeps the course; then the published order.
  const order = [heading, ...DIRECTIONS.filter(d => d !== heading)];
  for (const d of order) {
    const p = impact60(quotes[d]);
    if (p === null) continue;
    if (p > bestPrice) { best = d; bestPrice = p; }
  }
  if (best === null) {
    return { approved: null, declined: [...DIRECTIONS], direction: heading, undecided: true };
  }
  return { approved: best, declined: DIRECTIONS.filter(d => d !== best), direction: best, undecided: false };
}
