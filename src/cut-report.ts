// Where a level's full cut spends its time, docs/snake.md "The fun cuts":
// `npm run cut-report -- <game>` prints the kept and boring moves and the chosen speed.
import { readLevel, tradesByMove } from './level.js';
import { cutReport } from './fun.js';

const n = Number(process.argv[2]);
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: npm run cut-report -- <game number>');
  process.exit(2);
}
try {
  const { game, entries, trades } = await readLevel(n, {
    feedUrl: process.env.SNAKE_FEED_URL ?? 'https://snake.telarchy.com',
    telarchyUrl: process.env.TELARCHY_PUBLIC_URL ?? 'https://telarchy.com',
  });
  const byMove = tradesByMove(entries, trades);
  console.log(`level ${n} (${game.size}x${game.size})`);
  console.log(cutReport(entries, game.size, byMove.map(l => l.length), byMove.map(l => l.reduce((a, r) => a + Math.abs(Number(r.detail?.cost) || 0), 0))));
} catch (e) {
  console.error(`refused: ${(e as Error).message}`);
  process.exit(1);
}
