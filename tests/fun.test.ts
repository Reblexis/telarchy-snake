import { describe, it, expect } from 'vitest';
import {
  attempts, fullCutPlan, shortPlan, sfxEvents, synthSfx, mixArgs, withCredit, shortSidecar, fullSidecar, SHORT_MAX_FRAMES,
  type Shot,
} from '../src/fun.js';
import { renderFunFrame, funTexts, renderShortFrame, shortTexts, shortPillRects, tagRects, chipRects, burstAt, SIZES, SHORT_BOX, SHORT_W, SHORT_H } from '../src/fun-frame.js';
import { MAIN_BOX, type Box } from '../src/frame.js';
import { directionsFrom, ACTIONS } from '../src/decide.js';
import { videoState, tradesByMove, sidecar, FPS, type TradeRow } from '../src/level.js';
import { WIDTH } from '../src/frame.js';
import type { GameEntry, LogStep } from '../src/gamelog.js';

// docs/snake.md, "The fun cuts".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (min: number, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000).toISOString();

/** A level from a move string: m moves, e eats, d dies. */
function level(moves: string): LogStep[] {
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
  return out;
}

// Size 2, so length 4 fills. a0 dies at 2 (record), a1 eats to 3 and dies (record),
// a2 dies at 2 (not a record, sped up), a3 fills.
const L = level('md' + 'emd' + 'md' + 'mee');
const SIZE = 2;
/** Trades per move: the move from entry i to entry i + 1. */
const TC = [2, 1, 0, 0, 0, 4, 0, 0, 5, 0];

const kind = (s: Shot) => (s.card ? s.card : (s.bet ?? 0) > 0 ? 'bet' : s.fx === 'death' ? 'crash' : s.fx === 'fill' ? 'fill' : 'move');

describe('attempts', () => {
  it('splits the level at every death, with the length each attempt reached', () => {
    expect(attempts(L, SIZE).map(x => [x.start, x.end, x.reached])).toEqual([[0, 2, 2], [2, 5, 3], [5, 7, 2], [7, 10, 4]]);
  });
  it('an attempt is a record when it reaches above every earlier attempt; the last one fills', () => {
    const a = attempts(L, SIZE);
    expect(a.map(x => x.record)).toEqual([true, true, false, true]);
    expect(a.map(x => x.fills)).toEqual([false, false, false, true]);
  });
});

describe('the full cut opens on the game', () => {
  it('no static hold, the caption across the first two and a half seconds', () => {
    const plan = fullCutPlan(L, SIZE, TC);
    expect(plan[0]).toMatchObject({ entry: 0, frames: 6 });
    let at = 0;
    for (const s of plan) {
      if (at < 60) expect(s, JSON.stringify({ at, s })).toMatchObject({ caption: 'A market picks every move.', captionFrames: Math.min(s.frames, 60 - at) });
      else expect(s.caption).toBeNull();
      at += s.frames;
    }
  });
  it('a bet beat shows at most three trades, a third of a second each, then a quarter second for the pick', () => {
    const bets = fullCutPlan(L, SIZE, TC).filter(s => kind(s) === 'bet');
    expect(bets.map(s => [s.bet, s.more ?? 0, s.frames])).toEqual([[2, 0, 22], [1, 0, 14], [3, 1, 30], [3, 2, 30]]);
  });
  it('an eat is marked on the entry it happens on, the fill holds five seconds', () => {
    const plan = fullCutPlan(L, SIZE, TC);
    expect(plan.filter(s => s.fx === 'eat').map(s => s.entry)).toEqual([3, 9]);
    expect(plan.at(-1)).toMatchObject({ entry: 10, fx: 'fill', frames: 5 * FPS });
  });
  it('without trade counts there are no beats', () => {
    expect(fullCutPlan(L, SIZE).some(s => kind(s) === 'bet')).toBe(false);
  });
});

