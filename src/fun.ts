// The fun cuts, docs/snake.md "The fun cuts": which entries each cut shows and
// for how long (bet beats before the moves they decide, crashes drawn from the
// position before a death), the synthesized sound effects, and the ffmpeg mix
// with the music. Pure: the command in video.ts does the writing.
import type { GameEntry, LogStep } from './gamelog.js';
import { FPS, sidecar, tradesByMove, type TradeRow } from './level.js';

export type Fx = 'eat' | 'death' | 'fill';
export type Sound = Fx | 'trade';

/** One stretch of a cut: an entry's frame held `frames` frames. */
export interface Shot {
  entry: number;
  frames: number;
  /** Drawn on the board while the stretch is sped up. */
  badge: string | null;
  fx: Fx | null;
  card: 'end' | null;
  /** A one-line caption across the top of the board... */
  caption: string | null;
  /** ...for this many frames from the shot's start (all of them when absent). */
  captionFrames?: number;
  /** A bet beat: how many of the move's trades it shows (0 or absent: not a beat). */
  bet?: number;
  /** A bet beat: the move's trades beyond the ones it shows. */
  more?: number;
}

/** One attempt: from the entry it starts on (the level's start or the respawn
 *  after a death) to the entry that ends it (the death, or the level's end). */
export interface Attempt { start: number; end: number; reached: number; record: boolean; fills: boolean }

export const SHORT_MAX_FRAMES = 59 * FPS;
export const HOOK_CAPTION = 'A market picks every move.';
export const HOOK_SUBCAPTION = 'Traders bet. The highest price wins.';
const SLOW = 6; // four moves a second
const FAST = 2; // twelve moves a second
const DEATH_SLOW = FPS;
const FILL_FULL = 5 * FPS;
const CARD = 3 * FPS;
/** The opening caption rides the first two and a half seconds of either cut. */
const OPENING = 60;
const CRASH_SHORT = FPS;
const SHORT_CRASHES = 4;
/** A bet beat: a third of a second a shown trade, a quarter second for the pick, three trades at most. */
export const BEAT_PER_TRADE = 8;
export const BEAT_PICK = 6;
const BEAT_MAX = 3;

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

/** Both cuts open on the game: the caption sits over whatever plays in the first
 *  two and a half seconds; a shot that already has its own caption keeps it. */
function withOpening(plan: Shot[]): Shot[] {
  let at = 0;
  for (const s of plan) {
    if (at >= OPENING) break;
    if (s.caption === null) {
      s.caption = HOOK_CAPTION;
      s.captionFrames = Math.min(s.frames, OPENING - at);
    }
    at += s.frames;
  }
  return plan;
}

/** The bet beat of the move out of entry `entry`, which had `n` trades. */
function beat(entry: number, n: number): Shot {
  const shown = Math.min(BEAT_MAX, n);
  return shot(entry, BEAT_PER_TRADE * shown + BEAT_PICK, { bet: shown, more: n - shown });
}

/** The full cut runs five minutes at most (docs/snake.md, "The fun cuts"). */
export const FULL_MAX_FRAMES = 5 * 60 * FPS;
/** The speeds a boring run may play at, slowest first. */
export const SPEEDS = [3, 6, 12, 24, 48] as const;
/** Kept moves and their beats take at most this share of the five minutes. */
const KEEP_SHARE = 3 / 5;

/** Each move's interest score, by the entry it lands on (index 0 is the start). The fill and the
 *  crash that ends a record attempt are Infinity: always kept. */
