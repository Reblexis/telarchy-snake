// The timeline of a level video, docs/level-video.md "The timeline": what every output
// frame shows at 30 frames a second. Pure: the renderer draws what this plans.
import type { LogStep } from './gamelog.js';
import type { TradeRow } from './level.js';
import type { Moment } from './moments.js';
import { attempts } from './fun.js';

export const TL_FPS = 30;
export const FULL_MAX = 5 * 60 * TL_FPS;
export const SHORT_MAX = 50 * TL_FPS;
export const CREDITS_FRAMES = 18 * TL_FPS;
export const SPEED_LADDER = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128] as const;
export const HOOK_CAPTION = 'A market picks every move.';
export const RULES_CAPTION = 'Traders bet. The highest price moves.';
const CHIP_F = 10, LOCK_F = 3, MOVE_F = 12, GAP_F = 90, EASE_F = 12, MIN_SPEED = 4;
const FINALE_BEATS = 8, SHORT_FILL_BY = 1200, SHORT_CRASH_MOVES = 6, SHORT_CRASH_SPEED = 16;

export type Segment =
  | { kind: 'beat'; move: number; chips: number; frames: number; cold?: boolean; caption?: string }
  | { kind: 'run'; from: number; to: number; speed: number; frames: number; easeIn: boolean; easeOut: boolean; crash?: boolean }
  | { kind: 'hold'; fx: 'hitstop' | 'filled'; entry: number; frames: number }
  | { kind: 'credits'; frames: number }
  | { kind: 'loop'; frames: number };
type Run = Extract<Segment, { kind: 'run' }>;

/** Chips a beat shows: the move's trades of at least one credit, three at most. */
export const chipsOf = (byMove: TradeRow[][], move: number) =>
  Math.min(3, (byMove[move - 1] ?? []).filter(r => Math.abs(Number(r.detail?.cost) || 0) >= 1).length);
export const beatFrames = (chips: number) => CHIP_F * chips + LOCK_F + MOVE_F;
const beat = (byMove: TradeRow[][], move: number, extra: Partial<Segment> = {}): Segment => {
  const chips = chipsOf(byMove, move);
  return { kind: 'beat', move, chips, frames: beatFrames(chips), ...extra } as Segment;
};

/** Distance covered by n ramp frames climbing from 4 moves a second toward `speed`. */
const rampDist = (n: number, v0: number, vb: number) => n * v0 + ((vb - v0) / EASE_F) * ((n * (n - 1)) / 2);

/** How many frames a run of D moves takes at `speed`, easing next to beats. */
export function runFrames(D: number, speed: number, easeIn: boolean, easeOut: boolean): number {
  if (D <= 0) return 0;
  const v0 = MIN_SPEED / TL_FPS, vb = speed / TL_FPS;
  const inLen = easeIn ? EASE_F : 0, outLen = easeOut ? EASE_F : 0;
  const ramps = rampDist(inLen, v0, vb) + rampDist(outLen, v0, vb);
  if (ramps >= D) return Math.max(1, Math.ceil(D / v0));
  return inLen + outLen + Math.ceil((D - ramps) / vb);
}

const cumulative = new WeakMap<object, number[]>();
/** The fractional entry a run shows after `f` of its frames: from its first entry to its last, never backward. */
export function positionAt(seg: Run, f: number): number {
  const D = seg.to - seg.from;
  if (D <= 0) return seg.from;
  let cum = cumulative.get(seg);
  if (!cum) {
    const v0 = MIN_SPEED / TL_FPS, vb = seg.speed / TL_FPS;
    const inLen = seg.easeIn ? EASE_F : 0, outLen = seg.easeOut ? EASE_F : 0;
    const adv: number[] = [];
    if (rampDist(inLen, v0, vb) + rampDist(outLen, v0, vb) >= D) {
      for (let k = 0; k < seg.frames; k++) adv.push(v0);
    } else {
      for (let k = 0; k < inLen; k++) adv.push(v0 + ((vb - v0) * k) / EASE_F);
      const middle = seg.frames - inLen - outLen;
      for (let k = 0; k < middle; k++) adv.push(vb);
      for (let k = outLen - 1; k >= 0; k--) adv.push(v0 + ((vb - v0) * k) / EASE_F);
    }
    cum = [0];
    for (const a of adv) cum.push(cum[cum.length - 1] + a);
    cumulative.set(seg, cum);
  }
  const k = Math.max(0, Math.min(seg.frames, Math.round(f)));
  if (k === seg.frames) return seg.to;
  return seg.from + (D * cum[k]) / cum[cum.length - 1];
}