describe('the Short tells one story in at most 59 seconds', () => {
  it('the record crashes under the opening caption, the winning attempt with its beats, the fill, the end card', () => {
    const plan = shortPlan(L, SIZE, TC);
    expect(plan.map(s => [s.entry, kind(s)])).toEqual([
      [1, 'crash'], [4, 'crash'], [8, 'move'], [8, 'bet'], [9, 'move'], [10, 'fill'], [10, 'end'],
    ]);
    // no title card: the caption rides the first two and a half seconds of the game
    expect(plan.some(s => s.card === 'hook')).toBe(false);
    let at = 0;
    for (const s of plan) {
      // the winning attempt's first bet beat carries its own caption, even inside the opening window
      if (at < 60 && kind(s) !== 'bet') expect(s.caption, JSON.stringify({ at, s })).toBe('A market picks every move.');
      at += s.frames;
    }
    expect(plan[0].captionFrames).toBe(24);
    expect(plan[1].captionFrames).toBe(24);
    expect(plan[2].captionFrames).toBe(6);
    // the first bet beat of the winning attempt says how the market works
    expect(plan[3]).toMatchObject({ caption: 'Traders bet. The highest price wins.', captionFrames: plan[3].frames });
    expect(plan.filter(s => kind(s) === 'crash').every(s => s.frames === FPS)).toBe(true);
    expect(plan.at(-2)!.frames).toBe(3 * FPS);
    expect(plan.at(-1)!.frames).toBe(3 * FPS);
  });

  it('shows only the latest four record crashes, never a crash of an attempt that set no record', () => {
    // records reach 2, 3, 4, 5, 6, 7 on a 4x4 grid, a non-record between them, then the fill
    const moves = 'md' + 'emd' + 'md' + 'eemd' + 'eeemd' + 'eeeemd' + 'eeeeemd' + 'm' + 'e'.repeat(14);
    const lv = level(moves);
    const a = attempts(lv, 4);
    const recordEnds = a.slice(0, -1).filter(x => x.record).map(x => x.end - 1);
    const crashes = shortPlan(lv, 4).filter(s => kind(s) === 'crash').map(s => s.entry);
    expect(crashes).toEqual(recordEnds.slice(-4));
  });

  it('never runs past 59 seconds, however long the level and however many trades', () => {
    const huge = level('md'.repeat(230) + 'm'.repeat(1300) + 'ee');
    const tc = huge.map(() => 10);
    const plan = shortPlan(huge, SIZE, tc);
    expect(SHORT_MAX_FRAMES).toBe(59 * FPS);
    expect(plan.reduce((a, s) => a + s.frames, 0)).toBeLessThanOrEqual(SHORT_MAX_FRAMES);
    expect(plan[0].caption).toBe('A market picks every move.');
    expect(plan.at(-1)!.card).toBe('end');
    expect(plan.at(-2)!.fx).toBe('fill');
    expect(plan.every(s => s.frames >= 1)).toBe(true);
  });

  it('the winning attempt is never slower than four moves a second', () => {
    const lv = level('md'.repeat(5) + 'm'.repeat(40) + 'ee');
    const moves = shortPlan(lv, SIZE, lv.map(() => 1)).filter(s => kind(s) === 'move');
    expect(moves.length).toBeGreaterThan(0);
    expect(Math.max(...moves.map(s => s.frames))).toBeLessThanOrEqual(6);
  });

  it('when time is short the beats go to the moves with the most trades', () => {
    const lv = level('m'.repeat(1000) + 'ee');
    const tc = lv.map(() => 1);
    tc[100] = 9; tc[500] = 9; tc[900] = 9;
    const bets = shortPlan(lv, SIZE, tc).filter(s => kind(s) === 'bet').map(s => s.entry);
    expect(bets).toEqual(expect.arrayContaining([100, 500, 900]));
    expect(bets.length).toBeLessThan(20);
  });

  it('a beat sits right before the move it decides', () => {
    const lv = level('m'.repeat(20) + 'ee');
    const tc = lv.map((_, i) => (i % 3 === 0 ? 2 : 0));
    const plan = shortPlan(lv, SIZE, tc);
    plan.forEach((s, i) => {
      if (kind(s) !== 'bet') return;
      const next = plan[i + 1];
      expect([s.entry + 1]).toContain(next.entry);
    });
  });
});

