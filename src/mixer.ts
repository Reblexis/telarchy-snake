// The audio of a level video, docs/level-video.md "Sound": a cut carries its music and nothing else.
export const SAMPLE_RATE = 44100;

/** The music at the video's length: the playlist's tracks in order, each from its start, the next coming in
 *  over a one-second crossfade as the one before ends; the list starts over only when the video outlasts it.
 *  The whole fades in over a second and out over the last two. Without music the cut is silent. */
export function musicTrack(music: Float32Array | Float32Array[] | null, totalFrames: number, fps: number): Float32Array {
  const len = Math.round((totalFrames / fps) * SAMPLE_RATE);
  const out = new Float32Array(len);
  const tracks = (Array.isArray(music) ? music : music ? [music] : []).filter(t => t.length > 0);
  if (tracks.length === 0) return out;
  const cross = SAMPLE_RATE;
  let at = 0;
  for (let k = 0; at < len; k++) {
    const t = tracks[k % tracks.length];
    // a track shorter than two crossfades is laid end to end, with no crossfade
    const x = k > 0 && t.length > 2 * cross ? cross : 0;
    const start = at - x;
    for (let i = 0; i < t.length && start + i < len; i++) {
      const j = start + i;
      if (j < 0) continue;
      if (i < x) { const w = i / x; out[j] = out[j] * (1 - w) + t[i] * w; } else out[j] = t[i];
    }
    at = start + t.length;
  }
  const fadeIn = SAMPLE_RATE, fadeOut = 2 * SAMPLE_RATE;
  for (let i = 0; i < len; i++) out[i] *= Math.max(0, Math.min(1, i / fadeIn, (len - 1 - i) / fadeOut));
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