const run = (from: number, to: number, speed: number, easeIn: boolean, easeOut: boolean, extra: Partial<Run> = {}): Run =>
  ({ kind: 'run', from, to, speed, frames: runFrames(to - from, speed, easeIn, easeOut), easeIn, easeOut, ...extra });

/** The largest ladder speed at most `target`. */
const ladderFloor = (target: number) => [...SPEED_LADDER].reverse().find(s => s <= target) ?? MIN_SPEED;
/** The fastest ladder speed at which D moves still take at least GAP_F frames. */
const capForGap = (D: number, easeIn: boolean, easeOut: boolean) =>
  [...SPEED_LADDER].reverse().find(s => runFrames(D, s, easeIn, easeOut) >= GAP_F) ?? MIN_SPEED;
const total = (segs: Segment[]) => segs.reduce((a, s) => a + s.frames, 0);

/** The story from move 1 to the fill, with beats on `beats` and the runs of the struggle at `speed`. */
function story(entries: LogStep[], size: number, byMove: TradeRow[][], beats: Map<number, string | undefined>, speed: number, winStart: number): Segment[] {
  const last = entries.length - 1;
  const moves = [...beats.keys()].sort((a, b) => a - b);
  const out: Segment[] = [];
  let pos = 0;
  let winSpeed = speed;
  const pushRuns = (from: number, to: number, beforeBeat: boolean, afterBeat: boolean, betweenBeats: boolean) => {
    // split the winning attempt at each fifth of the grid filled, slowing as it fills
    const cuts = [from];
    for (let e = from + 1; e < to; e++) {
      if (e < winStart) continue;
      const prev = Math.floor((entries[e - 1].length / (size * size)) * 5), cur = Math.floor((entries[e].length / (size * size)) * 5);
      if (cur > prev) cuts.push(e);
    }
    if (winStart > from && winStart < to && !cuts.includes(winStart)) cuts.push(winStart);
    cuts.sort((a, b) => a - b);
    cuts.push(to);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k], b = cuts[k + 1];
      if (b <= a) continue;
      const easeIn = k === 0 && afterBeat, easeOut = k + 2 === cuts.length && beforeBeat;
      let s = speed;
      if (a >= winStart) {
        const frac = entries[a].length / (size * size);
        s = Math.min(winSpeed, ladderFloor(speed * (1 - frac) + MIN_SPEED * frac));
      }
      if (betweenBeats && cuts.length === 2) s = Math.min(s, capForGap(b - a, easeIn, easeOut));
      if (a >= winStart) winSpeed = s;
      out.push(run(a, b, s, easeIn, easeOut));
    }
  };
  let prevWasBeat = false;
  for (const m of moves) {
    if (m - 1 > pos) pushRuns(pos, m - 1, true, prevWasBeat, prevWasBeat);
    const caption = beats.get(m);
    out.push(beat(byMove, m, caption ? { caption } : {}));
    pos = m;
    prevWasBeat = true;
  }
  if (pos < last) pushRuns(pos, last, false, prevWasBeat, false);
  return out;
}

