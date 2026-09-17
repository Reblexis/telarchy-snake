// `npm run video:series -- [--music <file>] [--credit "<line>"]`, docs/level-video.md "The series cut":
// every complete level in one continuous video, a step-up screen between levels, the comparison at the end.
import { existsSync, writeFileSync } from 'node:fs';
import type { GameEntry } from './gamelog.js';
import { momentsOf } from './moments.js';
import { fullTimeline, TL_FPS, type Segment } from './timeline.js';
import { frameCountOf } from './frames.js';
import { buildScene, drawFull, drawSeriesEnd, FULL_SIZE, SERIES_END_FRAMES, type Scene, type SeriesEnd } from './draw.js';
import { productionFrames } from './produce.js';
import { decodeMusic, loadLevel, renderVideo } from './render.js';
import { levelBudgetFrames, levelStats, seriesSidecar, stepUpScreen, topTradersOverall, whatChanged } from './series.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const musicPath = flag('--music'), credit = flag('--credit');
const musicPaths = musicPath ? musicPath.split(',').map(x => x.trim()).filter(Boolean) : [];
for (const m of musicPaths) if (!existsSync(m)) { console.error(`refused: no music file at ${m}`); process.exit(1); }
if (!musicPath) console.error('no --music: the video is silent');

try {
  const feed = process.env.SNAKE_FEED_URL ?? 'https://snake.telarchy.com';
  const res = await fetch(`${feed}/games`);
  if (!res.ok) throw new Error(`${feed}/games answered ${res.status}`);
  const complete = ((await res.json()) as { games: GameEntry[] }).games.filter(g => g.endedAt && !g.partial).sort((a, b) => a.number - b.number);
  if (complete.length === 0) throw new Error('no complete level to show');

  const levels: Array<{ scene: Scene; tl: Segment[] }> = [];
  const stats = [], allTrades = [];
  for (let k = 0; k < complete.length; k++) {
    const g = complete[k], next = complete[k + 1];
    const { game, games, entries, trades, byMove } = await loadLevel(g.number);
    const tl = fullTimeline(entries, game.size, byMove, momentsOf(entries, game.size, byMove), {
      opening: k === 0, credits: false, maxFrames: levelBudgetFrames(game.size),
      stepUp: next ? stepUpScreen(game.number, next.number, next.size) : null,
    });
    levels.push({ scene: buildScene(game, games, entries, byMove), tl });
    stats.push(levelStats(game, entries, trades));
    allTrades.push(trades);
    console.error(`level ${game.number}: ${tl.length} segments, ${(frameCountOf(tl) / TL_FPS).toFixed(1)} s`);
  }
  const end: SeriesEnd = { levels: stats, changed: whatChanged(stats), top: topTradersOverall(allTrades) };
  const endScreens = (Object.keys(SERIES_END_FRAMES) as Array<keyof typeof SERIES_END_FRAMES>).filter(s => s !== 'changed' || end.changed.length > 0);
  const total = levels.reduce((a, l) => a + frameCountOf(l.tl), 0) + endScreens.reduce((a, s) => a + SERIES_END_FRAMES[s], 0);
  function* frames(): Generator<Buffer> {
    for (const l of levels) yield* productionFrames(l.scene, l.tl, drawFull);
    for (const s of endScreens) for (let f = 0; f < SERIES_END_FRAMES[s]; f++) yield drawSeriesEnd(end, s, f).buffer;
  }
  console.error(`snake-series: ${levels.length} levels, ${total} frames, ${(total / TL_FPS).toFixed(1)} s`);
  const out = await renderVideo('snake-series', FULL_SIZE, total, frames(), musicPaths.length ? await Promise.all(musicPaths.map(decodeMusic)) : null);
  const sidecar = seriesSidecar(stats, total / TL_FPS);
  writeFileSync('videos/snake-series.json', `${JSON.stringify(credit ? { ...sidecar, description: `${sidecar.description}\n${credit}` } : sidecar, null, 2)}\n`);
  console.error(`wrote ${out} and videos/snake-series.json`);
} catch (e) {
  console.error(`refused: ${(e as Error).message}`);
  process.exit(1);
}
