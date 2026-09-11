import { describe, it, expect } from 'vitest';
import { GRID, newGame, step, type Cell, type Direction, type GameState } from '../src/engine.js';
import { ACTIONS, turn, type Action } from '../src/decide.js';

/**
 * docs/snake.md, "The game": every grid the snake ever plays on can be filled.
 *
 * A grid graph has a Hamiltonian cycle exactly when its number of cells is
 * even, so on an even-sided board a player who follows one such cycle eats
 * every food (the cycle passes over every free cell) and fills the board.
 * On an odd-sided board no cycle exists and no strategy guarantees it. That
 * is why the first grid is even and every game grows by two.
 *
 * The test is the proof: it builds the cycle, walks the snake along it with
 * the real engine, and asserts the game completes.
 */
function hamiltonianCycle(n: number): Cell[] {
  // Boustrophedon over columns 1..n-1, home along column 0. A cycle only
  // when n is even: an odd n ends the last row at the far side, away from
  // the column that closes it.
  const path: Cell[] = [];
  for (let y = 0; y < n; y++) {
    if (y % 2 === 0) for (let x = 1; x < n; x++) path.push({ x, y });
    else for (let x = n - 1; x >= 1; x--) path.push({ x, y });
  }
  for (let y = n - 1; y >= 0; y--) path.push({ x: 0, y });
  return path;
}

function isCycle(path: Cell[], n: number): boolean {
  if (path.length !== n * n) return false;
  const seen = new Set(path.map(c => `${c.x},${c.y}`));
  if (seen.size !== n * n) return false;
  return path.every((c, i) => {
    const d = path[(i + 1) % path.length];
    return Math.abs(c.x - d.x) + Math.abs(c.y - d.y) === 1;
  });
}

function actionTo(heading: Direction, from: Cell, to: Cell): Action {
  const want: Direction =
    to.x > from.x ? 'right' : to.x < from.x ? 'left' : to.y > from.y ? 'down' : 'up';
  const a = ACTIONS.find(x => turn(heading, x) === want);
  if (!a) throw new Error(`no action turns ${heading} into ${want}`);
  return a;
}

/** Follow the cycle from the snake's start until the grid is full. */
function fill(n: number): GameState {
  let g = newGame(() => 0, n, 1);
  const cycle = hamiltonianCycle(n);
  expect(isCycle(cycle, n)).toBe(true);
  // Orient the cycle so the snake's own neck sits behind its head on it.
  const head = g.snake[0];
  const at = (p: Cell[], c: Cell) => p.findIndex(x => x.x === c.x && x.y === c.y);
  const forward = cycle;
  const backward = [...cycle].reverse();
  const fits = (p: Cell[]) => {
    const i = at(p, head);
    const prev = p[(i - 1 + p.length) % p.length];
    return prev.x === g.snake[1].x && prev.y === g.snake[1].y;
  };
  const path = fits(forward) ? forward : backward;
  expect(fits(path)).toBe(true);
  for (let i = 0; i < n * n * n * n && !g.complete; i++) {
    const k = at(path, g.snake[0]);
    const next = path[(k + 1) % path.length];
    g = step(g, turn(g.heading, actionTo(g.heading, g.snake[0], next)), () => 0);
    expect(g.deaths).toBe(0); // a cycle never walks into a wall or into itself
  }
  return g;
}

describe('EVERY GRID THE GAME EVER USES CAN BE FILLED (docs/snake.md, "The game")', () => {
  it('the first grid is even, so it has a cycle to follow', () => {
    expect(GRID % 2).toBe(0);
    expect(GRID).toBe(4);
  });

  it('the first grid fills: the snake reaches every cell and the game completes', () => {
    const g = fill(GRID);
    expect(g.length).toBe(GRID * GRID);
    expect(g.complete).toBe(true);
  });

  it('the next three grids fill too', () => {
    for (const n of [GRID + 2, GRID + 4, GRID + 6]) {
      const g = fill(n);
      expect(g.length).toBe(n * n);
      expect(g.complete).toBe(true);
    }
  });

  it('an odd grid has no cycle to follow, which is why the game never uses one', () => {
    expect(isCycle(hamiltonianCycle(5), 5)).toBe(false);
    expect((GRID + 2) % 2).toBe(0);
  });
});
