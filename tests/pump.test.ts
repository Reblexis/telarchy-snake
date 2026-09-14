import { describe, it, expect } from 'vitest';
import { pump } from '../src/pump.js';

// docs/snake.md, "The level videos": a render holds a bounded amount of memory.

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
