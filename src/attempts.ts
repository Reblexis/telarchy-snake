// The attempts of a level and what happens on each move, docs/level-video.md "Moments":
// a level splits at every death, and a move eats, dies, fills or does none of these.
import type { LogStep } from './gamelog.js';

export type Fx = 'eat' | 'death' | 'fill';

/** One attempt: from the entry it starts on (the level's start or the respawn
 *  after a death) to the entry that ends it (the death, or the level's end). */
export interface Attempt { start: number; end: number; reached: number; record: boolean; fills: boolean }

export function attempts(entries: LogStep[], size: number): Attempt[] {
  const out: Attempt[] = [];
  let start = 0;
  let best = -Infinity;
  const close = (end: number, died: boolean) => {
    const lastAlive = died ? end - 1 : end;
    let reached = 0;
    for (let i = start; i <= lastAlive; i++) reached = Math.max(reached, entries[i].length);
    out.push({ start, end, reached, record: reached > best, fills: !died && entries[end].length >= size * size });
    best = Math.max(best, reached);
    start = end;
  };
  for (let i = 1; i < entries.length; i++) if (entries[i].deaths > entries[i - 1].deaths) close(i, true);
  if (start < entries.length - 1 || out.length === 0) close(entries.length - 1, false);
  return out;
}

/** A death is big when the attempt had reached at least this share of the grid (docs/level-video.md, "Big deaths"). */
export const BIG_DEATH_SHARE = 0.4;
/** The entries at which a big death lands, in order. */
export function bigDeaths(entries: LogStep[], size: number): number[] {
  return attempts(entries, size)
    .filter(a => a.end > 0 && entries[a.end].deaths > entries[a.end - 1].deaths && a.reached >= BIG_DEATH_SHARE * size * size)
    .map(a => a.end);
}

/** What happens on the move into entry `i`. */
export function fxOf(entries: LogStep[], i: number, size: number): Fx | null {
  if (i <= 0) return null;
  if (i === entries.length - 1 && entries[i].length >= size * size) return 'fill';
  if (entries[i].deaths > entries[i - 1].deaths) return 'death';
  if (entries[i].length > entries[i - 1].length) return 'eat';
  return null;
}