export function interestScores(entries: LogStep[], size: number, tradeCounts: number[] = [], tradeCredits: number[] = []): number[] {
  const list = attempts(entries, size);
  const winning = list[list.length - 1];
  const out = entries.map(() => 0);
  let a = 0;
  for (let i = 1; i < entries.length; i++) {
    while (a < list.length - 1 && i > list[a].end) a++;
    const att = list[a];
    const fx = fxOf(entries, i, size);
    if (fx === 'fill' || (fx === 'death' && att.record)) { out[i] = Infinity; continue; }
    let score = 0;
    if (fx === 'eat') score += 3;
    const credits = tradeCredits[i - 1] ?? 0;
    if (credits > 0) score += Math.log2(1 + credits);
    const prices = Object.values(entries[i].prices).filter((v): v is number => v !== null && Number.isFinite(v));
    if (prices.length >= 2 && Math.max(...prices) - Math.min(...prices) >= 5) score += 2;
    if (att.record || att.fills) score += 2;
    if (att === winning && att.fills) score += 2;
    out[i] = score;
    void tradeCounts;
  }
  return out;
}

/** A plan with `keep` (or every move) at normal pace and the other moves in boring runs at `speed`. */
function buildPlan(entries: LogStep[], size: number, tradeCounts: number[], keep: Set<number> | 'all', speed: number): Shot[] {
  const last = entries.length - 1;
  const plan: Shot[] = [shot(0, entries.length === 1 ? FILL_FULL : SLOW)];
  const badge = `x${speed}`;
  const step = Math.max(1, speed / 6);
  const runFrames = speed === 3 ? FAST : 1;
  let run = 0;
  for (let i = 1; i < entries.length; i++) {
    const fx = fxOf(entries, i, size);
    const n = tradeCounts[i - 1] ?? 0;
    if (keep === 'all' || keep.has(i) || i === last) {
      run = 0;
      if (n > 0) plan.push(beat(i - 1, n));
      if (fx === 'death') {
        plan.push(shot(i - 1, DEATH_SLOW, { fx: 'death' }));
        plan.push(shot(i, SLOW));
      } else {
        plan.push(shot(i, fx === 'fill' || i === last ? FILL_FULL : SLOW, { fx }));
      }
    } else {
      if (run % step === 0) {
        if (fx === 'death') plan.push(shot(i - 1, runFrames, { fx: 'death', badge }));
        else plan.push(shot(i, runFrames, { fx, badge }));
      }
      run++;
    }
  }
  return withOpening(plan);
}

/** What keeping move `i` at normal pace costs in frames, beyond its boring run. */
function keepCost(entries: LogStep[], size: number, tradeCounts: number[], i: number): number {
  const n = tradeCounts[i - 1] ?? 0;
  const beatFrames = n > 0 ? beat(i - 1, n).frames : 0;
  return beatFrames + (fxOf(entries, i, size) === 'death' ? DEATH_SLOW + SLOW : SLOW);
}

/** The moves kept at normal pace: every always-kept move, then the highest scores (ties to the earlier
 *  move) until the next one would pass three fifths of the five minutes. */
function keptMoves(entries: LogStep[], size: number, tradeCounts: number[], tradeCredits: number[], share = KEEP_SHARE): { keep: Set<number>; ranked: number[]; scores: number[] } {
  const scores = interestScores(entries, size, tradeCounts, tradeCredits);
  const last = entries.length - 1;
  const ranked = Array.from({ length: last }, (_, k) => k + 1).sort((x, y) => (scores[y] - scores[x]) || (x - y));
  const keep = new Set<number>();
  let used = 0;
  const budget = FULL_MAX_FRAMES * share;
  for (const i of ranked) {
    if (i === last) { keep.add(i); continue; }
    const cost = keepCost(entries, size, tradeCounts, i);
    if (scores[i] === Infinity) { keep.add(i); used += cost; continue; }
    if (used + cost > budget) break;
    keep.add(i);
    used += cost;
  }
  return { keep, ranked, scores };
}

/** The full cut with the kept moves `fullCutPlan` chooses and the boring runs at `speed`. */
export function planAtSpeed(entries: LogStep[], size: number, tradeCounts: number[], tradeCredits: number[], speed: number): Shot[] {
  return buildPlan(entries, size, tradeCounts, keptMoves(entries, size, tradeCounts, tradeCredits).keep, speed);
}

