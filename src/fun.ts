// The fun cuts, docs/snake.md "The fun cuts": which entries each cut shows and
// for how long, the synthesized sound effects, and the ffmpeg mix with the
// music. Pure except for nothing: the command in video.ts does the writing.
import type { GameEntry, LogStep } from './gamelog.js';
import { FPS, sidecar, type TradeRow } from './level.js';

export type Fx = 'eat' | 'death' | 'fill';

/** One stretch of a cut: an entry's frame held `frames` frames. */
export interface Shot {
  entry: number;
  frames: number;
  /** Drawn on the board while the stretch is sped up. */
  badge: string | null;
  fx: Fx | null;
  card: 'hook' | 'end' | null;
  caption: string | null;
}

/** One attempt: from the entry it starts on (the level's start or the respawn
 *  after a death) to the entry that ends it (the death, or the level's end). */
export interface Attempt { start: number; end: number; reached: number; record: boolean; fills: boolean }

export const SHORT_MAX_FRAMES = 59 * FPS;
export const HOOK_CAPTION = 'A market played snake.';
const SLOW = 6; // four moves a second
const FAST = 2; // twelve moves a second
const DEATH_SLOW = FPS;
const DEATH_FAST = 8;
const FIRST = 3 * FPS;
const FILL_FULL = 5 * FPS;
const CARD = 3 * FPS;
const HOOK = 2 * FPS;
/** The share of the Short the failures may take at most. */
const FAILURE_SHARE = 0.4;

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

/** What happens on the move into entry `i`. */
export function fxOf(entries: LogStep[], i: number, size: number): Fx | null {
  if (i <= 0) return null;
  if (i === entries.length - 1 && entries[i].length >= size * size) return 'fill';
  if (entries[i].deaths > entries[i - 1].deaths) return 'death';
  if (entries[i].length > entries[i - 1].length) return 'eat';
  return null;
}

const shot = (entry: number, frames: number, over: Partial<Shot> = {}): Shot => ({ entry, frames, badge: null, fx: null, card: null, caption: null, ...over });

/** The full cut: record and filling attempts at four moves a second, the rest at twelve. */
export function fullCutPlan(entries: LogStep[], size: number): Shot[] {
  const list = attempts(entries, size);
  const plan: Shot[] = [shot(0, entries.length === 1 ? FILL_FULL : FIRST)];
  let a = 0;
  for (let i = 1; i < entries.length; i++) {
    while (a < list.length - 1 && i > list[a].end) a++;
    const slow = list[a].record || list[a].fills;
    const fx = fxOf(entries, i, size);
    const frames = fx === 'fill' || i === entries.length - 1 ? FILL_FULL
      : fx === 'death' ? (slow ? DEATH_SLOW : DEATH_FAST)
      : slow ? SLOW : FAST;
    plan.push(shot(i, frames, { fx, badge: slow ? null : 'x3' }));
  }
  return plan;
}

/** `n` items spread evenly over `items`, the first and the last included. */
function spread<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= items.length) return items;
  if (n === 1) return [items[items.length - 1]];
  return Array.from({ length: n }, (_, k) => items[Math.round((k * (items.length - 1)) / (n - 1))]);
}

/** The Short: hook, failures, the filling attempt, the fill, the end card. */
export function shortPlan(entries: LogStep[], size: number): Shot[] {
  const list = attempts(entries, size);
  const last = entries.length - 1;
  const final = list[list.length - 1];
  const earlier = list.slice(0, -1);
  const plan: Shot[] = [shot(0, HOOK, { card: 'hook', caption: HOOK_CAPTION })];
  let room = SHORT_MAX_FRAMES - HOOK - CARD - CARD;

  if (earlier.length > 0) {
    const budget = Math.min(earlier.length * SLOW, Math.floor(room * FAILURE_SHARE));
    const per = Math.min(SLOW, Math.floor(budget / earlier.length));
    const shown = per >= 1 ? earlier : spread(earlier, budget);
    const frames = Math.max(1, per);
    for (const a of shown) plan.push(shot(a.end, frames, { fx: 'death' }));
    room -= shown.length * frames;
  }

  const moves: number[] = [];
  for (let i = final.start + 1; i < final.end; i++) moves.push(i);
  if (moves.length > 0 && room > 0) {
    const per = Math.min(SLOW, Math.floor(room / moves.length));
    const shown = per >= 1 ? moves : spread(moves, room);
    const frames = Math.max(1, per);
    for (const i of shown) plan.push(shot(i, frames, { fx: fxOf(entries, i, size) }));
  }

  plan.push(shot(last, CARD, { fx: 'fill' }));
  plan.push(shot(last, CARD, { card: 'end' }));
  return plan;
}

