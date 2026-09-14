import { describe, it, expect } from 'vitest';
import { registerFonts, FONTS } from '../src/frame.js';
import { GlobalFonts } from '@napi-rs/canvas';

// A frame is drawn in its bundled fonts or not at all: a level 2 render from a copy
// without fonts/ fell back to a system font without a word (2026-09-14).

describe('the bundled fonts', () => {
  it('are registered when the renderer loads', () => {
    const families = new Set(GlobalFonts.families.map(f => f.family));
    for (const family of Object.values(FONTS)) expect(families.has(family), family).toBe(true);
  });
  it('a missing font file stops the renderer with its name', () => {
    expect(() => registerFonts('/nonexistent/fonts')).toThrow(/Inter-Regular\.ttf/);
  });
});