/** The full cut: the whole level at normal pace when it fits in five minutes; otherwise the most
 *  interesting moves at normal pace and the boring ones in runs at the slowest speed that fits. */
export function fullCutPlan(entries: LogStep[], size: number, tradeCounts: number[] = [], tradeCredits: number[] = []): Shot[] {
  const whole = buildPlan(entries, size, tradeCounts, 'all', 3);
  if (frameCount(whole) <= FULL_MAX_FRAMES) return whole;
  const { keep, ranked, scores } = keptMoves(entries, size, tradeCounts, tradeCredits);
  for (const speed of SPEEDS) {
    const plan = buildPlan(entries, size, tradeCounts, keep, speed);
    if (frameCount(plan) <= FULL_MAX_FRAMES) return plan;
  }
  // even x48 does not fit: fewer high-scoring moves stay at normal pace, the lowest go first
  const kept = ranked.filter(i => keep.has(i) && scores[i] !== Infinity && i !== entries.length - 1);
  let plan = buildPlan(entries, size, tradeCounts, keep, 48);
  while (frameCount(plan) > FULL_MAX_FRAMES && kept.length > 0) {
    const drop = Math.max(1, Math.ceil(kept.length / 10));
    for (const i of kept.splice(kept.length - drop, drop)) keep.delete(i);
    plan = buildPlan(entries, size, tradeCounts, keep, 48);
  }
  return plan;
}

const clock = (frames: number) => { const s = Math.round(frames / FPS); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Where a level's full cut spends its time and what it called boring, for a person to check. */
export function cutReport(entries: LogStep[], size: number, tradeCounts: number[] = [], tradeCredits: number[] = []): string {
  const plan = fullCutPlan(entries, size, tradeCounts, tradeCredits);
  const scores = interestScores(entries, size, tradeCounts, tradeCredits);
  const moves = entries.length - 1;
  const badge = plan.find(s => s.badge)?.badge ?? null;
  const sum = (f: (s: Shot) => boolean) => plan.filter(f).reduce((a, s) => a + s.frames, 0);
  const keptShots = plan.filter(s => !s.badge && s.entry > 0 && (s.bet ?? 0) === 0 && s.fx !== 'death' && s.fx !== 'fill');
  const beats = plan.filter(s => (s.bet ?? 0) > 0);
  const boringShown = plan.filter(s => s.badge);
  const keptSet = new Set(keptShots.map(s => s.entry));
  const boringCount = moves - keptSet.size - 1;
  const always = scores.filter(v => v === Infinity).length;
  const top = Array.from({ length: moves }, (_, k) => k + 1).filter(i => Number.isFinite(scores[i])).sort((a, b) => scores[b] - scores[a]).slice(0, 5)
    .map(i => `move ${i} (${scores[i].toFixed(1)})`).join(', ');
  return [
    `full cut: total ${clock(frameCount(plan))} (${frameCount(plan)} frames, limit ${clock(FULL_MAX_FRAMES)})`,
    `kept moves: ${keptSet.size} at normal pace (${clock(sum(s => keptSet.has(s.entry) && !s.badge && (s.bet ?? 0) === 0 && s.fx !== 'fill'))}), ${beats.length} bet beats (${clock(sum(s => (s.bet ?? 0) > 0))}), ${always} always kept`,
    `boring moves: ${Math.max(0, boringCount)} of ${moves}, ${boringShown.length} shown ${badge ? `at speed ${badge}` : 'none (the level plays whole)'} (${clock(sum(s => !!s.badge))})`,
    `most interesting: ${top}`,
  ].join('\n');
}

/** `n` items spread evenly over `items`, the first and the last included. */
function spread<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= items.length) return items;
  if (n === 1) return [items[items.length - 1]];
  return Array.from({ length: n }, (_, k) => items[Math.round((k * (items.length - 1)) / (n - 1))]);
}

