// The audio of a level video, docs/level-video.md "Sound": a cut carries its music and nothing else.
export const SAMPLE_RATE = 44100;

/** The music at the video's length: looped if the cut outlasts it, faded in over a second and out over the
 *  last two. Without music the cut is silent. */
export function musicTrack(music: Float32Array | null, totalFrames: number, fps: number): Float32Array {
  const len = Math.round((totalFrames / fps) * SAMPLE_RATE);
  const out = new Float32Array(len);
  if (!music || music.length === 0) return out;
  const fadeIn = SAMPLE_RATE, fadeOut = 2 * SAMPLE_RATE;
  for (let i = 0; i < len; i++) out[i] = music[i % music.length] * Math.max(0, Math.min(1, i / fadeIn, (len - 1 - i) / fadeOut));
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
