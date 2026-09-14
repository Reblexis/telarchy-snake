// `npm run script -- <game>`: the level's script, docs/level-video.md "The script".
import { readLevel, tradesByMove } from './level.js';
import { scriptOf } from './moments.js';

const n = Number(process.argv[2]);
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: npm run script -- <game number>');
  process.exit(2);
}
try {
  const { game, entries, trades } = await readLevel(n, {
    feedUrl: process.env.SNAKE_FEED_URL ?? 'https://snake.telarchy.com',
    telarchyUrl: process.env.TELARCHY_PUBLIC_URL ?? 'https://telarchy.com',
  });
  console.log(scriptOf(game, entries, tradesByMove(entries, trades)));
} catch (e) {
  console.error(`refused: ${(e as Error).message}`);
  process.exit(1);
}
