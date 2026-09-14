// Level video maker, docs/snake.md "The level videos" and "The fun cuts":
// `npm run video -- <game> [--music <file>] [--credit "<line>"]` reads one
// complete game from public reads and writes the full cut and the Short, each
// with its sidecar. Nothing is written when the game is refused.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { WIDTH, HEIGHT } from './frame.js';
import { FPS, readLevel, tradesByMove, videoState, type LevelContext } from './level.js';
import { frameCount, fullCutPlan, fullSidecar, mixArgs, sfxEvents, shortPlan, shortSidecar, synthSfx, type Shot } from './fun.js';
import { renderFunFrame, renderShortFrame, SHORT_W, SHORT_H } from './fun-frame.js';
import { planFrames, pump } from './pump.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const n = Number(argv[0]);
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: npm run video -- <game number> [--music <audio file>] [--credit "<line>"]');
  process.exit(2);
}
const music = flag('--music');
const credit = flag('--credit');
if (music && !existsSync(music)) {
  console.error(`refused: no music file at ${music}`);
  process.exit(1);
}
if (!music) console.error('no --music: the cuts carry the sound effects alone');

let level;
try {
  level = await readLevel(n, {
    feedUrl: process.env.SNAKE_FEED_URL ?? 'https://snake.telarchy.com',
    telarchyUrl: process.env.TELARCHY_PUBLIC_URL ?? 'https://telarchy.com',
  });
} catch (e) {
  console.error(`refused: ${(e as Error).message}`);
  process.exit(1);
}

const { game, games, entries, trades } = level;
const ctx: LevelContext = { game, games, entries, byMove: tradesByMove(entries, trades) };
const tradeCounts = ctx.byMove.map(list => list.length);
const tradeCredits = ctx.byMove.map(list => list.reduce((a, r) => a + Math.abs(Number(r.detail?.cost) || 0), 0));
const states = new Map<number, { state: any; now: number }>();
const stateOf = (i: number) => {
  let s = states.get(i);
  if (!s) { s = videoState(ctx, i); states.set(i, s); }
  return s;
};

import type { Draw } from './pump.js';

async function run(args: string[]) {
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const [code] = await once(ff, 'exit');
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

async function encode(path: string, w: number, h: number, plan: Shot[], draw: Draw) {
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-r', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', path,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = once(ff, 'exit');
  ff.stdin.on('error', () => {});
  const frames = planFrames(plan, stateOf, draw, done => { if (done % 250 === 0) console.error(`${path}: shot ${done}/${plan.length}`); });
  await pump(frames, { write: frame => ff.stdin.write(frame), drained: async () => { await once(ff.stdin, 'drain'); } });
  ff.stdin.end();
  const [code] = await exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

async function cut(name: string, w: number, h: number, plan: Shot[], draw: Draw, meta: object) {
  const out = `videos/${name}.mp4`;
  const video = `videos/${name}.video.mp4`;
  const fx = `videos/${name}.fx.wav`;
  const part = `videos/${name}.part.mp4`;
  const seconds = frameCount(plan) / FPS;
  console.error(`${name}: ${plan.length} shots, ${seconds}s`);
  try {
    await encode(video, w, h, plan, draw);
    writeFileSync(fx, synthSfx(sfxEvents(plan), seconds));
    await run(mixArgs({ video, sfx: fx, music, out: part, seconds }));
    renameSync(part, out);
    writeFileSync(`videos/${name}.json`, `${JSON.stringify(meta, null, 2)}\n`);
    console.error(`wrote ${out} and videos/${name}.json`);
  } finally {
    for (const f of [video, fx, part]) rmSync(f, { force: true });
  }
}

mkdirSync('videos', { recursive: true });
try {
  await cut(`snake-level-${n}`, WIDTH, HEIGHT, fullCutPlan(entries, game.size, tradeCounts, tradeCredits), renderFunFrame, fullSidecar(game, entries, trades, credit));
  await cut(`snake-level-${n}-short`, SHORT_W, SHORT_H, shortPlan(entries, game.size, tradeCounts), renderShortFrame, shortSidecar(game, entries, trades, credit));
} catch (e) {
  console.error(`render failed: ${(e as Error).message}`);
  process.exit(1);
}
