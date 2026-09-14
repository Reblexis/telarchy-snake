import { describe, it, expect } from 'vitest';
import { planFrames, pump, animates } from '../src/pump.js';
import type { Shot } from '../src/fun.js';

// docs/snake.md, "The fun cuts" (a bet beat pops chips and counts prices frame by frame)
// and "The level videos", Encoding (a render holds a bounded amount of memory).

const shot = (frames: number, over: Partial<Shot> = {}): Shot => ({ entry: 0, frames, badge: null, fx: null, card: null, caption: null, ...over });
const stateOf = () => ({ state: {}, now: 0 });

function drawSpy() {
  const calls: number[] = [];
  const draw = (_s: any, _n: number, _shot: Shot, k: number) => { calls.push(k); return Buffer.from([k]); };
  return { calls, draw };
}

describe('every animated frame is drawn, a still is drawn once', () => {
  it('a bet beat is drawn frame by frame, so its chips pop and its prices count', () => {
    const { calls, draw } = drawSpy();
    const out = [...planFrames([shot(14, { bet: 1, more: 0 })], stateOf, draw)];
    expect(calls).toEqual(Array.from({ length: 14 }, (_, k) => k));
    expect(out.map(b => b[0])).toEqual(calls);
  });
  it('a caption that ends inside its shot is drawn frame by frame, so it can go', () => {
    const { calls, draw } = drawSpy();
    [...planFrames([shot(10, { caption: 'A market picks every move.', captionFrames: 4 })], stateOf, draw)];
    expect(calls).toHaveLength(10);
  });
  it('crashes, eats, the fill and the end card animate', () => {
    for (const over of [{ fx: 'death' }, { fx: 'eat' }, { fx: 'fill' }, { card: 'end' }] as Array<Partial<Shot>>) {
      const { calls, draw } = drawSpy();
      [...planFrames([shot(5, over)], stateOf, draw)];
      expect(calls, JSON.stringify(over)).toEqual([0, 1, 2, 3, 4]);
    }
  });
  it('a plain move, or a caption held for the whole shot, is drawn once and repeated', () => {
    for (const over of [{}, { caption: 'A market picks every move.', captionFrames: 6 }] as Array<Partial<Shot>>) {
      const { calls, draw } = drawSpy();
      const out = [...planFrames([shot(6, over)], stateOf, draw)];
      expect(calls, JSON.stringify(over)).toEqual([0]);
      expect(out).toHaveLength(6);
    }
    expect(animates(shot(6))).toBe(false);
    expect(animates(shot(6, { bet: 2 }))).toBe(true);
  });
  it('shots come out in order, each for its number of frames', () => {
    const { draw } = drawSpy();
    expect([...planFrames([shot(2), shot(3, { fx: 'eat' }), shot(1)], stateOf, draw)]).toHaveLength(6);
  });
});

describe('the pump', () => {
  it('yields to the event loop after every frame, so each frame\'s native pixel copy can be released', async () => {
    let turned = false;
    const seen: boolean[] = [];
    const sink = {
      write: () => { seen.push(turned); turned = false; setImmediate(() => { turned = true; }); return true; },
      drained: async () => {},
    };
    const n = await pump([Buffer.from([1]), Buffer.from([2]), Buffer.from([3]), Buffer.from([4])], sink);
    expect(n).toBe(4);
    expect(seen).toEqual([false, true, true, true]);
  });
  it('waits for the pipe to drain before writing the next frame', async () => {
    const log: string[] = [];
    let release!: () => void;
    const sink = {
      write: (b: Buffer) => { log.push(`write ${b[0]}`); return b[0] !== 2; },
      drained: () => { log.push('wait'); return new Promise<void>(r => { release = () => { log.push('drained'); r(); }; }); },
    };
    const done = pump([Buffer.from([1]), Buffer.from([2]), Buffer.from([3])], sink);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(log).toEqual(['write 1', 'write 2', 'wait']);
    release();
    await done;
    expect(log).toEqual(['write 1', 'write 2', 'wait', 'drained', 'write 3']);
  });
});