/** The Short: hook, the record crashes, the winning attempt with its beats, the fill, the end card. */
export function shortPlan(entries: LogStep[], size: number, tradeCounts: number[] = []): Shot[] {
  const list = attempts(entries, size);
  const last = entries.length - 1;
  const final = list[list.length - 1];
  const crashes = list.slice(0, -1).filter(x => x.record).slice(-SHORT_CRASHES);
  const plan: Shot[] = [];
  for (const x of crashes) plan.push(shot(x.end - 1, CRASH_SHORT, { fx: 'death' }));
  let room = SHORT_MAX_FRAMES - crashes.length * CRASH_SHORT - CARD - CARD;

  const moves: number[] = [];
  for (let i = final.start + 1; i < final.end; i++) moves.push(i);
  let shown: number[] = [];
  let frames = SLOW;
  if (moves.length > 0 && room > 0) {
    const per = Math.min(SLOW, Math.floor(room / moves.length));
    shown = per >= 1 ? moves : spread(moves, room);
    frames = Math.max(1, per);
    room -= shown.length * frames;
  }

  // beats go to the most-traded moves first, as long as there is time
  const lands = new Set([...shown, final.end]);
  const candidates: Array<{ j: number; n: number }> = [];
  for (let j = final.start; j < final.end; j++) {
    const n = tradeCounts[j] ?? 0;
    if (n > 0 && lands.has(j + 1)) candidates.push({ j, n });
  }
  candidates.sort((x, y) => y.n - x.n || x.j - y.j);
  const beatBefore = new Map<number, Shot>();
  for (const c of candidates) {
    const b = beat(c.j, c.n);
    if (b.frames <= room) {
      beatBefore.set(c.j + 1, b);
      room -= b.frames;
    }
  }

  for (const i of shown) {
    const b = beatBefore.get(i);
    if (b) plan.push(b);
    plan.push(shot(i, frames, { fx: fxOf(entries, i, size) }));
  }
  const lastBeat = beatBefore.get(final.end);
  if (lastBeat) plan.push(lastBeat);
  plan.push(shot(last, CARD, { fx: 'fill' }));
  plan.push(shot(last, CARD, { card: 'end' }));
  // the first bet beat says how the market works, at the moment the chips pop
  const firstBeat = plan.find(s => (s.bet ?? 0) > 0);
  if (firstBeat) {
    firstBeat.caption = HOOK_SUBCAPTION;
    firstBeat.captionFrames = firstBeat.frames;
  }
  return withOpening(plan);
}

export const frameCount = (plan: Shot[]) => plan.reduce((a, s) => a + s.frames, 0);

/** The sounds of a plan: its effects, and a coin for every trade a beat shows.
 *  A sound effect never stutters: one per kind per fifth of a second at most. */
export function sfxEvents(plan: Shot[]): Array<{ at: number; kind: Sound }> {
  const out: Array<{ at: number; kind: Sound }> = [];
  const lastAt: Partial<Record<Sound, number>> = {};
  const add = (frame: number, kind: Sound) => {
    const at = frame / FPS;
    const prev = lastAt[kind];
    if (prev === undefined || at - prev >= 0.2 - 1e-9) {
      out.push({ at, kind });
      lastAt[kind] = at;
    }
  };
  let frame = 0;
  for (const s of plan) {
    if (s.fx) add(frame, s.fx);
    for (let t = 0; t < (s.bet ?? 0); t++) add(frame + t * BEAT_PER_TRADE, 'trade');
    frame += s.frames;
  }
  return out;
}

const SR = 44100;
const TAU = Math.PI * 2;
const DUR: Record<Sound, number> = { eat: 0.14, death: 0.4, fill: 0.66, trade: 0.16 };

