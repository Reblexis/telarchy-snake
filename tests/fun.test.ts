import { describe, it, expect } from 'vitest';
import {
  attempts, fullCutPlan, shortPlan, sfxEvents, synthSfx, mixArgs, withCredit, shortSidecar, fullSidecar, SHORT_MAX_FRAMES,
  type Shot,
} from '../src/fun.js';
import { renderFunFrame, funTexts, renderShortFrame, shortTexts, shortPillRects, SHORT_W, SHORT_H } from '../src/fun-frame.js';
import { videoState, tradesByMove, sidecar, FPS, type TradeRow } from '../src/level.js';
import { WIDTH } from '../src/frame.js';
import type { GameEntry, LogStep } from '../src/gamelog.js';

// docs/snake.md, "The fun cuts".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (min: number, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000).toISOString();

/** A level from a move string: m moves, e eats, d dies. Size 2, so length 4 fills. */
function level(moves: string, size = 2): LogStep[] {
  const out: LogStep[] = [];
  let length = 2, deaths = 0;
  const push = (i: number, action: LogStep['action']) => out.push({
    step: i, at: at(i), snake: [{ x: 1, y: 0 }, { x: 0, y: 0 }], food: { x: 1, y: 1 }, heading: 'right',
    action, direction: 'right', undecided: false, prices: { forward: 2, left: 3, right: 4 }, length, deaths,
  });
  push(0, null);
  [...moves].forEach((c, k) => {
    if (c === 'e') length++;
    if (c === 'd') { deaths++; length = 2; }
    push(k + 1, 'forward');
  });
  void size;
  return out;
}

// a0 dies at 2 (record), a1 eats to 3 and dies (record), a2 dies at 2 (not a record), a3 fills
const L = level('md' + 'emd' + 'md' + 'mee');
const SIZE = 2;

describe('attempts', () => {
  it('splits the level at every death, with the length each attempt reached', () => {
    const a = attempts(L, SIZE);
    expect(a.map(x => [x.start, x.end, x.reached])).toEqual([[0, 2, 2], [2, 5, 3], [5, 7, 2], [7, 10, 4]]);
  });
  it('an attempt is a record when it reaches above every earlier attempt; the last one fills', () => {
    const a = attempts(L, SIZE);
    expect(a.map(x => x.record)).toEqual([true, true, false, true]);
    expect(a.map(x => x.fills)).toEqual([false, false, false, true]);
  });
});

describe('the full cut keeps the story and skips the waiting', () => {
  const full = () => fullCutPlan(L, SIZE);
  const of = (entry: number) => full().filter(s => s.entry === entry);
  it('one shot per entry, in order', () => {
    expect(full().map(s => s.entry)).toEqual(L.map((_, i) => i));
  });
  it('record and filling attempts play at four moves a second, the others at twelve with an x3 badge', () => {
    expect(of(1)[0]).toMatchObject({ frames: 6, badge: null });
    expect(of(4)[0]).toMatchObject({ frames: 6, badge: null });
    expect(of(6)[0]).toMatchObject({ frames: 2, badge: 'x3' });
    expect(of(8)[0]).toMatchObject({ frames: 6, badge: null });
  });
  it('a record attempt is never faster than a non-record one', () => {
    const plan = full();
    const slow = plan.filter(s => s.badge === null && s.fx === null && s.entry > 0).map(s => s.frames);
    const fast = plan.filter(s => s.badge === 'x3' && s.fx === null).map(s => s.frames);
    expect(Math.min(...slow)).toBeGreaterThan(Math.max(...fast));
  });
  it('an eat, a death and the fill are marked on the entry they happen on', () => {
    expect(full().map(s => s.fx)).toEqual([null, null, 'death', 'eat', null, 'death', null, 'death', null, 'eat', 'fill']);
  });
  it('a death holds long enough to be seen, the fill holds five seconds', () => {
    expect(of(2)[0].frames).toBeGreaterThanOrEqual(12);
    expect(of(7)[0].frames).toBeGreaterThanOrEqual(6);
    expect(of(10)[0].frames).toBe(5 * FPS);
  });
});

