// The commentary line, docs/snake.md "The board": one sentence written by a
// fixed rule set from /state alone, no model. Rules are tried in order and
// the first that applies wins; every line is plain, left-aligned prose.
import { ACTION_TITLE, type Action } from './decide.js';
import type { Direction } from './engine.js';

interface CommentaryInput {
  game: { snake: { x: number; y: number }[]; heading: string; food: { x: number; y: number }; length: number; deaths: number; complete: boolean; size?: number; gameNumber?: number };
  grid?: number;
  gameNumber?: number;
  complete: boolean;
  nextGameAt?: string | null;
  bestLength?: number;
  open?: { step: number } | null;
  next?: { action: Action; direction: Direction; decided: boolean; seconds: number } | null;
  traders?: { handle: string }[];
  recentTrades?: { step: number }[];
  recentDecisions?: { lengthBefore: number; lengthAfter: number | null }[];
}

const DELTA: Record<string, { x: number; y: number }> = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

const cells = (n: number) => `${n} cell${n === 1 ? '' : 's'}`;
const move = (a: Action, d: Direction) => `${ACTION_TITLE[a].toLowerCase()} (${d})`;

export function commentary(s: CommentaryInput, now: Date): string {
  const g = s.game;
  const N = s.grid ?? g.size ?? 12;
  const gameNo = s.gameNumber ?? g.gameNumber ?? 1;

  if (s.complete || g.complete) {
    const wait = s.nextGameAt ? Math.max(0, Math.round((Date.parse(s.nextGameAt) - now.getTime()) / 60_000)) : null;
    return `Game ${gameNo} complete at length ${g.length}: next game on a ${N + 1} by ${N + 1} grid${wait === null ? ' after an hour' : ` in ${wait} min`}.`;
  }

  const recent = s.recentDecisions ?? [];
  for (let i = 0; i < Math.min(2, recent.length); i++) {
    const d = recent[i];
    if (d.lengthAfter !== null && d.lengthAfter < d.lengthBefore) {
      return `Death #${g.deaths} ${i === 0 ? 'last step' : 'two steps ago'}: back to length 2 (was ${d.lengthBefore}).`;
    }
  }

  const last = recent[0];
  if (last && last.lengthAfter === g.length && last.lengthAfter > last.lengthBefore && g.length === (s.bestLength ?? 0) && g.length > 2) {
    return `New record length ${g.length}, the longest this game.`;
  }

  const next = s.next ?? null;
  if (!next || !s.open) return `Waiting for the next step: the snake is ${g.length} long, heading ${g.heading}.`;

  const head = g.snake[0];
  const d = DELTA[next.direction];
  const ahead = { x: head.x + d.x, y: head.y + d.y };
  const wall = ahead.x < 0 || ahead.y < 0 || ahead.x >= N || ahead.y >= N;
  const body = g.snake.slice(0, -1).some(c => c.x === ahead.x && c.y === ahead.y);
  if (wall || body) return `Careful: ${move(next.action, next.direction)} hits ${wall ? 'the wall' : 'its own body'} next move.`;

  if (next.decided) return `Decided: ${move(next.action, next.direction)} at the top of the minute.`;

  const traded = (s.traders ?? []).length > 0 || (s.recentTrades ?? []).some(t => t.step === s.open!.step);
  if (!traded) {
    return next.action === 'forward'
      ? `Nobody has traded step ${s.open.step} yet: forward it is.`
      : `Nobody has traded step ${s.open.step} yet: the books alone lean ${move(next.action, next.direction)}.`;
  }

  const dx = g.food.x - head.x, dy = g.food.y - head.y;
  const parts: string[] = [];
  if (dy !== 0) parts.push(`${cells(Math.abs(dy))} ${dy < 0 ? 'up' : 'down'}`);
  if (dx !== 0) parts.push(`${cells(Math.abs(dx))} ${dx < 0 ? 'left' : 'right'}`);
  const where = parts.length ? parts.join(' and ') : 'right here';
  return `Food is ${where}: the market leans ${move(next.action, next.direction)}.`;
}
