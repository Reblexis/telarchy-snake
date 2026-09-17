// The series cut, docs/level-video.md "The series cut: every level in one continuous video":
// the pure parts. What each level's budget is, what the screen between two levels says, a
// level's figures, and what changed across levels, measured and never asserted.
import type { GameEntry, LogStep } from './gamelog.js';
import type { TradeRow } from './level.js';
import { span } from './frame.js';
import { TL_FPS } from './timeline.js';

/** A level's share of the series: 40 + 1.7 x cells seconds, at most 150. */
export function levelBudgetFrames(size: number): number {
  return Math.round(Math.min(150, 40 + 1.7 * size * size) * TL_FPS);
}

export const STEP_UP_FRAMES = 105;
const STEP_UP_FIRST: Record<number, string> = { 2: "Let's step it up a notch.", 3: 'Too easy.', 4: 'Bigger again.' };
/** The screen between two levels: the level just filled, then the one that follows. */
export function stepUpScreen(filled: number, next: number, size: number): { label: string; lines: string[]; gold: string } {
  const grid = `${size}×${size}`;
  return {
    label: `LEVEL ${filled} FILLED`,
    lines: [STEP_UP_FIRST[next] ?? 'And again.', next === 2 ? `How about a ${grid} grid?` : `${grid}: ${size * size} cells to fill.`],
    gold: grid,
  };
}

export interface LevelStats { level: number; size: number; cells: number; span: string; moves: number; deaths: number; trades: number; traders: number; credits: number }

const creditsOf = (t: TradeRow) => Math.abs(Number(t.detail?.cost) || 0);

export function levelStats(game: GameEntry, entries: LogStep[], trades: TradeRow[]): LevelStats {
  return {
    level: game.number,
    size: game.size,
    cells: game.size * game.size,
    span: span(Date.parse(game.endedAt ?? game.startedAt) - Date.parse(game.startedAt)),
    moves: Math.max(0, entries.length - 1),
    deaths: entries[entries.length - 1]?.deaths ?? 0,
    trades: trades.length,
    traders: new Set(trades.map(t => t.actor?.handle ?? t.actor?.id ?? '?')).size,
    credits: Math.round(trades.reduce((a, t) => a + creditsOf(t), 0) * 10) / 10,
  };
}

/** What changed across the levels: each rate level by level, read as fell, rose or held (a fifth or more apart). */
export function whatChanged(levels: LevelStats[]): string[] {
  if (levels.length < 2) return [];
  const per = (a: number, b: number) => (b > 0 ? a / b : 0);
  const rates: Array<[string, (s: LevelStats) => number, number]> = [
    ['Deaths per cell filled', s => per(s.deaths, s.cells), 1],
    ['Trades per move', s => per(s.trades, s.moves), 1],
    ['Credits traded per move', s => per(s.credits, s.moves), 0],
    ['Moves per cell filled', s => per(s.moves, s.cells), 1],
  ];
  return rates.map(([name, rate, digits]) => {
    const values = levels.map(rate);
    const first = values[0], last = values[values.length - 1];
    const apart = Math.abs(last - first) >= 0.2 * Math.max(Math.abs(first), Math.abs(last)) && first !== last;
    const reading = !apart ? 'held' : last < first ? 'fell' : 'rose';
    return `${name} ${reading}: ${values.map(v => v.toFixed(digits)).join(' → ')}`;
  });
}

/** The traders who traded the most credits over all levels, five at most. */
export function topTradersOverall(perLevel: TradeRow[][]): Array<{ handle: string; credits: number }> {
  const totals = new Map<string, number>();
  for (const t of perLevel.flat()) {
    const h = t.actor?.handle ?? '?';
    totals.set(h, (totals.get(h) ?? 0) + creditsOf(t));
  }
  return [...totals.entries()].map(([handle, credits]) => ({ handle, credits })).sort((a, b) => b.credits - a.credits || (a.handle < b.handle ? -1 : 1)).slice(0, 5);
}

export function seriesSidecar(levels: LevelStats[], durationSeconds: number) {
  return {
    title: `A prediction market plays snake: levels ${levels[0].level} to ${levels[levels.length - 1].level}`,
    description: [
      'A prediction market played these games of snake. Every minute three options (continue, turn left, turn right) were priced by traders on telarchy.com, and the highest price was the move.',
      ...levels.map(s => `Level ${s.level} on a ${s.size}x${s.size} grid: ${s.moves} moves over ${s.span}, ${s.deaths} deaths, ${s.trades} trades by ${s.traders} traders.`),
      'Trade the next move: https://telarchy.com/snake',
      'Watch it live: https://www.twitch.tv/telarchy',
    ].join('\n'),
    levels: levels.map(s => s.level),
    durationSeconds,
  };
}
