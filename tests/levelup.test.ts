import { describe, it, expect } from 'vitest';
import { GRID, newGame, type Cell, type Direction } from '../src/engine.js';
import { ACTIONS, turn, type Action, type Quotes } from '../src/decide.js';
import { Operator, type ProposalRef, type TelarchyClient } from '../src/operator.js';

/**
 * docs/snake.md, "The game": filling the grid ends the game, and after the
 * cooldown the next one is played on a grid two cells larger. This test
 * plays a whole game through the operator, board full, and watches it level
 * up: nothing is forced, the snake is driven by the market's own prices.
 */
function cycle(n: number): Cell[] {
  const path: Cell[] = [];
  for (let y = 0; y < n; y++) {
    if (y % 2 === 0) for (let x = 1; x < n; x++) path.push({ x, y });
    else for (let x = n - 1; x >= 1; x--) path.push({ x, y });
  }
  for (let y = n - 1; y >= 0; y--) path.push({ x: 0, y });
  return path;
}

describe('A FILLED GRID LEVELS UP (docs/snake.md, "The game")', () => {
  it('the snake fills the board, the game completes, and after the cooldown the next game is two cells larger', async () => {
    const rng = () => 0;
    let op!: Operator;
    const calls: string[] = [];
    const ranges: number[] = [];
    let n = 0;
    // The market always prices the option that follows the cycle highest, so
    // the operator's own rule (highest price wins) walks the board.
    const wanted = (): Action => {
      const g = op.game;
      const path = cycle(g.size);
      const at = (c: Cell) => path.findIndex(p => p.x === c.x && p.y === c.y);
      const fwd = path;
      const back = [...path].reverse();
      const fits = (p: Cell[]) => {
        const i = at2(p, g.snake[0]);
        const prev = p[(i - 1 + p.length) % p.length];
        return g.snake.length < 2 || (prev.x === g.snake[1].x && prev.y === g.snake[1].y);
      };
      const at2 = (p: Cell[], c: Cell) => p.findIndex(q => q.x === c.x && q.y === c.y);
      void at;
      const p = fits(fwd) ? fwd : back;
      const k = at2(p, g.snake[0]);
      const next = p[(k + 1) % p.length];
      const want: Direction =
        next.x > g.snake[0].x ? 'right' : next.x < g.snake[0].x ? 'left' : next.y > g.snake[0].y ? 'down' : 'up';
      return ACTIONS.find(a => turn(g.heading, a) === want) ?? 'forward';
    };
    const client: TelarchyClient = {
      async postProposal(_t, _d, _by, _o): Promise<ProposalRef> {
        calls.push('post');
        return { id: `p${++n}`, number: n, title: 't', url: `u/${n}`, options: {} as never };
      },
      async readQuotes(): Promise<Quotes> {
        const best = wanted();
        const q = {} as Quotes;
        for (const a of ACTIONS) q[a] = { m60: { price: a === best ? 9 : 1, lead: a === best ? 8 : -8 } };
        return q;
      },
      async approveOption() { calls.push('approve'); },
      async declineProposal() { calls.push('decline'); },
      async postReading() {},
      async settleMetric() { calls.push('settle'); },
      async refreshBooks() {},
      async setHorizon() {},
      async setRange(max) { ranges.push(max); },
      async setMetricDescription() {},
      async readActivity() { return {}; },
      async readLeaderboard() { return []; },
    };
    op = new Operator(client, newGame(rng, GRID, 1), rng);
    let t = Date.parse('2026-09-11T10:00:00Z');
    await op.openStep(new Date(t));
    for (let i = 0; i < 2000 && !op.game.complete; i++) {
      await op.closeStep(new Date(t + 58_000));
      t += 60_000;
      await op.tick(new Date(t));
    }
    // The board is full: every cell is snake, and the game says so.
    expect(op.game.length).toBe(GRID * GRID);
    expect(op.game.complete).toBe(true);
    expect(op.game.deaths).toBe(0);
    expect(calls).toContain('settle'); // the attempt's answer is known
    // The cooldown: no proposals while it runs.
    const posts = calls.filter(c => c === 'post').length;
    await op.tick(new Date(t + 60_000));
    expect(calls.filter(c => c === 'post').length).toBe(posts);
    // After the five-minute cooldown: the range is the new full grid, and the
    // game levels up.
    await op.tick(new Date(t + 6 * 60_000));
    expect(ranges).toEqual([(GRID + 2) * (GRID + 2)]);
    expect(op.game.size).toBe(GRID + 2);
    expect(op.game.gameNumber).toBe(2);
    expect(op.game.length).toBe(2);
    expect(op.game.complete).toBe(false);
    expect(calls.filter(c => c === 'post').length).toBeGreaterThan(posts);
  });
});
