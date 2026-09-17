// `npm run video:all`, docs/snake.md "All levels in one video": joins the rendered full cuts of every
// complete level into videos/snake-all-levels.mp4, without re-encoding.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allLevelsPlan, allLevelsSidecar, concatArgs, concatList } from './produce.js';
import type { GameEntry } from './gamelog.js';

const feed = process.env.SNAKE_FEED_URL ?? 'https://snake.telarchy.com';
try {
  const res = await fetch(`${feed}/games`);
  if (!res.ok) throw new Error(`${feed}/games answered ${res.status}`);
  const { games } = (await res.json()) as { games: GameEntry[] };
  const plan = allLevelsPlan(games, existsSync);
  const sidecars = plan.levels.map(n => JSON.parse(readFileSync(`videos/snake-level-${n}.json`, 'utf8')) as { description: string; durationSeconds: number });
  const list = 'videos/snake-all-levels.txt', out = 'videos/snake-all-levels.mp4';
  writeFileSync(list, concatList(plan.files.map(f => resolve(f))));
  try {
    const ff = spawn('ffmpeg', concatArgs(list, out), { stdio: ['ignore', 'inherit', 'inherit'] });
    const [code] = await once(ff, 'exit');
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  } finally {
    rmSync(list, { force: true });
  }
  const seconds = sidecars.reduce((s, c) => s + c.durationSeconds, 0);
  writeFileSync('videos/snake-all-levels.json', `${JSON.stringify(allLevelsSidecar(plan.levels, sidecars.map(c => c.description.split('\n')[1] ?? ''), seconds), null, 2)}\n`);
  console.error(`wrote ${out} (levels ${plan.levels.join(', ')}, ${seconds.toFixed(0)} s)`);
} catch (e) {
  console.error(`refused: ${(e as Error).message}`);
  process.exit(1);
}
