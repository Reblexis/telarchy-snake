// Turning a timeline into encoded video, docs/level-video.md "Structure": every frame drawn
// from its description, piped to ffmpeg as raw RGB at 30 frames a second.
import { frameAt, frameCountOf } from './frames.js';
import type { Segment } from './timeline.js';
import type { Drawn, Scene } from './draw.js';
import type { FrameInfo } from './frames.js';
import { TL_FPS } from './timeline.js';

/** Every frame of a timeline, drawn: exactly one buffer per timeline frame. */
export function* productionFrames(scene: Scene, tl: Segment[], draw: (scene: Scene, info: FrameInfo) => Drawn): Generator<Buffer> {
  const total = frameCountOf(tl);
  for (let f = 0; f < total; f++) yield draw(scene, frameAt(tl, scene.entries, f)).buffer;
}

/** The ffmpeg arguments that read raw RGB frames of `size` at 30 frames a second and encode them to `path`. */
export function encodeArgs(path: string, size: { w: number; h: number }): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${size.w}x${size.h}`, '-r', String(TL_FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path,
  ];
}
