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

/** The ffmpeg arguments that decode a music file to mono float samples at the mixer's rate, normalized to -14 LUFS. */
export function musicDecodeArgs(path: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-i', path, '-af', 'loudnorm=I=-14:TP=-2:LRA=11', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'];
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

// ---------------------------------------------------------------------------------------------
// all levels in one video, docs/snake.md "All levels in one video"

/** The full cuts to join: every complete level in order of number. A missing cut is refused by name. */
export function allLevelsPlan(games: GameEntry[], exists: (file: string) => boolean): { files: string[]; levels: number[] } {
  const levels = games.filter(g => g.endedAt).map(g => g.number).sort((a, b) => a - b);
  if (levels.length === 0) throw new Error('no complete level to join');
  const files = levels.map(n => `videos/snake-level-${n}.mp4`);
  const missing = levels.filter((_, k) => !exists(files[k]));
  if (missing.length) throw new Error(`the full cut of level ${missing.join(', ')} is not rendered: run npm run video -- ${missing[0]} first`);
  return { files, levels };
}

/** ffmpeg's concat list: one quoted file per line. */
export function concatList(files: string[]): string {
  return files.map(f => `file '${f.replace(/'/g, `'\\''`)}'\n`).join('');
}

/** The ffmpeg arguments that join the listed cuts without re-encoding. */
export function concatArgs(list: string, out: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out];
}

export function allLevelsSidecar(levels: number[], lines: string[], durationSeconds: number) {
  return {
    title: `Futarchy snake, levels ${levels[0]} to ${levels[levels.length - 1]}: a market chose every move`,
    description: [
      'A prediction market played these games of snake. Every minute three options (continue, turn left, turn right) were priced by traders on telarchy.com, and the highest price was the move.',
      ...lines,
      'Trade the next move: https://telarchy.com/snake',
      'Watch it live: https://www.twitch.tv/telarchy',
    ].join('\n'),
    levels,
    durationSeconds,
  };
}
