import { describe, it, expect } from 'vitest';
import { productionFrames, encodeArgs, muxArgs, musicDecodeArgs, cutSidecar } from '../src/produce.js';
import { buildScene, drawFull, drawShort, FULL_SIZE, SHORT_SIZE } from '../src/draw.js';
import { frameCountOf } from '../src/frames.js';
import type { Segment } from '../src/timeline.js';
import type { GameEntry, LogStep } from '../src/gamelog.js';

// docs/level-video.md, "Structure": 1920x1080 and 1080x1920 at 30 frames a second.

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();
const entries: LogStep[] = [0, 1, 2, 3].map(i => ({ step: i, at: at(i), snake: [{ x: i, y: 0 }], food: { x: 3, y: 3 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: { forward: 3, left: 2, right: 1 }, length: 1 + i, deaths: 0 }));
const game: GameEntry = { number: 1, size: 2, startedAt: at(0), endedAt: at(3), steps: 3, bestLength: 4, deaths: 0 };
const TL: Segment[] = [
  { kind: 'run', from: 0, to: 2, speed: 8, frames: 8, easeIn: false, easeOut: true },
  { kind: 'beat', move: 3, chips: 0, frames: 15 },
  { kind: 'hold', fx: 'filled', entry: 3, frames: 5 },
  { kind: 'credits', frames: 4 },
];

describe('the production frames', () => {
  it('yield exactly one frame per timeline frame, at the cut\'s size', () => {
    const scene = buildScene(game, [game], entries, [[], [], []]);
    const full = [...productionFrames(scene, TL, drawFull)];
    expect(full).toHaveLength(frameCountOf(TL));
    expect(full.every(b => b.length === FULL_SIZE.w * FULL_SIZE.h * 3)).toBe(true);
    const short = [...productionFrames(scene, TL, drawShort)];
    expect(short).toHaveLength(frameCountOf(TL));
    expect(short[0].length).toBe(SHORT_SIZE.w * SHORT_SIZE.h * 3);
  });
});

describe('the encoder', () => {
  it('reads raw RGB at the cut\'s size at 30 frames a second', () => {
    const args = encodeArgs('out.mp4', FULL_SIZE);
    const s = args.join(' ');
    expect(s).toContain('-f rawvideo');
    expect(s).toContain('-pix_fmt rgb24');
    expect(s).toContain('-s 1920x1080');
    expect(s).toContain('-r 30');
    expect(args[args.length - 1]).toBe('out.mp4');
    expect(encodeArgs('s.mp4', SHORT_SIZE).join(' ')).toContain('-s 1080x1920');
  });
});

describe('the audio', () => {
  it('decodes the music to mono 44.1 kHz floats normalized to -18 LUFS', () => {
    const s = musicDecodeArgs('track.ogg').join(' ');
    expect(s).toContain('-i track.ogg');
    expect(s).toContain('loudnorm=I=-18');
    expect(s).toContain('-ac 1');
    expect(s).toContain('-ar 44100');
    expect(s).toContain('-f f32le');
  });
  it('muxes the mix normalized to -14 LUFS and limited, copying the video', () => {
    const args = muxArgs({ video: 'v.mp4', audio: 'a.wav', out: 'o.mp4' });
    const s = args.join(' ');
    expect(s).toContain('-i v.mp4 -i a.wav');
    expect(s).toContain('loudnorm=I=-14');
    expect(s).toContain('alimiter=limit=0.7');
    expect(s).toContain('-c:v copy');
    expect(s).toContain('-c:a aac -b:a 160k');
    expect(s).not.toContain('volume=');
    expect(args[args.length - 1]).toBe('o.mp4');
  });
  it('a peak correction lowers the mix after the limiter', () => {
    const s = muxArgs({ video: 'v.mp4', audio: 'a.wav', out: 'o.mp4', gainDb: -1.25 }).join(' ');
    expect(s).toMatch(/alimiter=[^ ]*,volume=-1\.25dB/);
  });
});

describe('the sidecars', () => {
  it('give the timeline\'s duration at 30 frames a second', () => {
    const full = cutSidecar('full', game, entries, [], TL, null);
    expect(full.durationSeconds).toBe(frameCountOf(TL) / 30);
    expect(full.game).toBe(1);
  });
  it('the Short is titled as a Short and both carry the music credit', () => {
    const short = cutSidecar('short', game, entries, [], TL, 'Music: X by Y (CC0)');
    const full = cutSidecar('full', game, entries, [], TL, 'Music: X by Y (CC0)');
    expect(short.title).toContain('#shorts');
    expect(full.title).not.toContain('#shorts');
    expect(short.description).toContain('Music: X by Y (CC0)');
    expect(full.description).toContain('Music: X by Y (CC0)');
  });
});
