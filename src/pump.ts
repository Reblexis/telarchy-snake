// How a render feeds its frames to ffmpeg, docs/snake.md "The level videos"
// (Encoding: a render holds a bounded amount of memory) and "The fun cuts"
// (a bet beat pops chips and counts prices frame by frame).
import type { Shot } from './fun.js';

export type Draw = (s: any, now: number, shot: Shot, k: number) => Buffer;

/** Whether a shot changes from frame to frame and must be drawn for every one of them. */
export function animates(shot: Shot): boolean {
  return shot.fx !== null
    || shot.card !== null
    || (shot.bet ?? 0) > 0
    || (shot.caption !== null && (shot.captionFrames ?? shot.frames) < shot.frames);
}

/** Every frame of a plan, in order: an animated shot drawn frame by frame, a still one drawn once and repeated. */
export function* planFrames(plan: Shot[], stateOf: (entry: number) => { state: any; now: number }, draw: Draw, onShot?: (done: number) => void): Generator<Buffer> {
  let done = 0;
  for (const shot of plan) {
    const { state, now } = stateOf(shot.entry);
    if (animates(shot)) {
      for (let k = 0; k < shot.frames; k++) yield draw(state, now, shot, k);
    } else {
      const still = draw(state, now, shot, 0);
      for (let k = 0; k < shot.frames; k++) yield still;
    }
    onShot?.(++done);
  }
}

/** Where frames go: `write` answers false when the pipe is full, `drained` resolves when it has room. */
export interface Sink { write(frame: Buffer): boolean; drained(): Promise<void> }

/** Writes every frame, waiting when the pipe is full, and yields to the event loop after
 *  each one: the canvas library frees a frame's native pixel copy only when the loop turns
 *  (@napi-rs/canvas issue #819), and a render that never yields grows by a frame per draw. */
export async function pump(frames: Iterable<Buffer>, sink: Sink): Promise<number> {
  let n = 0;
  for (const frame of frames) {
    if (!sink.write(frame)) await sink.drained();
    await new Promise<void>(resolve => setImmediate(resolve));
    n++;
  }
  return n;
}
