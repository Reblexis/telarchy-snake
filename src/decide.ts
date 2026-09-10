// The decision rule, docs/snake.md "The step".
import type { Direction } from './engine.js';

export const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];

export interface Quote { approved: number | null; declined: number | null }
export type Quotes = Record<Direction, Quote>;

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
    const p = quotes[d]?.approved;
    if (p === null || p === undefined || !Number.isFinite(p)) continue;
    if (p > bestPrice) { best = d; bestPrice = p; }
  }
  if (best === null) {
    return { approved: null, declined: [...DIRECTIONS], direction: heading, undecided: true };
  }
  return { approved: best, declined: DIRECTIONS.filter(d => d !== best), direction: best, undecided: false };
}