export const frameCount = (plan: Shot[]) => plan.reduce((a, s) => a + s.frames, 0);

/** A sound effect never stutters: one per kind per fifth of a second at most. */
export function sfxEvents(plan: Shot[]): Array<{ at: number; kind: Fx }> {
  const out: Array<{ at: number; kind: Fx }> = [];
  const lastAt: Partial<Record<Fx, number>> = {};
  let frame = 0;
  for (const s of plan) {
    if (s.fx) {
      const at = frame / FPS;
      const prev = lastAt[s.fx];
      if (prev === undefined || at - prev >= 0.2 - 1e-9) {
        out.push({ at, kind: s.fx });
        lastAt[s.fx] = at;
      }
    }
    frame += s.frames;
  }
  return out;
}

const SR = 44100;
const TAU = Math.PI * 2;
const DUR: Record<Fx, number> = { eat: 0.14, death: 0.4, fill: 0.66 };

/** One effect's sample at `t` seconds into it. */
function voice(kind: Fx, t: number): number {
  const d = DUR[kind];
  if (t < 0 || t >= d) return 0;
  const env = 1 - t / d;
  if (kind === 'eat') {
    // a rising blip, 660 to 1320 Hz
    const phase = TAU * (660 * t + (330 * t * t) / d);
    return 0.3 * env * (0.6 * Math.sin(phase) + 0.4 * Math.sign(Math.sin(phase)));
  }
  if (kind === 'death') {
    // a falling saw buzz, 220 to 70 Hz
    const phase = 220 * t - (75 * t * t) / d;
    return 0.4 * env ** 1.5 * (2 * (phase - Math.floor(phase)) - 1);
  }
  // the fanfare: C E G C, the last one held
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const idx = Math.min(3, Math.floor(t / 0.11));
  const local = t - idx * 0.11;
  const noteEnv = idx < 3 ? 1 - local / 0.11 : 1 - local / (d - 0.33);
  return 0.28 * Math.max(0, noteEnv) * Math.sign(Math.sin(TAU * notes[idx] * local)) * (1 - 0.3 * (t / d));
}

/** The effects track: 16-bit mono 44.1 kHz WAV, `seconds` long, soft-limited so it never clips. */
export function synthSfx(events: Array<{ at: number; kind: Fx }>, seconds: number): Buffer {
  const n = Math.round(seconds * SR);
  const mix = new Float32Array(n);
  for (const e of events) {
    const from = Math.max(0, Math.floor(e.at * SR));
    const to = Math.min(n, from + Math.ceil(DUR[e.kind] * SR));
    for (let i = from; i < to; i++) mix[i] += voice(e.kind, (i - from) / SR);
  }
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + n * 2, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.tanh(mix[i]) * 32767), 44 + i * 2);
  return out;
}

/** The ffmpeg arguments that put the effects (and the music, looped and faded, under them) on a silent cut. */
export function mixArgs(o: { video: string; sfx: string; music: string | null; out: string; seconds: number }): string[] {
  const head = ['-hide_banner', '-loglevel', 'error', '-y', '-i', o.video, '-i', o.sfx];
  const tail = ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', String(o.seconds), '-movflags', '+faststart', o.out];
  // YouTube plays at -14 LUFS; normalizing to it keeps every video level whatever the track
  const loud = 'loudnorm=I=-14:TP=-1.5:LRA=11';
  if (!o.music) return [...head, '-filter_complex', `[1:a]${loud}[a]`, '-map', '0:v', '-map', '[a]', ...tail];
  const fadeOut = Math.max(0, o.seconds - 2);
  const filter = `[2:a]volume=0.4,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=2[m];[1:a][m]amix=inputs=2:duration=first:normalize=0,${loud}[a]`;
  return [...head, '-stream_loop', '-1', '-i', o.music, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', ...tail];
}

export function withCredit(description: string, credit: string | null): string {
  return credit ? `${description}\n${credit}` : description;
}

export function fullSidecar(game: GameEntry, entries: LogStep[], trades: TradeRow[], credit: string | null) {
  const base = sidecar(game, entries, trades);
  return { ...base, description: withCredit(base.description, credit), durationSeconds: frameCount(fullCutPlan(entries, game.size)) / FPS };
}

export function shortSidecar(game: GameEntry, entries: LogStep[], trades: TradeRow[], credit: string | null) {
  const base = sidecar(game, entries, trades);
  return {
    ...base,
    title: `A prediction market played snake (level ${game.number}) #shorts`,
    description: withCredit(base.description, credit),
    durationSeconds: frameCount(shortPlan(entries, game.size)) / FPS,
  };
}
