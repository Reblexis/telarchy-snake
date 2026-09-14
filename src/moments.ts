// The story of a level, found in its record: docs/level-video.md "Moments" and "The script".
import type { GameEntry, LogStep } from './gamelog.js';
import type { TradeRow } from './level.js';
import { ACTIONS, turn } from './decide.js';
import { attempts, fxOf } from './fun.js';
import { span } from './frame.js';

export type MomentKind = 'near miss' | 'whale' | 'crowd' | 'tie' | 'new best' | 'record crash' | 'milestone' | 'fill';
export interface Moment { move: number; at: string; kinds: MomentKind[]; weight: number; credits: number; traders: number }

const DELTA: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const NEAR_MISS_MIN_LENGTH = 6;
const WHALE_CREDITS = 300;
const CROWD_TRADERS = 3;

/** How many of the three options would not have killed the snake from `prev`. */
export function survivableOptions(prev: LogStep, size: number): number {
  const head = prev.snake[0];
  if (!head) return 0;
  return ACTIONS.filter(a => {
    const [dx, dy] = DELTA[turn(prev.heading, a)];
    const nx = head.x + dx, ny = head.y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) return false;
    const eats = !!prev.food && prev.food.x === nx && prev.food.y === ny;
    // the tail moves away unless the snake eats
    const blockers = eats ? prev.snake : prev.snake.slice(0, -1);
    return !blockers.some(c => c.x === nx && c.y === ny);
  }).length;
}

/** Every moment of a level, in order. `byMove[i]` holds the trades of the move from entry i to i + 1. */
export function momentsOf(entries: LogStep[], size: number, byMove: TradeRow[][]): Moment[] {
  const list = attempts(entries, size);
  const out: Moment[] = [];
  let best = entries[0]?.length ?? 0;
  let a = 0;
  for (let i = 1; i < entries.length; i++) {
    while (a < list.length - 1 && i > list[a].end) a++;
    const prev = entries[i - 1], cur = entries[i];
    const trades = byMove[i - 1] ?? [];
    const credits = trades.reduce((sum, r) => sum + Math.abs(Number(r.detail?.cost) || 0), 0);
    const traders = new Set(trades.map(r => r.actor?.handle ?? r.actor?.id ?? '?')).size;
    const died = cur.deaths > prev.deaths;
    const eats = !died && cur.length > prev.length;
    const fx = fxOf(entries, i, size);
    const kinds: MomentKind[] = [];
    let weight = 0;
    if (!died && prev.length >= NEAR_MISS_MIN_LENGTH && survivableOptions(prev, size) === 1) { kinds.push('near miss'); weight += 5; }
    if (credits >= WHALE_CREDITS) { kinds.push('whale'); weight += Math.log2(credits) - 5; }
    if (traders >= CROWD_TRADERS) { kinds.push('crowd'); weight += 2; }
    const prices = ACTIONS.map(x => cur.prices[x]).filter((v): v is number => v !== null && Number.isFinite(v)).sort((x, y) => y - x);
    if (prices.length === 3 && prices[0] - prices[1] <= 0.5 && prices[1] - prices[2] >= 5) { kinds.push('tie'); weight += 2; }
    if (eats && cur.length > best) { kinds.push('new best'); weight += 3; }
    if (fx === 'death' && list[a].record) { kinds.push('record crash'); weight += 4; }
    if (eats && cur.length % 10 === 0) { kinds.push('milestone'); weight += 2; }
    if (fx === 'fill') { kinds.push('fill'); weight += 10; }
    best = Math.max(best, cur.length);
    if (kinds.length) out.push({ move: i, at: cur.at, kinds, weight, credits, traders });
  }
  return out;
}

/** The level's script: one line for the level, then every moment, the strongest ten marked with a star. */
export function scriptOf(game: GameEntry, entries: LogStep[], byMove: TradeRow[][]): string {
  const moments = momentsOf(entries, game.size, byMove);
  const strongest = new Set([...moments].sort((x, y) => y.weight - x.weight || x.move - y.move).slice(0, 10).map(m => m.move));
  const all = byMove.flat();
  const traders = new Set(all.map(r => r.actor?.handle ?? '?')).size;
  const start = Date.parse(game.startedAt);
  const moves = entries.length - 1;
  const lines = [
    `level ${game.number} (${game.size}x${game.size}): ${moves} moves, ${attempts(entries, game.size).length} attempts, ${entries[entries.length - 1]?.deaths ?? 0} deaths, ${all.length} trades by ${traders} traders, ${span(Date.parse(game.endedAt ?? game.startedAt) - start)}`,
    `${moments.length} moments, the strongest ten starred:`,
  ];
  for (const m of moments) {
    const extra = [m.credits ? `${Math.round(m.credits).toLocaleString('en-US')} cr` : '', m.traders >= 2 ? `${m.traders} traders` : ''].filter(Boolean).join(', ');
    lines.push(`${strongest.has(m.move) ? '*' : ' '} move ${m.move}  +${span(Date.parse(m.at) - start)}  ${m.kinds.join(', ')}  (weight ${m.weight.toFixed(1)}${extra ? `; ${extra}` : ''})`);
  }
  return lines.join('\n');
}
