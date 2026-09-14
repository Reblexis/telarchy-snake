import { describe, it, expect } from 'vitest';
import { parseTruePeak, peakCorrectionDb } from '../src/loudness.js';

// docs/level-video.md, "Encoding": a finished file never clips on a phone.

const summary = (peak: string) => `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -13.9 LUFS\n    Threshold: -24.0 LUFS\n\n  True peak:\n    Peak:        ${peak} dBFS\n`;

describe('the true peak of an encoded file', () => {
  it('is read from ffmpeg\'s loudness summary', () => {
    expect(parseTruePeak(summary('1.5'))).toBe(1.5);
    expect(parseTruePeak(summary('-3.0'))).toBe(-3);
    expect(parseTruePeak(summary('-inf'))).toBe(-Infinity);
    expect(parseTruePeak('no summary here')).toBeNull();
  });
});

describe('the correction', () => {
  it('above -1 dBTP the mix is lowered by the excess plus half a decibel', () => {
    expect(peakCorrectionDb(1.5)).toBeCloseTo(-3.0, 6);
    expect(peakCorrectionDb(-0.5)).toBeCloseTo(-1.0, 6);
  });
  it('at or under -1 dBTP nothing changes', () => {
    expect(peakCorrectionDb(-1)).toBe(0);
    expect(peakCorrectionDb(-6)).toBe(0);
    expect(peakCorrectionDb(-Infinity)).toBe(0);
  });
});
