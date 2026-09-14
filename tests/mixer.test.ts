import { describe, it, expect } from 'vitest';
import { synthEffects, musicGain, mixTracks, SAMPLE_RATE } from '../src/mixer.js';
import type { SoundEvent } from '../src/sound.js';

// docs/level-video.md, "Sound": gains relative to the music, ducking under loud sounds, variants.

const FPS = 30;
const ev = (frame: number, kind: SoundEvent['kind'], variant: number, gainDb: number, duckDb = 0): SoundEvent => ({ frame, kind, variant, gainDb, duckDb });
const peakOf = (a: Float32Array, from: number, to: number) => { let p = 0; for (let i = from; i < to; i++) p = Math.max(p, Math.abs(a[i])); return p; };
const sec = (s: number) => Math.round(s * SAMPLE_RATE);

describe('the effects track', () => {
  it('is exactly as long as the video', () => {
    expect(synthEffects([], 90, FPS).length).toBe(sec(3));
  });
  it('a sound starts on its frame', () => {
    const fx = synthEffects([ev(30, 'coin', 0, 0)], 90, FPS);
    expect(peakOf(fx, 0, sec(1) - 10)).toBe(0);
    expect(peakOf(fx, sec(1), sec(1) + sec(0.05))).toBeGreaterThan(0.01);
  });
  it('two variants of a kind sound different but last as long', () => {
    const a = synthEffects([ev(0, 'coin', 0, 0)], 30, FPS), b = synthEffects([ev(0, 'coin', 1, 0)], 30, FPS);
    let diff = 0, lastA = 0, lastB = 0;
    for (let i = 0; i < a.length; i++) { diff += Math.abs(a[i] - b[i]); if (a[i] !== 0) lastA = i; if (b[i] !== 0) lastB = i; }
    expect(diff).toBeGreaterThan(1);
    expect(Math.abs(lastA - lastB)).toBeLessThan(sec(0.02));
  });
  it('variants of a kind differ in pitch', () => {
    const crossings = (a: Float32Array) => { let n = 0; for (let i = 1; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };
    const low = crossings(synthEffects([ev(0, 'coin', 0, 0)], 30, FPS)), high = crossings(synthEffects([ev(0, 'coin', 3, 0)], 30, FPS));
    expect(high - low).toBeGreaterThan(8);
  });
  it('variants of a kind differ in level', () => {
    const a = synthEffects([ev(0, 'crash', 0, 0)], 30, FPS), b = synthEffects([ev(0, 'crash', 2, 0)], 30, FPS);
    expect(peakOf(b, 0, b.length) / peakOf(a, 0, a.length)).toBeGreaterThan(1.08);
  });
  it('a sound 6 dB lower peaks at half the amplitude', () => {
    const loud = synthEffects([ev(0, 'crash', 2, 0)], 30, FPS), soft = synthEffects([ev(0, 'crash', 2, -6)], 30, FPS);
    const ratio = peakOf(soft, 0, soft.length) / peakOf(loud, 0, loud.length);
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });
  it('holds no NaN', () => {
    const fx = synthEffects([ev(0, 'fill', 3, 5, 5), ev(10, 'eat', 1, -7), ev(12, 'record', 0, 2, 3)], 60, FPS);
    expect(fx.some(Number.isNaN)).toBe(false);
  });
});

describe('the music ducks under loud sounds', () => {
  it('stays at full level far from loud sounds, and small sounds never duck it', () => {
    const g = musicGain([ev(10, 'coin', 0, -6), ev(40, 'eat', 1, -7)], 90, FPS);
    expect(g.length).toBe(sec(3));
    let lowest = Infinity;
    for (let i = 0; i < g.length; i++) if (g[i] < lowest) lowest = g[i];
    expect(lowest).toBeCloseTo(1, 6);
  });
  it('dips by the duck depth within 30 ms of a loud sound and comes back within 500 ms of its end', () => {
    const g = musicGain([ev(30, 'crash', 0, 3, 4)], 150, FPS);
    const depth = 10 ** (-4 / 20);
    expect(g[sec(1) - 10]).toBeCloseTo(1, 3);
    expect(g[sec(1) + sec(0.03)]).toBeLessThan(depth + 0.02);
    const end = sec(1) + sec(0.4); // a crash lasts 400 ms
    expect(g[end + sec(0.5)]).toBeGreaterThan(0.98);
  });
});

describe('the mix', () => {
  it('loops short music to the full length, fades in over a second and out over the last two', () => {
    const music = new Float32Array(sec(0.5)).fill(0.5);
    const len = sec(6);
    const out = mixTracks(music, new Float32Array(len), new Float32Array(len).fill(1));
    expect(out.length).toBe(len);
    expect(Math.abs(out[0])).toBeLessThan(0.01);
    expect(out[sec(1.5)]).toBeCloseTo(0.5, 2);
    expect(out[sec(3.7)]).toBeCloseTo(0.5, 2);
    expect(Math.abs(out[len - 1])).toBeLessThan(0.01);
  });
  it('applies the duck envelope to the music and adds the effects on top', () => {
    const len = sec(4);
    const music = new Float32Array(len).fill(0.5), fx = new Float32Array(len), gain = new Float32Array(len).fill(1);
    fx[sec(2)] = 0.25; gain[sec(2)] = 0.5;
    const out = mixTracks(music, fx, gain);
    expect(out[sec(2)]).toBeCloseTo(0.5 * 0.5 + 0.25, 3);
  });
  it('without music the mix is the effects', () => {
    const fx = new Float32Array(sec(1)); fx[100] = 0.3;
    const out = mixTracks(null, fx, new Float32Array(sec(1)).fill(1));
    expect(out[100]).toBeCloseTo(0.3, 6);
  });
});