describe('the Short: hook, failures, the filling attempt, the fill, the end card, at most 59 seconds', () => {
  it('runs in that order for a small level', () => {
    const plan = shortPlan(L, SIZE);
    expect(plan[0]).toMatchObject({ entry: 0, card: 'hook', caption: 'A market played snake.' });
    expect(plan[0].frames).toBe(2 * FPS);
    const failures = plan.filter(s => s.card === null && s.fx === 'death');
    expect(failures.map(s => s.entry)).toEqual([2, 5, 7]);
    expect(failures.every(s => s.frames <= 6 && s.frames >= 1)).toBe(true);
    const filling = plan.filter(s => s.card === null && s.entry >= 8 && s.fx !== 'fill');
    expect(filling.map(s => s.entry)).toEqual([8, 9]);
    expect(filling.every(s => s.frames <= 6)).toBe(true);
    expect(plan.at(-2)).toMatchObject({ entry: 10, fx: 'fill', frames: 3 * FPS, card: null });
    expect(plan.at(-1)).toMatchObject({ entry: 10, card: 'end', frames: 3 * FPS });
  });

  it('never runs past 59 seconds, however long the level', () => {
    const long = level('md'.repeat(230) + 'm'.repeat(380) + 'ee');
    const plan = shortPlan(long, SIZE);
    const total = plan.reduce((a, s) => a + s.frames, 0);
    expect(SHORT_MAX_FRAMES).toBe(59 * FPS);
    expect(total).toBeLessThanOrEqual(SHORT_MAX_FRAMES);
    expect(plan[0].card).toBe('hook');
    expect(plan.at(-1)!.card).toBe('end');
    expect(plan.at(-2)!.fx).toBe('fill');
    expect(plan.every(s => s.frames >= 1)).toBe(true);
  });

  it('a filling attempt longer than the whole Short still fits in 59 seconds, ending on the fill', () => {
    const huge = level('m'.repeat(1300) + 'ee');
    const plan = shortPlan(huge, SIZE);
    expect(plan.reduce((a, s) => a + s.frames, 0)).toBeLessThanOrEqual(SHORT_MAX_FRAMES);
    const filling = plan.filter(s => s.card === null && s.fx !== 'fill').map(s => s.entry);
    expect(filling.at(-1)).toBe(huge.length - 2);
    expect(plan.at(-1)!.card).toBe('end');
  });

  it('the filling attempt is never slower than four moves a second', () => {
    const long = level('md'.repeat(5) + 'm'.repeat(40) + 'ee');
    const filling = shortPlan(long, SIZE).filter(s => s.card === null && s.fx !== 'death' && s.fx !== 'fill');
    expect(filling.length).toBeGreaterThan(0);
    expect(Math.max(...filling.map(s => s.frames))).toBeLessThanOrEqual(6);
  });

  it('the filling attempt ends on the fill, the entries it shows in order', () => {
    const long = level('md'.repeat(230) + 'm'.repeat(380) + 'ee');
    const plan = shortPlan(long, SIZE);
    const filling = plan.filter(s => s.card === null && s.fx !== 'death' && s.fx !== 'fill').map(s => s.entry);
    expect(filling).toEqual([...filling].sort((a, b) => a - b));
    expect(filling.at(-1)).toBe(long.length - 2);
  });
});

describe('a sound effect never stutters', () => {
  const shot = (frames: number, fx: Shot['fx']): Shot => ({ entry: 0, frames, badge: null, fx, card: null, caption: null });
  it('each effect starts on its shot\'s first frame', () => {
    const ev = sfxEvents([shot(24, null), shot(12, 'eat'), shot(24, 'death'), shot(120, 'fill')]);
    expect(ev).toEqual([{ at: 1, kind: 'eat' }, { at: 1.5, kind: 'death' }, { at: 2.5, kind: 'fill' }]);
  });
  it('a sound of the same kind within a fifth of a second of the last one is dropped', () => {
    const ev = sfxEvents([shot(2, 'death'), shot(2, 'death'), shot(2, 'death'), shot(2, 'death'), shot(2, 'death'), shot(2, 'eat')]);
    // deaths at 0, 2/24, 4/24 (dropped, < 0.2 s), 6/24 = 0.25 s kept, 8/24 dropped; the eat is its own kind
    expect(ev.map(e => [Math.round(e.at * 24), e.kind])).toEqual([[0, 'death'], [6, 'death'], [10, 'eat']]);
  });
});

describe('the synthesized effects track', () => {
  const wavOf = () => synthSfx([{ at: 0.1, kind: 'eat' }, { at: 1, kind: 'death' }], 2);
  const sample = (wav: Buffer, sec: number) => wav.readInt16LE(44 + Math.floor(sec * 44100) * 2);
  it('is a 16-bit mono 44.1 kHz WAV exactly as long as the cut', () => {
    const wav = wavOf();
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length - 44).toBe(2 * 44100 * 2);
  });
  it('sounds right after an effect and is silent where there is none', () => {
    const wav = wavOf();
    let loud = 0;
    for (let s = 0.11; s < 0.15; s += 0.001) loud = Math.max(loud, Math.abs(sample(wav, s)));
    expect(loud).toBeGreaterThan(1000);
    let quiet = 0;
    for (let s = 1.7; s < 1.99; s += 0.001) quiet = Math.max(quiet, Math.abs(sample(wav, s)));
    expect(quiet).toBe(0);
  });
  it('never clips when effects overlap', () => {
    const many = synthSfx(Array.from({ length: 20 }, () => ({ at: 0.5, kind: 'fill' as const })), 1);
    let peak = 0;
    for (let i = 44; i < many.length; i += 2) peak = Math.max(peak, Math.abs(many.readInt16LE(i)));
    expect(peak).toBeLessThanOrEqual(32767);
    expect(peak).toBeGreaterThan(1000);
  });
});

