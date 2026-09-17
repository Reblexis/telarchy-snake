// Level video maker, docs/level-video.md and docs/snake.md "The level videos":
// `npm run video -- <game> [--music <file>] [--credit "<line>"] [--only full|short]` reads one complete
// game from public reads and writes the produced full cut and Short, each with its sidecar.
// Nothing is written when the game is refused.
import { existsSync, writeFileSync } from 'node:fs';
import { momentsOf } from './moments.js';
import { fullTimeline, shortTimeline, TL_FPS } from './timeline.js';
import { frameCountOf } from './frames.js';
import { buildScene, drawFull, drawShort, FULL_SIZE, SHORT_SIZE } from './draw.js';
import { cutSidecar, productionFrames } from './produce.js';
import { decodeMusic, loadLevel, renderVideo } from './render.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const n = Number(argv[0]);
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: npm run video -- <game number> [--music <audio file>] [--credit "<line>"] [--only full|short]');
  process.exit(2);
}
const musicPath = flag('--music');
const credit = flag('--credit');
const only = flag('--only');
if (musicPath && !existsSync(musicPath)) {
  console.error(`refused: no music file at ${musicPath}`);
  process.exit(1);
}
if (!musicPath) console.error('no --music: the cuts are silent');

let level;
try {
  level = await loadLevel(n);
} catch (e) {
  console.error(`refused: ${(e as Error).message}`);
  process.exit(1);
}
const { game, games, entries, trades, byMove } = level;
const moments = momentsOf(entries, game.size, byMove);
const scene = buildScene(game, games, entries, byMove);

async function cut(kind: 'full' | 'short', music: Float32Array | null) {
  const name = kind === 'full' ? `snake-level-${n}` : `snake-level-${n}-short`;
  const tl = kind === 'full' ? fullTimeline(entries, game.size, byMove, moments) : shortTimeline(entries, game.size, byMove, moments);
  const total = frameCountOf(tl);
  console.error(`${name}: ${tl.length} segments, ${total} frames, ${(total / TL_FPS).toFixed(1)} s`);
  const out = await renderVideo(name, kind === 'full' ? FULL_SIZE : SHORT_SIZE, total, productionFrames(scene, tl, kind === 'full' ? drawFull : drawShort), music);
  writeFileSync(`videos/${name}.json`, `${JSON.stringify(cutSidecar(kind, game, entries, trades, tl, credit), null, 2)}\n`);
  console.error(`wrote ${out} and videos/${name}.json`);
}

try {
  const music = musicPath ? await decodeMusic(musicPath) : null;
  if (only !== 'short') await cut('full', music);
  if (only !== 'full') await cut('short', music);
} catch (e) {
  console.error(`render failed: ${(e as Error).message}`);
  process.exit(1);
}
