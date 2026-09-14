// Level video maker, docs/snake.md "The level videos": `npm run video -- <game>`
// reads one complete game from public reads, draws every entry as the stream
// frame, and pipes the frames to ffmpeg. Writes videos/snake-level-<game>.mp4
// and its sidecar .json; nothing is written when the game is refused.
import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { renderFrame, WIDTH, HEIGHT } from './frame.js';
import { FPS, holds, readLevel, sidecar, tradesByMove, videoState } from './level.js';

const n = Number(process.argv[2]);
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: npm run video -- <game number>');
  process.exit(2);
}

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
const ctx = { game, games, entries, byMove: tradesByMove(entries, trades) };
const hold = holds(entries);
mkdirSync('videos', { recursive: true });
const out = `videos/snake-level-${n}.mp4`;
const part = `${out}.part.mp4`;
console.error(`game ${n}: ${entries.length} entries, ${trades.length} trades, ${hold.reduce((a, b) => a + b, 0) / FPS}s of video`);

const ff = spawn('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${WIDTH}x${HEIGHT}`, '-r', String(FPS), '-i', 'pipe:0',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', part,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const exited = once(ff, 'exit');

try {
  for (let i = 0; i < entries.length; i++) {
    const { state, now } = videoState(ctx, i);
    const frame = renderFrame(state, now);
    for (let k = 0; k < hold[i]; k++) {
      if (!ff.stdin.write(frame)) await once(ff.stdin, 'drain');
    }
    if (i % 250 === 0) console.error(`frame ${i}/${entries.length}`);
  }
  ff.stdin.end();
} catch (e) {
  console.error(`render failed: ${(e as Error).message}`);
  ff.kill();
  rmSync(part, { force: true });
  process.exit(1);
}

const [code] = await exited;
if (code !== 0) {
  rmSync(part, { force: true });
  console.error(`ffmpeg exited ${code}`);
  process.exit(1);
}
renameSync(part, out);
writeFileSync(`videos/snake-level-${n}.json`, `${JSON.stringify(sidecar(game, entries, trades), null, 2)}\n`);
console.error(`wrote ${out} and videos/snake-level-${n}.json`);