describe('the music', () => {
  it('is looped, faded in over one second and out over the last two, and mixed under the effects', () => {
    const args = mixArgs({ video: 'v.mp4', sfx: 'fx.wav', music: 'song.mp3', out: 'o.mp4', seconds: 90 });
    const loop = args.indexOf('-stream_loop');
    expect(loop).toBeGreaterThan(-1);
    expect(args[loop + 1]).toBe('-1');
    expect(args[loop + 3]).toBe('song.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('afade=t=in:st=0:d=1');
    expect(filter).toContain('afade=t=out:st=88:d=2');
    expect(filter).toContain('amix');
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('90');
  });
  it('the mix is normalized to YouTube\'s loudness, with or without music', () => {
    for (const music of ['song.mp3', null]) {
      const args = mixArgs({ video: 'v.mp4', sfx: 'fx.wav', music, out: 'o.mp4', seconds: 90 });
      const i = args.indexOf('-filter_complex');
      expect(i).toBeGreaterThan(-1);
      expect(args[i + 1]).toContain('loudnorm=I=-14:TP=-1.5');
    }
  });

  it('without music the cut carries the effects alone', () => {
    const args = mixArgs({ video: 'v.mp4', sfx: 'fx.wav', music: null, out: 'o.mp4', seconds: 90 });
    expect(args).not.toContain('-stream_loop');
    expect(args.join(' ')).not.toContain('amix');
    expect(args).toContain('fx.wav');
  });
  it('the credit ends each description, and nothing is added without one', () => {
    expect(withCredit('a\nb', 'Music: X by Y (CC0)')).toBe('a\nb\nMusic: X by Y (CC0)');
    expect(withCredit('a\nb', null)).toBe('a\nb');
  });
});

const game: GameEntry = { number: 1, size: 4, startedAt: at(0), endedAt: at(4), steps: 4, bestLength: 16, deaths: 1 };
const fourEntries: LogStep[] = [
  { step: 0, at: at(0), snake: [{ x: 1, y: 1 }, { x: 0, y: 1 }], food: { x: 3, y: 3 }, heading: 'right', action: null, direction: 'right', undecided: false, prices: { forward: null, left: null, right: null }, length: 2, deaths: 0 },
  { step: 1, at: at(1), snake: [{ x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }], food: { x: 3, y: 3 }, heading: 'right', action: 'forward', direction: 'right', undecided: false, prices: { forward: 7, left: 2, right: 3 }, length: 3, deaths: 0 },
  { step: 2, at: at(2), snake: [{ x: 1, y: 1 }, { x: 0, y: 1 }], food: { x: 3, y: 3 }, heading: 'right', action: 'left', direction: 'up', undecided: false, prices: { forward: 5, left: 1.25, right: 3 }, length: 2, deaths: 1 },
  { step: 3, at: at(3), snake: Array.from({ length: 16 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4) })), food: { x: 0, y: 0 }, heading: 'right', action: 'forward', direction: 'right', undecided: false, prices: { forward: 2, left: 3, right: 4 }, length: 16, deaths: 1 },
];
const trade: TradeRow = { id: 'trade:t', at: at(1, 30), kind: 'trade', actor: { id: 'a', handle: 'ann' }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: 10, callBefore: 1, callAfter: 1.25, marketId: 'L' } };
const ctx = () => ({ game, games: [game], entries: fourEntries, byMove: tradesByMove(fourEntries, [trade]) });
const shotFor = (entry: number, fx: Shot['fx'], extra: Partial<Shot> = {}): Shot => ({ entry, frames: 24, badge: null, fx, card: null, caption: null, ...extra });

