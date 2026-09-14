// docs/level-video.md "Encoding": a finished file never clips on a phone.

/** The true peak (dBFS) from ffmpeg's ebur128 summary, -Infinity for silence, null when there is no summary. */
export function parseTruePeak(stderr: string): number | null {
  const at = stderr.lastIndexOf('True peak:');
  if (at < 0) return null;
  const m = /Peak:\s+(-?inf|-?[0-9.]+)\s*dBFS/.exec(stderr.slice(at));
  if (!m) return null;
  if (m[1].endsWith('inf')) return m[1].startsWith('-') ? -Infinity : Infinity;
  return Number(m[1]);
}

export const PEAK_TARGET_DB = -1;

/** The gain (dB) to apply to the mix: nothing at or under the target, otherwise the excess plus half a decibel. */
export function peakCorrectionDb(peakDb: number, targetDb = PEAK_TARGET_DB): number {
  if (!Number.isFinite(peakDb) || peakDb <= targetDb) return 0;
  return targetDb - peakDb - 0.5;
}