/** One effect's sample at `t` seconds into it. */
function voice(kind: Sound, t: number): number {
  const d = DUR[kind];
  if (t < 0 || t >= d) return 0;
  const env = 1 - t / d;
  if (kind === 'eat') {
    // a rising blip, 660 to 1320 Hz
    const phase = TAU * (660 * t + (330 * t * t) / d);
    return 0.375 * env * (0.6 * Math.sin(phase) + 0.4 * Math.sign(Math.sin(phase)));
  }
  if (kind === 'death') {
    // a falling saw buzz, 220 to 70 Hz
    const phase = 220 * t - (75 * t * t) / d;
    return 0.425 * env ** 1.5 * (2 * (phase - Math.floor(phase)) - 1);
  }
  if (kind === 'trade') {
    // a coin: B5 then E6
    const f = t < 0.05 ? 987.77 : 1318.51;
    const local = t < 0.05 ? t : t - 0.05;
    const e = t < 0.05 ? 1 : 1 - local / (d - 0.05);
    return 0.35 * e * Math.sign(Math.sin(TAU * f * local));
  }
  // the fanfare: C E G C, the last one held
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const idx = Math.min(3, Math.floor(t / 0.11));
  const local = t - idx * 0.11;
  const noteEnv = idx < 3 ? 1 - local / 0.11 : 1 - local / (d - 0.33);
  return 0.325 * Math.max(0, noteEnv) * Math.sign(Math.sin(TAU * notes[idx] * local)) * (1 - 0.2 * (t / d));
}

/** The effects track: 16-bit mono 44.1 kHz WAV, `seconds` long, soft-limited so it never clips. */
export function synthSfx(events: Array<{ at: number; kind: Sound }>, seconds: number): Buffer {
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

/** The ffmpeg arguments that put the effects (and the music, looped and faded, well under them) on a silent cut. */
export function mixArgs(o: { video: string; sfx: string; music: string | null; out: string; seconds: number; gainDb?: number }): string[] {
  const head = ['-hide_banner', '-loglevel', 'error', '-y', '-i', o.video, '-i', o.sfx];
  const tail = ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', String(o.seconds), '-movflags', '+faststart', o.out];
  // YouTube plays at -14 LUFS; normalizing to it keeps every video level whatever the track
  // a limiter after it (0.7 is -3 dBFS) leaves room for the encoder's overshoot, so the file peaks under 0 dBFS
  // a correction measured on the encoded file (docs/level-video.md, "Encoding") comes last
  const gain = o.gainDb ? `,volume=${Number(o.gainDb.toFixed(2))}dB` : '';
  const loud = `loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.7:level=disabled${gain}`;
  if (!o.music) return [...head, '-filter_complex', `[1:a]${loud}[a]`, '-map', '0:v', '-map', '[a]', ...tail];
  const fadeOut = Math.max(0, o.seconds - 2);
  const filter = `[2:a]volume=0.25,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=2[m];[1:a][m]amix=inputs=2:duration=first:normalize=0,${loud}[a]`;
  return [...head, '-stream_loop', '-1', '-i', o.music, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', ...tail];
}

export function withCredit(description: string, credit: string | null): string {
  return credit ? `${description}\n${credit}` : description;
}

const countsOf = (entries: LogStep[], trades: TradeRow[]) => tradesByMove(entries, trades).map(l => l.length);
const creditsOf = (entries: LogStep[], trades: TradeRow[]) => tradesByMove(entries, trades).map(l => l.reduce((a, r) => a + Math.abs(Number(r.detail?.cost) || 0), 0));

export function fullSidecar(game: GameEntry, entries: LogStep[], trades: TradeRow[], credit: string | null) {
  const base = sidecar(game, entries, trades);
  return {
    ...base,
    description: withCredit(base.description, credit),
    durationSeconds: frameCount(fullCutPlan(entries, game.size, countsOf(entries, trades), creditsOf(entries, trades))) / FPS,
  };
}

export function shortSidecar(game: GameEntry, entries: LogStep[], trades: TradeRow[], credit: string | null) {
  const base = sidecar(game, entries, trades);
  return {
    ...base,
    title: `A prediction market played snake (level ${game.number}) #shorts`,
    description: withCredit(base.description, credit),
    durationSeconds: frameCount(shortPlan(entries, game.size, countsOf(entries, trades))) / FPS,
  };
}
