// The sound of a level video, docs/level-video.md "Sound": each planned sound synthesized
// (four variants a kind, small pitch and level offsets) at its gain relative to the music,
// the music's duck envelope under loud sounds, and the mix of the two.
import type { SoundEvent, SoundKind } from './sound.js';

export const SAMPLE_RATE = 44100;
/** The amplitude of a sound at 0 dB relative to the music bed. */
const A_REF = 0.25;
const TAU = Math.PI * 2;
/** How long each kind of sound lasts, in seconds. */
export const SOUND_SECONDS: Record<SoundKind, number> = { coin: 0.16, eat: 0.14, crash: 0.4, record: 0.5, fill: 0.66 };
const CENTS = [-40, -15, 15, 40];
const LEVEL_DB = [-0.8, 0, 0.5, -0.3];
const DUCK_ATTACK = 0.02, DUCK_RELEASE = 0.4;

/** A deterministic noise value in [-1, 1] for sample n. */
const noise = (n: number) => {
  let x = (n * 2654435761) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return (((x ^ (x >>> 15)) >>> 0) / 4294967295) * 2 - 1;
};

/** One sample of a kind of sound at `t` seconds into it, before gain; `p` scales every pitch. */
function voice(kind: SoundKind, t: number, p: number, n: number): number {
  const d = SOUND_SECONDS[kind];
  if (t < 0 || t >= d) return 0;
  const decay = (k: number) => Math.exp(-t * k);
  switch (kind) {
    case 'coin': {
      // two quick bell notes, B5 then E6
      const f = t < 0.05 ? 987.77 : 1318.51;
      const local = t < 0.05 ? t : t - 0.05;
      return Math.sin(TAU * f * p * local) * (t < 0.05 ? 1 : decay(18)) * 0.9;
    }
    case 'eat': {
      // a soft rising blip
      const phase = TAU * p * (520 * t + (380 * t * t) / d);
      return Math.sin(phase) * (1 - t / d) * 0.8;
    }
    case 'crash': {
      // a low thud with a little grit, falling in pitch
      const phase = TAU * p * (160 * t - (90 * t * t) / d);
      return (Math.sin(phase) * 0.8 + noise(n) * 0.25 * decay(12)) * decay(6);
    }
    case 'record': {
      // a bright three-note rise
      const notes = [659.25, 830.61, 987.77];
      const k = Math.min(2, Math.floor(t / 0.12));
      const local = t - k * 0.12;
      return Math.sin(TAU * notes[k] * p * local) * Math.exp(-local * 6) * 0.8;
    }
    case 'fill': {
      // a major arpeggio with its octave, the last note held
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const k = Math.min(3, Math.floor(t / 0.11));
      const local = t - k * 0.11;
      const env = k < 3 ? Math.exp(-local * 8) : 1 - (t - 0.33) / (d - 0.33);
      return (Math.sin(TAU * notes[k] * p * local) * 0.7 + Math.sin(TAU * notes[k] * 2 * p * local) * 0.2) * env;
    }
  }
}

/** The effects track: every planned sound at its frame and gain, exactly as long as the video. */
export function synthEffects(plan: SoundEvent[], totalFrames: number, fps: number): Float32Array {
  const out = new Float32Array(Math.round((totalFrames / fps) * SAMPLE_RATE));
  for (const e of plan) {
    const start = Math.round((e.frame / fps) * SAMPLE_RATE);
    const len = Math.round(SOUND_SECONDS[e.kind] * SAMPLE_RATE);
    const pitch = 2 ** (CENTS[e.variant % CENTS.length] / 1200);
    const amp = A_REF * 10 ** ((e.gainDb + LEVEL_DB[e.variant % LEVEL_DB.length]) / 20);
    for (let i = 0; i < len && start + i < out.length; i++) out[start + i] += voice(e.kind, i / SAMPLE_RATE, pitch, i) * amp;
  }
  return out;
}

/** The music's gain per sample: 1, dipping by each loud sound's duck depth with a fast attack and a slow release. */
export function musicGain(plan: SoundEvent[], totalFrames: number, fps: number): Float32Array {
  const len = Math.round((totalFrames / fps) * SAMPLE_RATE);
  const out = new Float32Array(len).fill(1);
  const attack = Math.round(DUCK_ATTACK * SAMPLE_RATE), release = Math.round(DUCK_RELEASE * SAMPLE_RATE);
  for (const e of plan) {
    if (e.duckDb <= 0) continue;
    const depth = 10 ** (-e.duckDb / 20);
    const start = Math.round((e.frame / fps) * SAMPLE_RATE);
    const end = start + Math.round(SOUND_SECONDS[e.kind] * SAMPLE_RATE);
    for (let i = Math.max(0, start); i < Math.min(len, end + release); i++) {
      let g: number;
      if (i < start + attack) g = 1 - (1 - depth) * ((i - start) / attack);
      else if (i < end) g = depth;
      else g = depth + (1 - depth) * ((i - end) / release);
      if (g < out[i]) out[i] = g;
    }
  }
  return out;
}

/** The mix: the music looped to the length, faded in over a second and out over the last two, under its duck
 *  envelope, with the effects added on top. Without music the mix is the effects. */
export function mixTracks(music: Float32Array | null, effects: Float32Array, gain: Float32Array): Float32Array {
  const len = effects.length;
  const out = new Float32Array(len);
  if (!music || music.length === 0) { out.set(effects); return out; }
  const fadeIn = SAMPLE_RATE, fadeOut = 2 * SAMPLE_RATE;
  for (let i = 0; i < len; i++) {
    const fade = Math.min(1, i / fadeIn, (len - 1 - i) / fadeOut);
    out[i] = music[i % music.length] * Math.max(0, fade) * (gain[i] ?? 1) + effects[i];
  }
  return out;
}

/** 16-bit mono PCM WAV of a track, clamped to full scale. */
export function wavOf(samples: Float32Array): Buffer {
  const n = samples.length;
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + n * 2, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24);
  out.writeUInt32LE(SAMPLE_RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return out;
}