describe('a sound effect never stutters', () => {
  const shot = (frames: number, fx: Shot['fx'], extra: Partial<Shot> = {}): Shot => ({ entry: 0, frames, badge: null, fx, card: null, caption: null, ...extra });
  it('each effect starts on its shot\'s first frame', () => {
    const ev = sfxEvents([shot(24, null), shot(12, 'eat'), shot(24, 'death'), shot(120, 'fill')]);
    expect(ev).toEqual([{ at: 1, kind: 'eat' }, { at: 1.5, kind: 'death' }, { at: 2.5, kind: 'fill' }]);
  });
  it('a bet beat rings a coin for each trade it shows', () => {
    const ev = sfxEvents([shot(24, null), shot(30, null, { bet: 3, more: 2 })]);
    expect(ev.map(e => [Math.round(e.at * 24), e.kind])).toEqual([[24, 'trade'], [32, 'trade'], [40, 'trade']]);
  });
  it('a sound of the same kind within a fifth of a second of the last one is dropped', () => {
    const ev = sfxEvents([shot(2, 'death'), shot(2, 'death'), shot(2, 'death'), shot(2, 'death'), shot(2, 'death'), shot(2, 'eat')]);
    expect(ev.map(e => [Math.round(e.at * 24), e.kind])).toEqual([[0, 'death'], [6, 'death'], [10, 'eat']]);
  });
});

describe('the synthesized effects track', () => {
  const sample = (wav: Buffer, sec: number) => wav.readInt16LE(44 + Math.floor(sec * 44100) * 2);
  const peak = (wav: Buffer, from: number, to: number) => {
    let p = 0;
    for (let s = from; s < to; s += 0.0005) p = Math.max(p, Math.abs(sample(wav, s)));
    return p;
  };
  it('is a 16-bit mono 44.1 kHz WAV exactly as long as the cut', () => {
    const wav = synthSfx([{ at: 0.1, kind: 'eat' }], 2);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length - 44).toBe(2 * 44100 * 2);
  });
  it('every effect is moderate: heard over the music, peaking at about 40 percent of full scale', () => {
    for (const kind of ['eat', 'death', 'fill', 'trade'] as const) {
      const wav = synthSfx([{ at: 0.1, kind }], 1);
      const p = peak(wav, 0.1, 0.4);
      expect(p, kind).toBeGreaterThan(8000);
      expect(p, kind).toBeLessThanOrEqual(14000);
    }
  });
  it('is silent where there is no effect', () => {
    const wav = synthSfx([{ at: 0.1, kind: 'eat' }, { at: 1, kind: 'death' }], 2);
    expect(peak(wav, 1.7, 1.99)).toBe(0);
  });
  it('never clips when effects overlap', () => {
    const many = synthSfx(Array.from({ length: 20 }, () => ({ at: 0.5, kind: 'fill' as const })), 1);
    let p = 0;
    for (let i = 44; i < many.length; i += 2) p = Math.max(p, Math.abs(many.readInt16LE(i)));
    expect(p).toBeLessThanOrEqual(32767);
    expect(p).toBeGreaterThan(1000);
  });
});

