import { describe, it, expect } from 'vitest';
import { renderShortFrame, renderFunFrame } from '../src/fun-frame.js';
import { renderFrame } from '../src/frame.js';
import { pump } from '../src/pump.js';
import type { Shot } from '../src/fun.js';

// A render holds a bounded amount of memory however long the level (docs/snake.md,
// "The level videos", Encoding): a level 1 render was killed for low memory on
// 2026-09-14. The canvas library releases each frame's native pixel copy only when
// the event loop turns, so frames are measured as the render draws them, through the pump.

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

async function growth(count: number, frame: (k: number) => Buffer): Promise<number> {
  for (let k = 0; k < 3; k++) frame(k); // warm up fonts and the allocator
  await new Promise(r => setImmediate(r));
  const before = rssMb();
  let peak = before;
  const frames = (function* () { for (let k = 0; k < count; k++) yield frame(k); })();
  await pump(frames, { write: () => { peak = Math.max(peak, rssMb()); return true; }, drained: async () => {} });
  return peak - before;
}

describe('a render fits beside everything else on the laptop', () => {
  it('drawing 120 Short frames the way the render does holds its memory', async () => {
    const g = await growth(120, k => renderShortFrame(state, 0, beat, k % 30));
    console.log(`short: growth ${g.toFixed(0)} MB`);
    expect(g).toBeLessThan(150);
  }, 60_000);
  it('the Twitch stream frame holds its memory too', async () => {
    const { video: _video, ...stream } = state;
    const g = await growth(180, () => renderFrame(stream, 0));
    console.log(`stream: growth ${g.toFixed(0)} MB`);
    expect(g).toBeLessThan(100);
  }, 60_000);
  it('drawing 180 full-cut frames the way the render does holds its memory', async () => {
    const g = await growth(180, k => renderFunFrame(state, 0, beat, k % 30));
    console.log(`full: growth ${g.toFixed(0)} MB`);
    expect(g).toBeLessThan(150);
  }, 60_000);
});
