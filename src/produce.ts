// Turning a timeline into encoded video, docs/level-video.md "Structure": every frame drawn
// from its description, piped to ffmpeg as raw RGB at 30 frames a second.
import { frameAt, frameCountOf } from './frames.js';
import type { Segment } from './timeline.js';
import type { Drawn, Scene } from './draw.js';
import type { FrameInfo } from './frames.js';
import { TL_FPS } from './timeline.js';
import { sidecar, type TradeRow } from './level.js';
import type { GameEntry, LogStep } from './gamelog.js';
import { SAMPLE_RATE } from './mixer.js';

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

/** The ffmpeg arguments that decode a music file to mono float samples at the mixer's rate, normalized to -18 LUFS. */
export function musicDecodeArgs(path: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-i', path, '-af', 'loudnorm=I=-18:TP=-2:LRA=11', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'];
}

/** The ffmpeg arguments that put the mixed audio beside the encoded video: normalized to -14 LUFS, limited, and
 *  lowered by a measured peak correction last (docs/level-video.md, "Encoding"). */
export function muxArgs(o: { video: string; audio: string; out: string; gainDb?: number }): string[] {
  const gain = o.gainDb ? `,volume=${Number(o.gainDb.toFixed(2))}dB` : '';
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', o.video, '-i', o.audio,
    '-filter_complex', `[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.7:level=disabled${gain}[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', o.out,
  ];
}

/** A cut's sidecar: the level's facts, the Short's title, the music credit, and the timeline's duration. */
export function cutSidecar(cut: 'full' | 'short', game: GameEntry, entries: LogStep[], trades: TradeRow[], tl: Segment[], credit: string | null) {
  const base = sidecar(game, entries, trades);
  return {
    ...base,
    title: cut === 'short' ? `A prediction market played snake (level ${game.number}) #shorts` : base.title,
    description: credit ? `${base.description}\n${credit}` : base.description,
    durationSeconds: frameCountOf(tl) / TL_FPS,
  };
}
