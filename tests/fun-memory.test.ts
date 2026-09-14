import { describe, it, expect } from 'vitest';
import { renderShortFrame, renderFunFrame } from '../src/fun-frame.js';
import { renderFrame } from '../src/frame.js';
import type { Shot } from '../src/fun.js';

// A render must fit beside everything else on the laptop: a level 1 render was
// killed for low memory on 2026-09-14 (docs/snake.md, "The level videos").
// Drawing frames one after another must not pile up native canvas memory.

const state = {
  game: { snake: [{ x: 1, y: 1 }, { x: 0, y: 1 }], heading: 'right', size: 4, length: 2, deaths: 3, food: { x: 3, y: 3 } },
  grid: 4,
  open: { directions: { forward: 'right', left: 'up', right: 'down' }, quotes: { forward: { m60: { price: 2.5, lead: null } }, left: { m60: { price: 3, lead: null } }, right: { m60: { price: 2, lead: null } } } },
  next: { direction: 'up', decided: true },
  levels: [],
  video: { chosen: 'left', undecided: false, rows: [], bets: [{ handle: 'ann', option: 'left', credits: 10, from: 2.8, to: 3 }], facts: null },
};
const beat: Shot = { entry: 0, frames: 30, badge: null, fx: 'eat', card: null, caption: 'A market picks every move.', captionFrames: 30, bet: 1, more: 0 };

const rssMb = () => process.memoryUsage().rss / 2 ** 20;

describe('a render fits beside everything else on the laptop', () => {
  it('drawing 60 Short frames in a row does not pile up native canvas memory', () => {
    for (let k = 0; k < 3; k++) renderShortFrame(state, 0, beat, k); // warm up fonts and the allocator
    const before = rssMb();
    let peak = before;
    for (let k = 0; k < 60; k++) {
      renderShortFrame(state, 0, beat, k % 30);
      peak = Math.max(peak, rssMb());
    }
    console.log(`short: rss before ${before.toFixed(0)} MB, peak ${peak.toFixed(0)} MB, growth ${(peak - before).toFixed(0)} MB`);
    expect(peak - before).toBeLessThan(150);
  });

  it('the Twitch stream frame does not pile up native canvas memory either', () => {
    const { video: _video, ...stream } = state;
    for (let k = 0; k < 3; k++) renderFrame(stream, 0);
    const before = rssMb();
    let peak = before;
    for (let k = 0; k < 90; k++) {
      renderFrame(stream, 0);
      peak = Math.max(peak, rssMb());
    }
    console.log(`stream: rss before ${before.toFixed(0)} MB, peak ${peak.toFixed(0)} MB, growth ${(peak - before).toFixed(0)} MB`);
    expect(peak - before).toBeLessThan(100);
  });

  it('drawing 120 full-cut frames in a row does not pile up native canvas memory', () => {
    for (let k = 0; k < 3; k++) renderFunFrame(state, 0, beat, k);
    const before = rssMb();
    let peak = before;
    for (let k = 0; k < 120; k++) {
      renderFunFrame(state, 0, beat, k % 30);
      peak = Math.max(peak, rssMb());
    }
    console.log(`full: rss before ${before.toFixed(0)} MB, peak ${peak.toFixed(0)} MB, growth ${(peak - before).toFixed(0)} MB`);
    expect(peak - before).toBeLessThan(150);
  });
});