describe('what happens in the game is felt: the full cut frame', () => {
  it('an eat raises a +1', () => {
    const { state, now } = videoState(ctx(), 1);
    expect(funTexts(state, now, shotFor(1, 'eat'), 2)).toContain('+1');
    expect(funTexts(state, now, shotFor(1, null), 2)).not.toContain('+1');
  });
  it('a death flashes the board red', () => {
    const { state, now } = videoState(ctx(), 2);
    const calm = renderFunFrame(state, now, shotFor(2, null), 0);
    const hit = renderFunFrame(state, now, shotFor(2, 'death'), 0);
    // an empty cell near the board's middle, well clear of any shake
    const k = (400 * WIDTH + 400) * 3;
    expect(hit[k] - hit[k + 1]).toBeGreaterThan(calm[k] - calm[k + 1] + 20);
  });
  it('the death counter is on every frame', () => {
    const { state, now } = videoState(ctx(), 2);
    expect(funTexts(state, now, shotFor(2, null), 0)).toContain('DEATHS 1');
  });
  it('a sped-up stretch carries its badge', () => {
    const { state, now } = videoState(ctx(), 1);
    expect(funTexts(state, now, shotFor(1, null, { badge: 'x3' }), 0)).toContain('x3');
  });
  it('the fill bursts confetti and says FILLED', () => {
    const { state, now } = videoState(ctx(), 3);
    expect(funTexts(state, now, shotFor(3, 'fill'), 12)).toContain('FILLED');
    // confetti colours (blue, pink) appear nowhere else in the frame
    const confettiPixels = (buf: Buffer) => {
      let n = 0;
      for (let y = 24; y < 696; y += 2) for (let x = 24; x < 696; x += 2) {
        const k = (y * WIDTH + x) * 3;
        const [r, g, b] = [buf[k], buf[k + 1], buf[k + 2]];
        if ((b > 200 && r < 130) || (r > 220 && b > 150 && g < 140)) n++;
      }
      return n;
    };
    expect(confettiPixels(renderFunFrame(state, now, shotFor(3, null), 12))).toBe(0);
    expect(confettiPixels(renderFunFrame(state, now, shotFor(3, 'fill'), 12))).toBeGreaterThan(20);
  });
});

describe('the Short frame is vertical and built for a phone', () => {
  it('is 1080 by 1920', () => {
    const { state, now } = videoState(ctx(), 1);
    expect(SHORT_W).toBe(1080); expect(SHORT_H).toBe(1920);
    expect(renderShortFrame(state, now, shotFor(1, null), 0).length).toBe(1080 * 1920 * 3);
  });
  it('sets nothing smaller than 40 px', () => {
    for (const [i, s] of [[0, shotFor(0, null, { card: 'hook', caption: 'A market played snake.' })], [1, shotFor(1, 'eat')], [2, shotFor(2, 'death')], [3, shotFor(3, 'fill')], [3, shotFor(3, null, { card: 'end' })]] as const) {
      const { state, now } = videoState(ctx(), i);
      const t = shortTexts(state, now, s, 0);
      expect(t.length).toBeGreaterThan(0);
      expect(Math.min(...t.map(x => x.size))).toBeGreaterThanOrEqual(40);
    }
  });
  it('shows the length, the death counter, the options with prices, and the newest trade', () => {
    const { state, now } = videoState(ctx(), 1);
    const t = shortTexts(state, now, shotFor(1, null), 0).map(x => x.text);
    expect(t).toContain('3');
    expect(t).toContain('DEATHS 0');
    expect(t).toEqual(expect.arrayContaining(['5.0', '1.3', '3.0']));
    expect(t.some(s => s.includes('ann'))).toBe(true);
  });
  it('outlines the chosen option in green', () => {
    const { state, now } = videoState(ctx(), 1);
    const buf = renderShortFrame(state, now, shotFor(1, null), 0);
    const green = (r: { x: number; y: number; w: number }) => {
      const k = (r.y * SHORT_W + Math.floor(r.x + r.w / 2)) * 3;
      return buf[k + 1] > 150 && buf[k] < 150;
    };
    expect(shortPillRects(state).map(green)).toEqual([false, true, false]);
  });
  it('the hook says what it is and the end card gives the link', () => {
    const hook = videoState(ctx(), 0);
    expect(shortTexts(hook.state, hook.now, shotFor(0, null, { card: 'hook', caption: 'A market played snake.' }), 0).map(x => x.text)).toContain('A market played snake.');
    const end = videoState(ctx(), 3);
    expect(shortTexts(end.state, end.now, shotFor(3, null, { card: 'end' }), 0).map(x => x.text)).toContain('telarchy.com/snake');
  });
});

describe('the Short\'s sidecar', () => {
  it('has the #shorts title and the full cut\'s description, credit included', () => {
    const credit = 'Music: Track by Artist (CC0)';
    const s = shortSidecar(game, fourEntries, [trade], credit);
    expect(s.title).toBe('A prediction market played snake (level 1) #shorts');
    expect(s.description).toBe(withCredit(sidecar(game, fourEntries, [trade]).description, credit));
  });
});

describe('the full cut\'s sidecar', () => {
  it('its duration is the plan\'s, and the credit ends the description', () => {
    const s = fullSidecar(game, fourEntries, [trade], 'Music: X');
    expect(s.durationSeconds).toBe(fullCutPlan(fourEntries, 4).reduce((a, x) => a + x.frames, 0) / FPS);
    expect(s.description.endsWith('\nMusic: X')).toBe(true);
    expect(s.title).toBe(sidecar(game, fourEntries, [trade]).title);
  });
});
