import { describe, it, expect } from 'vitest';
import { soundPlan } from '../src/sound.js';
import { frameCountOf } from '../src/frames.js';
import type { Segment } from '../src/timeline.js';
import type { LogStep } from '../src/gamelog.js';

// docs/level-video.md, "Sound".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();
// lengths: eats at moves 3, 6, 9 ...; a death at move 12 ends a record attempt; the fill at move 40
const lengths: number[] = [], deaths: number[] = [];
let L = 2, D = 0;
for (let i = 0; i <= 40; i++) {
  if (i === 12) { D = 1; L = 2; } else if (i > 0 && i % 3 === 0) L++;
  lengths.push(i === 40 ? 16 : L); deaths.push(D);
}
const entries: LogStep[] = lengths.map((length, i) => ({ step: i, at: at(i), snake: [{ x: 0, y: 0 }], food: { x: 1, y: 1 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: { forward: 1, left: 2, right: 3 }, length, deaths: deaths[i] }));
const TL: Segment[] = [
  { kind: 'run', from: 0, to: 11, speed: 32, frames: 20, easeIn: false, easeOut: true },
  { kind: 'beat', move: 12, chips: 2, frames: 76 },
  { kind: 'run', from: 12, to: 39, speed: 4, frames: 200, easeIn: true, easeOut: false },
  { kind: 'beat', move: 40, chips: 3, frames: 96 },
  { kind: 'hold', fx: 'hitstop', entry: 40, frames: 4 },
  { kind: 'hold', fx: 'filled', entry: 40, frames: 90 },
  { kind: 'credits', frames: 540 },
];
const plan = () => soundPlan(TL, entries, 4);

describe('the sound plan', () => {
  it('a coin at the start of every chip inside a beat, and none elsewhere', () => {
    const coins = plan().filter(e => e.kind === 'coin').map(e => e.frame);
    expect(coins).toEqual([20, 40, 296, 316, 336]);
  });
  it('in a slow beat the coins are 40 frames apart', () => {
    const slow: Segment[] = [{ kind: 'beat', move: 12, chips: 2, frames: 152, slow: true, caption: 'Traders bet. The highest price moves.' }];
    expect(soundPlan(slow, entries, 4).filter(e => e.kind === 'coin').map(e => e.frame)).toEqual([0, 40]);
  });
  it('no eat or crash inside a run faster than 8 moves a second', () => {
    expect(plan().filter(e => e.frame < 20 && e.kind !== 'coin')).toEqual([]);
  });
  it('eats and the crash where they happen at slow speed, the fill once', () => {
    const p = plan();
    expect(p.filter(e => e.kind === 'crash').map(e => e.frame)).toEqual([95]);
    expect(p.filter(e => e.kind === 'eat').length).toBeGreaterThan(5);
    expect(p.filter(e => e.kind === 'fill')).toHaveLength(1);
  });
  it('small sounds sit 4 to 8 dB under the music, big ones at most 6 dB over with the music ducked 3 to 5 dB', () => {
    for (const e of plan()) {
      if (e.kind === 'coin' || e.kind === 'eat') { expect(e.gainDb).toBeGreaterThanOrEqual(-8); expect(e.gainDb).toBeLessThanOrEqual(-4); expect(e.duckDb).toBe(0); }
      else { expect(e.gainDb).toBeLessThanOrEqual(6); expect(e.duckDb).toBeGreaterThanOrEqual(3); expect(e.duckDb).toBeLessThanOrEqual(5); }
    }
  });
  it('four variants a kind, and never the variant of the previous sound of that kind', () => {
    const p = plan();
    for (const kind of ['coin', 'eat', 'crash', 'fill', 'record'] as const) {
      const seq = p.filter(e => e.kind === kind);
      for (const e of seq) { expect(e.variant).toBeGreaterThanOrEqual(0); expect(e.variant).toBeLessThan(4); }
      for (let k = 1; k < seq.length; k++) expect(seq[k].variant, `${kind} ${k}`).not.toBe(seq[k - 1].variant);
    }
  });
  it('every sound falls inside the video', () => {
    for (const e of plan()) { expect(e.frame).toBeGreaterThanOrEqual(0); expect(e.frame).toBeLessThan(frameCountOf(TL)); }
  });
});
