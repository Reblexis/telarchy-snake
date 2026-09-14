// How a render feeds its frames to ffmpeg, docs/snake.md "The level videos"
// (Encoding: a render holds a bounded amount of memory) and "The fun cuts"
// (a bet beat pops chips and counts prices frame by frame).
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
