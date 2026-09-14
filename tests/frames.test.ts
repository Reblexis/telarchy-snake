import { describe, it, expect } from 'vitest';
import { frameAt, frameCountOf } from '../src/frames.js';
import { positionAt, type Segment } from '../src/timeline.js';
import type { LogStep } from '../src/gamelog.js';

// docs/level-video.md, "Frames".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();
/** Entries whose lengths and deaths follow the given arrays. */
function level(lengths: number[], deaths: number[]): LogStep[] {
  return lengths.map((length, i) => ({ step: i, at: at(i), snake: [{ x: 0, y: 0 }], food: { x: 1, y: 1 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: { forward: 1, left: 2, right: 3 }, length, deaths: deaths[i] }));
}
// moves 1..40: an attempt reaching 6 dies at move 10 (a record), one reaching 3 dies at move 20, the winner fills by 40
const lengths = [2, 3, 4, 5, 6, 6, 6, 6, 6, 6, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, ...Array.from({ length: 20 }, (_, k) => Math.min(16, 3 + k))];
const deaths = lengths.map((_, i) => (i >= 20 ? 2 : i >= 10 ? 1 : 0));
const entries = level(lengths, deaths);
const run = (from: number, to: number, speed: number, frames: number, extra: Partial<Segment> = {}): Segment => ({ kind: 'run', from, to, speed, frames, easeIn: false, easeOut: false, ...extra } as Segment);
const TL: Segment[] = [
  { kind: 'beat', move: 30, chips: 2, frames: 152, cold: true, slow: true, caption: 'A market picks every move.' },
  run(0, 9, 24, 12),
  { kind: 'beat', move: 10, chips: 3, frames: 96 },
  run(10, 39, 24, 37),
  { kind: 'beat', move: 40, chips: 0, frames: 36 },
  { kind: 'hold', fx: 'hitstop', entry: 40, frames: 4 },
  { kind: 'hold', fx: 'filled', entry: 40, frames: 90 },
  { kind: 'credits', frames: 540 },
];
const start = (k: number) => TL.slice(0, k).reduce((a, s) => a + s.frames, 0);

describe('the frame description', () => {
  it('counts every frame of the timeline, and a frame past the end is the last one', () => {
    expect(frameCountOf(TL)).toBe(TL.reduce((a, s) => a + s.frames, 0));
    expect(frameAt(TL, entries, 99999)).toEqual(frameAt(TL, entries, frameCountOf(TL) - 1));
  });

  it('in a run the snake is where the run has reached', () => {
    const r = TL[3] as Extract<Segment, { kind: 'run' }>;
    for (const f of [0, 5, 20, 36]) expect(frameAt(TL, entries, start(3) + f).position).toBeCloseTo(positionAt(r, f), 9);
  });

  it('a beat holds the entry before the move through the chips and the lock, then glides in over its move phase', () => {
    const b = start(2); // move 10, 3 chips: 60 frames of chips, 18 of lock, 18 of move
    expect(frameAt(TL, entries, b).position).toBe(9);
    expect(frameAt(TL, entries, b + 59).position).toBe(9);
    expect(frameAt(TL, entries, b + 77).position).toBe(9);
    expect(frameAt(TL, entries, b + 78).position).toBeGreaterThan(9);
    expect(frameAt(TL, entries, b + 86).position).toBeCloseTo(9.5, 9); // halfway through the 18-frame glide
    expect(frameAt(TL, entries, b + 95).position).toBe(10);
  });

  it('chip k plays during frames 20k to 20k + 19, then 18 frames of lock, then the move', () => {
    const b = start(2);
    expect(frameAt(TL, entries, b).beat).toMatchObject({ move: 10, phase: 'chips', chip: 0, progress: 0 });
    expect(frameAt(TL, entries, b + 19).beat).toMatchObject({ phase: 'chips', chip: 0 });
    expect(frameAt(TL, entries, b + 20).beat).toMatchObject({ phase: 'chips', chip: 1, progress: 0 });
    expect(frameAt(TL, entries, b + 30).beat).toMatchObject({ phase: 'chips', chip: 1, progress: 0.5 });
    expect(frameAt(TL, entries, b + 40).beat).toMatchObject({ phase: 'chips', chip: 2, progress: 0 });
    expect(frameAt(TL, entries, b + 60).beat).toMatchObject({ phase: 'lock' });
    expect(frameAt(TL, entries, b + 77).beat).toMatchObject({ phase: 'lock' });
    expect(frameAt(TL, entries, b + 78).beat).toMatchObject({ phase: 'move' });
    expect(frameAt(TL, entries, start(1)).beat).toBeNull();
  });

  it('a captioned beat not marked slow (the Short\'s hook) keeps normal phases', () => {
    const hook: Segment[] = [{ kind: 'beat', move: 30, chips: 1, frames: 56, caption: 'A market picks every move.' }];
    expect(frameAt(hook, entries, 19).beat).toMatchObject({ phase: 'chips', chip: 0 });
    expect(frameAt(hook, entries, 20).beat).toMatchObject({ phase: 'lock' });
    expect(frameAt(hook, entries, 38).beat).toMatchObject({ phase: 'move' });
  });

  it('a slow beat plays at half speed: 40 frames a chip, 36 of lock, 36 of move', () => {
    // the cold open: move 30, 2 chips, captioned
    expect(frameAt(TL, entries, 39).beat).toMatchObject({ move: 30, phase: 'chips', chip: 0 });
    expect(frameAt(TL, entries, 40).beat).toMatchObject({ phase: 'chips', chip: 1, progress: 0 });
    expect(frameAt(TL, entries, 60).beat).toMatchObject({ phase: 'chips', chip: 1, progress: 0.5 });
    expect(frameAt(TL, entries, 80).beat).toMatchObject({ phase: 'lock' });
    expect(frameAt(TL, entries, 115).beat).toMatchObject({ phase: 'lock' });
    expect(frameAt(TL, entries, 116).beat).toMatchObject({ phase: 'move' });
    expect(frameAt(TL, entries, 115).position).toBe(29);
    expect(frameAt(TL, entries, 133).position).toBeCloseTo(29.5, 9);
    expect(frameAt(TL, entries, 151).position).toBe(30);
  });

  it('the push-in: 1 outside beats, easing to 1.08 during one and back to 1 at its end', () => {
    const b = start(2);
    expect(frameAt(TL, entries, start(1) + 3).zoom).toBe(1);
    expect(frameAt(TL, entries, b).zoom).toBeCloseTo(1, 6);
    expect(frameAt(TL, entries, b + 20).zoom).toBeCloseTo(1.08, 6);
    expect(frameAt(TL, entries, b + 95).zoom).toBeLessThan(1.02);
    for (let f = 0; f < frameCountOf(TL); f += 7) expect(frameAt(TL, entries, f).zoom).toBeLessThanOrEqual(1.08 + 1e-9);
  });

  it('the speed badge reads x<speed/4> in a fast run and is absent everywhere else', () => {
    expect(frameAt(TL, entries, start(1) + 2).badge).toBe('x6');
    expect(frameAt(TL, entries, start(2) + 2).badge).toBeNull();
    expect(frameAt(TL, entries, start(5) + 1).badge).toBeNull();
    const slow: Segment[] = [run(0, 4, 4, 30)];
    expect(frameAt(slow, entries, 3).badge).toBeNull();
  });

  it('a beat with a caption shows it for the whole beat, and no other frame has one', () => {
    expect(frameAt(TL, entries, 0).caption).toBe('A market picks every move.');
    expect(frameAt(TL, entries, 151).caption).toBe('A market picks every move.');
    expect(frameAt(TL, entries, 152).caption).toBeNull();
    expect(frameAt(TL, entries, start(2) + 5).caption).toBeNull();
  });

  it('a record card follows the crash that ends a record attempt for 60 frames', () => {
    // the beat on move 10 is the crash ending the attempt that reached 6, a record
    const b = start(2);
    const during = frameAt(TL, entries, b + 95).lowerThird;
    expect(during).toMatchObject({ text: 'RECORD 6 · attempt 1' });
    expect(frameAt(TL, entries, b + 94).lowerThird).toBeNull();
    expect(frameAt(TL, entries, b + 95 + 59).lowerThird).not.toBeNull();
    expect(frameAt(TL, entries, b + 95 + 60).lowerThird).toBeNull();
    // the crash of move 20 ended an attempt that reached only 3: it never brings a card of its own
    const r = TL[3] as Extract<Segment, { kind: 'run' }>;
    for (let f = 0; f < r.frames; f++) {
      const card = frameAt(TL, entries, start(3) + f).lowerThird;
      expect(card?.text ?? '', String(f)).not.toMatch(/attempt 2/);
    }
  });

  it('a cold open on a record crash brings no card; the card comes when the story reaches the crash', () => {
    const cold: Segment[] = [
      { kind: 'beat', move: 10, chips: 1, frames: 112, cold: true, slow: true, caption: 'A market picks every move.' },
      run(0, 9, 24, 12),
      { kind: 'beat', move: 10, chips: 1, frames: 56 },
      { kind: 'credits', frames: 540 },
    ];
    for (let f = 0; f < 112; f++) expect(frameAt(cold, entries, f).lowerThird, String(f)).toBeNull();
    // the story's beat on move 10 starts at frame 124 and arrives on its last frame, 179
    expect(frameAt(cold, entries, 178).lowerThird).toBeNull();
    expect(frameAt(cold, entries, 179).lowerThird).toMatchObject({ text: 'RECORD 6 · attempt 1' });
  });

  it('holds and credits say which they are and how far through they are', () => {
    expect(frameAt(TL, entries, start(5)).hold).toMatchObject({ fx: 'hitstop', progress: 0 });
    expect(frameAt(TL, entries, start(6) + 45).hold).toMatchObject({ fx: 'filled', progress: 0.5 });
    expect(frameAt(TL, entries, start(6) + 45).position).toBe(40);
    expect(frameAt(TL, entries, start(7) + 270).credits).toBeCloseTo(0.5, 6);
    expect(frameAt(TL, entries, start(1)).credits).toBeNull();
  });
});
