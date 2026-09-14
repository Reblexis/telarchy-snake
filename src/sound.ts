// The sound plan of a level video, docs/level-video.md "Sound": every sound by frame,
// kind, variant, gain relative to the music, and how far the music ducks under it.
import type { LogStep } from './gamelog.js';
import { attempts, fxOf } from './attempts.js';
import { BEAT, positionAt, type Segment } from './timeline.js';

export type SoundKind = 'coin' | 'eat' | 'crash' | 'fill' | 'record';
export interface SoundEvent { frame: number; kind: SoundKind; variant: number; gainDb: number; duckDb: number }

const VARIANTS = 4;
/** At or under this speed (moves a second) a run plays its per-event sounds. */
const SOUNDING_SPEED = 8;
const LEVEL: Record<SoundKind, { gainDb: number; duckDb: number }> = {
  coin: { gainDb: -6, duckDb: 0 },
  eat: { gainDb: -7, duckDb: 0 },
  crash: { gainDb: 3, duckDb: 4 },
  record: { gainDb: 2, duckDb: 3 },
  fill: { gainDb: 5, duckDb: 5 },
};

/** A small deterministic hash, so the same timeline always sounds the same. */
const hash = (n: number) => {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
};

export function soundPlan(tl: Segment[], entries: LogStep[], size: number): SoundEvent[] {
  const raw: Array<{ frame: number; kind: SoundKind }> = [];
  const recordEnds = new Set(attempts(entries, size).slice(0, -1).filter(a => a.record).map(a => a.end));
  const eventsOfMove = (move: number, frame: number) => {
    const fx = fxOf(entries, move, size);
    if (fx === 'eat') raw.push({ frame, kind: 'eat' });
    if (fx === 'death') raw.push({ frame, kind: 'crash' });
    if (fx === 'fill') raw.push({ frame, kind: 'fill' });
    if (fx === 'death' && recordEnds.has(move)) raw.push({ frame, kind: 'record' });
  };
  let start = 0;
  for (const s of tl) {
    if (s.kind === 'beat') {
      for (let k = 0; k < s.chips; k++) raw.push({ frame: start + BEAT.chip * (s.slow ? 2 : 1) * k, kind: 'coin' });
      // the move lands on the beat's last frame
      if (!s.cold) eventsOfMove(s.move, start + s.frames - 1);
    } else if (s.kind === 'run' && s.speed <= SOUNDING_SPEED) {
      let reached = s.from;
      for (let lf = 1; lf <= s.frames; lf++) {
        const p = Math.floor(positionAt(s, lf) + 1e-9);
        while (reached < p) { reached++; eventsOfMove(reached, start + lf); }
      }
    }
    start += s.frames;
  }
  raw.sort((a, b) => a.frame - b.frame);
  const previous: Partial<Record<SoundKind, number>> = {};
  return raw.map(e => {
    const before = previous[e.kind];
    // a variant never repeats the previous sound of its kind
    const variant = before === undefined ? hash(e.frame) % VARIANTS : (before + 1 + (hash(e.frame) % (VARIANTS - 1))) % VARIANTS;
    previous[e.kind] = variant;
    return { frame: e.frame, kind: e.kind, variant, ...LEVEL[e.kind] };
  });
}
