// What every output frame of a level video shows, docs/level-video.md "Frames".
// Pure: the renderer draws only what this describes.
import type { LogStep } from './gamelog.js';
import { attempts } from './fun.js';
import { positionAt, type Segment } from './timeline.js';

const CHIP_F = 10, LOCK_F = 3, MOVE_F = 12;
const ZOOM_MAX = 1.08, ZOOM_EASE = 8, CARD_FRAMES = 60;

export interface FrameInfo {
  /** The timeline segment this frame belongs to, and its kind. */
  segment: number;
  kind: Segment['kind'];
  /** The entry shown: a fraction between two entries while the snake glides. */
  position: number;
  beat: { move: number; phase: 'chips' | 'lock' | 'move'; chip: number; progress: number } | null;
  zoom: number;
  badge: string | null;
  caption: string | null;
  lowerThird: { text: string; progress: number } | null;
  hold: { fx: 'hitstop' | 'filled'; progress: number } | null;
  credits: number | null;
  cold: boolean;
}

export const frameCountOf = (tl: Segment[]) => tl.reduce((a, s) => a + s.frames, 0);

const easeInOut = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
};

/** Where each segment starts, and when each record card starts, cached per timeline and level. */
const cache = new WeakMap<Segment[], WeakMap<LogStep[], { starts: number[]; cards: Array<{ start: number; text: string }> }>>();
function layout(tl: Segment[], entries: LogStep[]) {
  let byEntries = cache.get(tl);
  if (!byEntries) { byEntries = new WeakMap(); cache.set(tl, byEntries); }
  let got = byEntries.get(entries);
  if (got) return got;
  const starts: number[] = [];
  let at = 0;
  for (const s of tl) { starts.push(at); at += s.frames; }
  // the crash that ends each record attempt, and the attempt's number and length
  const records = attempts(entries, Number.MAX_SAFE_INTEGER).slice(0, -1)
    .map((a, i) => ({ a, n: i + 1 }))
    .filter(x => x.a.record)
    .map(x => ({ end: x.a.end, text: `RECORD ${x.a.reached} · attempt ${x.n}` }));
  const cards: Array<{ start: number; text: string }> = [];
  for (const r of records) {
    for (let k = 0; k < tl.length; k++) {
      const s = tl[k];
      if (s.kind === 'beat' && !s.cold && s.move === r.end) { cards.push({ start: starts[k] + s.frames - 1, text: r.text }); break; }
      if (s.kind === 'run' && s.from < r.end && s.to >= r.end) {
        let lo = 0, hi = s.frames;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (positionAt(s, mid) >= r.end) hi = mid; else lo = mid + 1; }
        cards.push({ start: starts[k] + lo, text: r.text });
        break;
      }
    }
  }
  cards.sort((x, y) => x.start - y.start);
  got = { starts, cards };
  byEntries.set(entries, got);
  return got;
}

function positionOf(s: Segment, lf: number, entries: LogStep[], tl: Segment[]): number {
  if (s.kind === 'run') return positionAt(s, lf);
  if (s.kind === 'beat') {
    const lockEnd = CHIP_F * s.chips + LOCK_F;
    if (lf < lockEnd) return s.move - 1;
    return s.move - 1 + Math.min(1, (lf - lockEnd + 1) / MOVE_F);
  }
  if (s.kind === 'hold') return s.entry;
  if (s.kind === 'loop') return tl.length ? positionOf(tl[0], 0, entries, tl) : 0;
  return entries.length - 1;
}

export function frameAt(tl: Segment[], entries: LogStep[], frame: number): FrameInfo {
  const { starts, cards } = layout(tl, entries);
  const total = frameCountOf(tl);
  const f = Math.max(0, Math.min(total - 1, Math.round(frame)));
  let k = 0;
  while (k + 1 < tl.length && starts[k + 1] <= f) k++;
  const s = tl[k];
  const lf = f - starts[k];

  let beat: FrameInfo['beat'] = null;
  let zoom = 1;
  if (s.kind === 'beat') {
    const chipsEnd = CHIP_F * s.chips, lockEnd = chipsEnd + LOCK_F;
    if (lf < chipsEnd) beat = { move: s.move, phase: 'chips', chip: Math.floor(lf / CHIP_F), progress: (lf % CHIP_F) / CHIP_F };
    else if (lf < lockEnd) beat = { move: s.move, phase: 'lock', chip: s.chips - 1, progress: (lf - chipsEnd) / LOCK_F };
    else beat = { move: s.move, phase: 'move', chip: s.chips - 1, progress: (lf - lockEnd) / MOVE_F };
    const up = easeInOut(lf / ZOOM_EASE), down = easeInOut((s.frames - 1 - lf) / ZOOM_EASE);
    zoom = 1 + (ZOOM_MAX - 1) * Math.min(up, down);
  }

  const card = [...cards].reverse().find(c => c.start <= f && f < c.start + CARD_FRAMES) ?? null;
  return {
    segment: k,
    kind: s.kind,
    position: positionOf(s, lf, entries, tl),
    beat,
    zoom,
    badge: s.kind === 'run' && s.speed > 4 ? `x${s.speed / 4}` : null,
    caption: s.kind === 'beat' ? s.caption ?? null : null,
    lowerThird: card ? { text: card.text, progress: (f - card.start) / CARD_FRAMES } : null,
    hold: s.kind === 'hold' ? { fx: s.fx, progress: lf / s.frames } : null,
    credits: s.kind === 'credits' ? lf / s.frames : null,
    cold: s.kind === 'beat' && s.cold === true,
  };
}
