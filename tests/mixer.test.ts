import { describe, it, expect } from 'vitest';
import * as mixer from '../src/mixer.js';
import { musicTrack, SAMPLE_RATE } from '../src/mixer.js';

// docs/level-video.md, "Sound": a cut carries its music and nothing else.

const sec = (s: number) => Math.round(s * SAMPLE_RATE);

describe('a cut carries its music and nothing else', () => {
  it('no sound effects of any kind: the mixer synthesizes nothing', () => {
    expect(Object.keys(mixer).sort()).toEqual(['SAMPLE_RATE', 'musicTrack', 'wavOf']);
  });
  it('the track is exactly as long as the video', () => {
    expect(musicTrack(new Float32Array(sec(10)).fill(0.5), 90, 30).length).toBe(sec(3));
  });
  it('the music is looped when the cut outlasts it, fades in over a second and out over the last two', () => {
    const out = musicTrack(new Float32Array(sec(0.5)).fill(0.5), 180, 30);
    expect(out.length).toBe(sec(6));
    expect(Math.abs(out[0])).toBeLessThan(0.01);
    expect(out[sec(0.5)]).toBeCloseTo(0.25, 2);
    expect(out[sec(1.5)]).toBeCloseTo(0.5, 2);
    expect(out[sec(3.7)]).toBeCloseTo(0.5, 2);
    expect(out[sec(5)]).toBeCloseTo(0.25, 2);
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01);
  });
  it('between the fades the music is untouched: nothing ducks it', () => {
    const music = new Float32Array(sec(4));
    for (let i = 0; i < music.length; i++) music[i] = Math.sin(i / 20) * 0.4;
    const out = musicTrack(music, 120, 30);
    for (let i = sec(1); i < sec(2); i += 97) expect(out[i]).toBeCloseTo(music[i], 6);
  });
  it('without music the cut is silent', () => {
    const out = musicTrack(null, 30, 30);
    expect(out.length).toBe(sec(1));
    expect(out.every(v => v === 0)).toBe(true);
  });
  it('empty music is silence, not a crash', () => {
    expect(musicTrack(new Float32Array(0), 30, 30).every(v => v === 0)).toBe(true);
  });
});