describe('the music', () => {
  it('is looped, faded in over one second and out over the last two, and sits well under the effects', () => {
    const args = mixArgs({ video: 'v.mp4', sfx: 'fx.wav', music: 'song.mp3', out: 'o.mp4', seconds: 90 });
    const loop = args.indexOf('-stream_loop');
    expect(loop).toBeGreaterThan(-1);
    expect(args[loop + 1]).toBe('-1');
    expect(args[loop + 3]).toBe('song.mp3');
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('[2:a]volume=0.25');
    expect(filter).toContain('afade=t=in:st=0:d=1');
    expect(filter).toContain('afade=t=out:st=88:d=2');
    expect(filter).toContain('amix');
    expect(args[args.indexOf('-t') + 1]).toBe('90');
  });
  it('the mix is normalized to YouTube\'s loudness, with or without music', () => {
    for (const music of ['song.mp3', null]) {
      const args = mixArgs({ video: 'v.mp4', sfx: 'fx.wav', music, out: 'o.mp4', seconds: 90 });
      const filter = args[args.indexOf('-filter_complex') + 1];
      expect(filter).toContain('loudnorm=I=-14:TP=-1.5');
      // a limiter after the normalization, set low enough to hold the peak through encoding
      expect(filter.indexOf('alimiter=')).toBeGreaterThan(filter.indexOf('loudnorm='));
      const limit = Number(/alimiter=limit=([0-9.]+)/.exec(filter)?.[1]);
      expect(limit).toBeLessThanOrEqual(0.7);
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
const count = (t: string[], s: string) => t.filter(x => x === s).length;

describe('a viewer sees that a market is playing: the full cut frame', () => {
  it('the question line says traders bet on every move', () => {
    const { state, now } = videoState(ctx(), 1);
    const t = funTexts(state, now, shotFor(1, null), 0);
    expect(t).toContain('Traders bet on every move. The highest price wins.');
    expect(t).not.toContain('What length will I reach on this attempt?');
  });
  it('each option\'s price is tagged on the board, besides the pills', () => {
    const { state, now } = videoState(ctx(), 1);
    const t = funTexts(state, now, shotFor(1, null), 0);
    expect(count(t, '5.0')).toBe(2);
    expect(count(t, '3.0')).toBeGreaterThanOrEqual(2); // the right option; the length reads 3.0 too
  });
  it('the move\'s trades are carried on the state, oldest first, with their option when it is unambiguous', () => {
    const { state } = videoState(ctx(), 1);
    expect(state.video.bets).toEqual([{ handle: 'ann', option: 'left', credits: 10, from: 1, to: 1.25 }]);
  });
  it('a bet beat pops a chip for the trade while its tag counts from the call before to the call after', () => {
    const { state, now } = videoState(ctx(), 1);
    const beat = shotFor(1, null, { bet: 1, more: 0, frames: 14 });
    const first = funTexts(state, now, beat, 1);
    expect(first).toContain('+10 cr');
    expect(first).toContain('ann');
    expect(first).toContain('1.0');
    expect(funTexts(state, now, beat, 13)).not.toContain('1.0');
  });
  it('more than three trades say how many more', () => {
    const { state, now } = videoState(ctx(), 1);
    expect(funTexts(state, now, shotFor(1, null, { bet: 1, more: 2, frames: 14 }), 10)).toContain('+2 more');
  });
  it('a crash counts the death, marks the spot it hits in red, and flashes the board', () => {
    const { state, now } = videoState(ctx(), 1); // the position before the fatal move up into (2, 0)
    expect(funTexts(state, now, shotFor(1, 'death'), 0)).toContain('DEATHS 1');
    const hit = renderFunFrame(state, now, shotFor(1, 'death'), 4);
    const calm = renderFunFrame(state, now, shotFor(1, null), 4);
    const spot = (buf: Buffer) => { const k = (108 * WIDTH + 444) * 3; return [buf[k], buf[k + 1]]; };
    expect(spot(hit)[0]).toBeGreaterThan(180);
    expect(spot(hit)[1]).toBeLessThan(140);
    expect(spot(calm)[0]).toBeLessThan(80);
  });
  it('a crash in a sped-up stretch never strobes: no board flash, the burst and the counter still there', () => {
    const { state, now } = videoState(ctx(), 1);
    const fast = renderFunFrame(state, now, shotFor(1, 'death', { badge: 'x3', frames: 8 }), 0);
    const calm = renderFunFrame(state, now, shotFor(1, null, { badge: 'x3' }), 0);
    const redness = (buf: Buffer) => { const k = (400 * WIDTH + 400) * 3; return buf[k] - buf[k + 1]; };
    expect(redness(fast)).toBeLessThanOrEqual(redness(calm) + 5);
    const spot = (buf: Buffer) => { const k = (108 * WIDTH + 444) * 3; return [buf[k], buf[k + 1]]; };
    expect(spot(renderFunFrame(state, now, shotFor(1, 'death', { badge: 'x3', frames: 8 }), 4))[0]).toBeGreaterThan(180);
    expect(funTexts(state, now, shotFor(1, 'death', { badge: 'x3', frames: 8 }), 0)).toContain('DEATHS 1');
  });

  it('an eat raises a +1', () => {
    const { state, now } = videoState(ctx(), 1);
    expect(funTexts(state, now, shotFor(1, 'eat'), 2)).toContain('+1');
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
  it('sets nothing smaller than 40 px, tags and chips included', () => {
    const cases: Array<[number, Shot]> = [
      [0, shotFor(0, null, { caption: 'A market picks every move.', captionFrames: 60 })],
      [1, shotFor(1, 'eat')], [1, shotFor(1, 'death')], [1, shotFor(1, null, { bet: 1, more: 2, frames: 14 })],
      [3, shotFor(3, 'fill')], [3, shotFor(3, null, { card: 'end' })],
    ];
    for (const [i, s] of cases) {
      const { state, now } = videoState(ctx(), i);
      for (const k of [0, 5, 12]) {
        const t = shortTexts(state, now, s, k);
        expect(t.length).toBeGreaterThan(0);
        expect(Math.min(...t.map(x => x.size))).toBeGreaterThanOrEqual(40);
      }
    }
  });
  it('shows the length, the death counter, the options with prices, tags on the board, and the newest trade', () => {
    const { state, now } = videoState(ctx(), 1);
    const t = shortTexts(state, now, shotFor(1, null), 0).map(x => x.text);
    expect(t).toContain('3');
    expect(t).toContain('DEATHS 0');
    expect(count(t, '5.0')).toBe(2);
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
  it('the caption sits over the moving game for its frames and then goes; the end card asks for a bet and gives the link', () => {
    const open = videoState(ctx(), 1);
    const captioned = shotFor(1, null, { caption: 'A market picks every move.', captionFrames: 10, frames: 24 });
    const during = shortTexts(open.state, open.now, captioned, 9).map(x => x.text);
    expect(during).toContain('A market picks every move.');
    expect(during).toContain('5.0'); // the game is still there under the caption
    expect(shortTexts(open.state, open.now, captioned, 10).map(x => x.text)).not.toContain('A market picks every move.');
    expect(funTexts(open.state, open.now, captioned, 9)).toContain('A market picks every move.');
    expect(funTexts(open.state, open.now, captioned, 10)).not.toContain('A market picks every move.');
    const end = videoState(ctx(), 3);
    const e = shortTexts(end.state, end.now, shotFor(3, null, { card: 'end' }), 0).map(x => x.text);
    expect(e).toContain('Bet on the next move');
    expect(e).toContain('telarchy.com/snake');
  });
});

describe('the sidecars', () => {
  it('the Short has the #shorts title and the full cut\'s description, credit included', () => {
    const credit = 'Music: Track by Artist (CC0)';
    const s = shortSidecar(game, fourEntries, [trade], credit);
    expect(s.title).toBe('A prediction market played snake (level 1) #shorts');
    expect(s.description).toBe(withCredit(sidecar(game, fourEntries, [trade]).description, credit));
  });
  it('the full cut\'s duration is its plan\'s, trades included, and the credit ends the description', () => {
    const s = fullSidecar(game, fourEntries, [trade], 'Music: X');
    const moves = tradesByMove(fourEntries, [trade]);
    const tc = moves.map(l => l.length);
    const cr = moves.map(l => l.reduce((a, r) => a + Math.abs(Number(r.detail.cost) || 0), 0));
    expect(s.durationSeconds).toBe(fullCutPlan(fourEntries, 4, tc, cr).reduce((a, x) => a + x.frames, 0) / FPS);
    expect(s.description.endsWith('\nMusic: X')).toBe(true);
    expect(s.title).toBe(sidecar(game, fourEntries, [trade]).title);
  });
});

describe('the market marks look good: nothing collides, nothing leaves the board', () => {
  type Rect = { x: number; y: number; w: number; h: number };
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (r: Rect, box: Box) => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.px && r.y + r.h <= box.y + box.px;
  const headings = ['up', 'right', 'down', 'left'] as const;
  /** A 4x4 position with the head at (x, y), every option priced, `bets` on the move. */
  const position = (x: number, y: number, heading: typeof headings[number], bets: any[] = [], size = 4) => ({
    game: { snake: [{ x, y }], heading, size, length: 2, deaths: 0 },
    grid: size,
    open: { directions: directionsFrom(heading), quotes: Object.fromEntries(ACTIONS.map(a => [a, { m60: { price: 2.5, lead: null } }])) },
    next: { direction: directionsFrom(heading).left, decided: true },
    video: { chosen: 'left', bets, rows: [] },
  });
  const everyPosition = () => {
    const out: Array<ReturnType<typeof position>> = [];
    for (const size of [4, 8, 12]) {
      const cells = size === 4 ? [0, 1, 2, 3] : [0, 1, size >> 1, size - 2, size - 1];
      for (const x of cells) for (const y of cells) for (const h of headings) out.push(position(x, y, h, [], size));
    }
    return out;
  };

  it('tags never overlap each other and stay inside the board, at every head position and heading, in both cuts', () => {
    for (const [box, z] of [[MAIN_BOX, SIZES.full], [SHORT_BOX, SIZES.short]] as const) {
      for (const s of everyPosition()) {
        const rects = tagRects(s, box, z);
        const head = s.game.snake[0];
        const N = s.grid;
        const dirs = directionsFrom(s.game.heading);
        const d: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        const enterable = ACTIONS.filter(a => { const [dx, dy] = d[dirs[a]]; const nx = head.x + dx, ny = head.y + dy; return nx >= 0 && ny >= 0 && nx < N && ny < N; });
        // an option that runs into the wall has no tag
        expect(rects.map(r => r.action).sort(), JSON.stringify({ head, heading: s.game.heading, N })).toEqual([...enterable].sort());
        const cell = Math.floor(box.px / N);
        const hx = box.x + head.x * cell + cell / 2, hy = box.y + head.y * cell + cell / 2;
        for (const r of rects) {
          expect(inside(r, box), JSON.stringify({ head, heading: s.game.heading, r })).toBe(true);
          // no tag covers the centre of the head's cell
          expect(hx > r.x && hx < r.x + r.w && hy > r.y && hy < r.y + r.h, JSON.stringify({ head, heading: s.game.heading, N, r })).toBe(false);
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
          expect(overlap(rects[i], rects[j]), JSON.stringify({ head: s.game.snake[0], heading: s.game.heading })).toBe(false);
        }
      }
    }
  });

  it('the fun cuts draw no next-move chevron: no accent on the board outside a beat', () => {
    const { state, now } = videoState(ctx(), 1);
    const amber = (buf: Buffer, w: number, box: Box) => {
      let n = 0;
      for (let y = box.y; y < box.y + box.px; y += 2) for (let x = box.x; x < box.x + box.px; x += 2) {
        const k = (y * w + x) * 3;
        if (buf[k] > 200 && buf[k + 1] > 120 && buf[k + 1] < 180 && buf[k + 2] < 60) n++;
      }
      return n;
    };
    expect(amber(renderFunFrame(state, now, shotFor(1, null), 0), WIDTH, MAIN_BOX)).toBe(0);
    expect(amber(renderShortFrame(state, now, shotFor(1, null), 0), SHORT_W, SHORT_BOX)).toBe(0);
  });

  it('a crash burst stays inside the board, however close the wall', () => {
    for (const [box] of [[MAIN_BOX], [SHORT_BOX]] as const) {
      for (const s of everyPosition()) {
        for (const d of ['up', 'right', 'down', 'left']) {
          const b = burstAt({ ...s, next: { direction: d, decided: true } }, box);
          expect(b).not.toBeNull();
          expect(b!.x - b!.r >= box.x && b!.y - b!.r >= box.y && b!.x + b!.r <= box.x + box.px && b!.y + b!.r <= box.y + box.px,
            JSON.stringify({ head: s.game.snake[0], d, b })).toBe(true);
        }
      }
    }
  });

  it('chips are large in the Short, solid for half a second, and stay inside the board, unnamed trades above the head', () => {
    expect(SIZES.short.chip).toBeGreaterThanOrEqual(52);
    const bets = [
      { handle: 'ann', option: 'forward', credits: 10, from: 2, to: 2.5 },
      { handle: 'a-very-long-trader-handle', option: 'left', credits: 1200, from: 2, to: 2.5 },
      { handle: 'bob', option: null, credits: 5, from: 2, to: 2.5 },
    ];
    const beat: Shot = { entry: 0, frames: 30, badge: null, fx: null, card: null, caption: null, bet: 3, more: 0 };
    for (const [box, z] of [[MAIN_BOX, SIZES.full], [SHORT_BOX, SIZES.short]] as const) {
      for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (const h of headings) {
        const s = position(x, y, h, bets);
        for (const k of [0, 4, 12, 20, 29]) {
          for (const c of chipRects(s, beat, k, box, z)) {
            expect(inside(c, box), JSON.stringify({ head: { x, y }, h, k, c })).toBe(true);
            if (k - c.start <= 12) expect(c.alpha).toBe(1);
          }
        }
      }
    }
    // the unnamed trade's chip sits over the head's column, not at the panel
    const s = position(1, 2, 'right', bets);
    const head = SHORT_BOX.x + Math.floor(SHORT_BOX.px / 4) * 1.5;
    const unnamed = chipRects(s, beat, 17, SHORT_BOX, SIZES.short).find(c => c.handle === 'bob')!;
    expect(unnamed).toBeDefined();
    expect(Math.abs(unnamed.x + unnamed.w / 2 - head)).toBeLessThan(Math.floor(SHORT_BOX.px / 4) / 2);
  });
});
