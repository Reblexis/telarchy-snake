import { describe, it, expect } from 'vitest';
import { buildScene, drawFull, drawShort } from '../src/draw.js';
import { frameAt, frameCountOf } from '../src/frames.js';
import { renderFrame } from '../src/frame.js';
import { pump } from '../src/pump.js';
import type { Segment } from '../src/timeline.js';
import type { GameEntry, LogStep } from '../src/gamelog.js';

// A render holds a bounded amount of memory however long the level (docs/snake.md,
// "The level videos"): a level 1 render was killed for low memory on 2026-09-14. The
// canvas library releases each frame's native pixel copy only when the event loop turns,
// so frames are measured as the render draws them, through the pump.

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number) => new Date(T0 + i * 60_000).toISOString();
const entries: LogStep[] = [0, 1, 2, 3].map(i => ({ step: i, at: at(i), snake: [{ x: i, y: 0 }], food: { x: 3, y: 3 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: { forward: 3, left: 2, right: 1 }, length: 1 + i, deaths: 0 }));
const game: GameEntry = { number: 1, size: 4, startedAt: at(0), endedAt: at(3), steps: 3, bestLength: 4, deaths: 0 };
const trade = { id: 't', at: at(0.5), kind: 'trade', actor: { id: 'ann', handle: 'ann' }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: 400, callBefore: 2, callAfter: 3, marketId: 'm' } } as any;
const TL: Segment[] = [
  { kind: 'beat', move: 1, chips: 1, frames: 25 },
  { kind: 'run', from: 1, to: 3, speed: 8, frames: 8, easeIn: false, easeOut: false },
  { kind: 'credits', frames: 20 },
];
const scene = buildScene(game, [game], entries, [[trade], [], []]);
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
  const n = frameCountOf(TL);
  it('drawing 180 full-cut frames the way the render does holds its memory', async () => {
    const g = await growth(180, k => drawFull(scene, frameAt(TL, entries, k % n)).buffer);
    console.log(`full: growth ${g.toFixed(0)} MB`);
    expect(g).toBeLessThan(300);
  }, 120_000);
  it('drawing 180 Short frames the way the render does holds its memory', async () => {
    const g = await growth(180, k => drawShort(scene, frameAt(TL, entries, k % n)).buffer);
    console.log(`short: growth ${g.toFixed(0)} MB`);
    expect(g).toBeLessThan(300);
  }, 120_000);
  it('the Twitch stream frame holds its memory too', async () => {
    const state = {
      game: { snake: [{ x: 1, y: 1 }, { x: 0, y: 1 }], heading: 'right', size: 4, length: 2, deaths: 3, food: { x: 3, y: 3 } },
      grid: 4,
      open: { directions: { forward: 'right', left: 'up', right: 'down' }, quotes: { forward: { m60: { price: 2.5, lead: null } }, left: { m60: { price: 3, lead: null } }, right: { m60: { price: 2, lead: null } } } },
      next: { direction: 'up', decided: true },
      levels: [],
    };
    const g = await growth(180, () => renderFrame(state, 0));
    console.log(`stream: growth ${g.toFixed(0)} MB`);
    expect(g).toBeLessThan(100);
  }, 60_000);
});