/** The full cut: cold open, the story with its beats and runs, the finale, the fill, the credits. */
export function fullTimeline(entries: LogStep[], size: number, byMove: TradeRow[][], moments: Moment[]): Segment[] {
  const last = entries.length - 1;
  if (last < 1) return [{ kind: 'credits', frames: CREDITS_FRAMES }];
  const list = attempts(entries, size);
  const winStart = list[list.length - 1].start;
  const finaleFrom = Math.max(1, last - (FINALE_BEATS - 1));
  const coldMoment = moments.filter(m => m.kinds.includes('near miss') && m.credits > 0).sort((a, b) => b.weight - a.weight || a.move - b.move)[0];
  const cold: Segment[] = coldMoment ? [beat(byMove, coldMoment.move, { cold: true, caption: HOOK_CAPTION })] : [];
  const tail: Segment[] = [{ kind: 'hold', fx: 'hitstop', entry: last, frames: 4 }, { kind: 'hold', fx: 'filled', entry: last, frames: 90 }, { kind: 'credits', frames: CREDITS_FRAMES }];

  const base = new Map<number, string | undefined>();
  for (let m = finaleFrom; m <= last; m++) base.set(m, undefined);
  let firstTraded = 0;
  for (let m = 1; m < finaleFrom - 12; m++) if (chipsOf(byMove, m) > 0) { firstTraded = m; break; }
  if (firstTraded) base.set(firstTraded, RULES_CAPTION);

  const build = (beats: Map<number, string | undefined>): Segment[] | null => {
    for (const speed of SPEED_LADDER) {
      const segs = [...cold, ...story(entries, size, byMove, beats, speed, winStart), ...tail];
      if (total(segs) <= FULL_MAX) return segs;
    }
    return null;
  };
  let chosen = new Map(base);
  let best = build(chosen);
  const storyBudget = FULL_MAX - total(cold) - total(tail);
  const beatTime = (beats: Map<number, string | undefined>) => [...beats.keys()].reduce((a, m) => a + beatFrames(chipsOf(byMove, m)), 0);
  const candidates = moments.filter(m => m.move < finaleFrom - 12 && !chosen.has(m.move)).sort((a, b) => b.weight - a.weight || a.move - b.move).slice(0, 300);
  for (const c of candidates) {
    const spaced = [...chosen.keys()].every(b => b >= finaleFrom || Math.abs(b - c.move) >= 13);
    if (!spaced) continue;
    const tentative = new Map(chosen);
    tentative.set(c.move, undefined);
    if (beatTime(tentative) > storyBudget / 2) break;
    const plan = build(tentative);
    if (plan) { chosen = tentative; best = plan; }
  }
  return best ?? [...cold, ...story(entries, size, byMove, chosen, SPEED_LADDER[SPEED_LADDER.length - 1], winStart), ...tail];
}

/** The Short: hook, the record crashes, the winning attempt with two beats at most, the fill, the loop. */
export function shortTimeline(entries: LogStep[], size: number, byMove: TradeRow[][], moments: Moment[]): Segment[] {
  const last = entries.length - 1;
  const list = attempts(entries, size);
  const winStart = list[list.length - 1].start;
  const hookMove = moments.filter(m => m.move > winStart && m.kinds.includes('near miss')).at(-1)?.move ?? last;
  const out: Segment[] = [beat(byMove, hookMove, { caption: HOOK_CAPTION })];
  for (const a of list.slice(0, -1).filter(x => x.record).slice(-4)) {
    const from = Math.max(0, a.end - SHORT_CRASH_MOVES);
    if (a.end > from) out.push(run(from, a.end, SHORT_CRASH_SPEED, out[out.length - 1].kind === 'beat', false, { crash: true }));
  }
  const used = total(out);
  let inner = moments.filter(m => m.move > winStart + 1 && m.move <= last).sort((a, b) => b.weight - a.weight || a.move - b.move).slice(0, 2).map(m => m.move).sort((a, b) => a - b);
  const plan = (beats: number[], speed: number): Segment[] => {
    const segs: Segment[] = [];
    let pos = winStart, prevBeat = false;
    for (const b of beats) {
      if (b - 1 > pos) segs.push(run(pos, b - 1, speed, prevBeat, true));
      segs.push(beat(byMove, b));
      pos = b;
      prevBeat = true;
    }
    if (last > pos) segs.push(run(pos, last, speed, prevBeat, false));
    return segs;
  };
  let winning: Segment[] | null = null;
  while (!winning) {
    for (const speed of SPEED_LADDER) {
      const segs = plan(inner, speed);
      if (used + total(segs) <= SHORT_FILL_BY) { winning = segs; break; }
    }
    if (!winning && inner.length === 0) winning = plan([], SPEED_LADDER[SPEED_LADDER.length - 1]);
    if (!winning) inner = inner.slice(0, -1);
  }
  out.push(...winning);
  out.push({ kind: 'hold', fx: 'hitstop', entry: last, frames: 4 }, { kind: 'hold', fx: 'filled', entry: last, frames: 90 }, { kind: 'loop', frames: 6 });
  return out;
}
