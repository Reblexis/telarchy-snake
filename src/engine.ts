// The game, docs/snake.md "The game". Pure: a state in, a state out.
export const GRID = 20;

export type Direction = 'up' | 'right' | 'down' | 'left';
export interface Cell { x: number; y: number }
export interface GameState {
  snake: Cell[]; // head first
  heading: Direction;
  food: Cell;
  length: number;
  step: number;
  deaths: number;
  /** The grid is full: the game is over and nothing changes any more. */
  complete: boolean;
}

export type Rng = () => number; // returns a non-negative integer or a float in [0,1)

const DELTA: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function startSnake(): Cell[] {
  const c = GRID / 2;
  return [{ x: c, y: c }];
}

function occupied(snake: Cell[], c: Cell): boolean {
  return snake.some(s => s.x === c.x && s.y === c.y);
}

/** A random free cell. The rng may return an integer index or a float; both
 *  are mapped onto the grid, and a cell under the snake is rejected and the
 *  rng asked again (bounded by scanning forward from the pick, so a
 *  degenerate rng still terminates). */
export function spawnFood(snake: Cell[], rng: Rng): Cell {
  const total = GRID * GRID;
  const raw = rng();
  let idx = Number.isInteger(raw) ? raw : Math.floor(raw * total);
  idx = ((idx % total) + total) % total;
  for (let i = 0; i < total; i++) {
    const k = (idx + i) % total;
    const c = { x: k % GRID, y: Math.floor(k / GRID) };
    if (!occupied(snake, c)) return c;
  }
  return { x: 0, y: 0 }; // unreachable: a 400-cell grid is never full
}

export function newGame(rng: Rng): GameState {
  const snake = startSnake();
  return { snake, heading: 'right', food: spawnFood(snake, rng), length: 1, step: 0, deaths: 0, complete: false };
}

export function step(g: GameState, dir: Direction, rng: Rng = Math.random): GameState {
  if (g.complete) return g;
  const head = g.snake[0];
  const d = DELTA[dir];
  const next = { x: head.x + d.x, y: head.y + d.y };
  const hitsWall = next.x < 0 || next.y < 0 || next.x >= GRID || next.y >= GRID;
  const eats = next.x === g.food.x && next.y === g.food.y;
  // The tail moves away this step unless the snake grows, so its cell is free.
  const body = eats ? g.snake : g.snake.slice(0, -1);
  const hitsSelf = occupied(body, next);
  if (hitsWall || hitsSelf) {
    const snake = startSnake();
    return { snake, heading: 'right', food: spawnFood(snake, rng), length: 1, step: g.step + 1, deaths: g.deaths + 1, complete: false };
  }
  const snake = [next, ...body];
  const complete = snake.length >= GRID * GRID;
  const food = complete ? g.food : eats ? spawnFood(snake, rng) : g.food;
  return { snake, heading: dir, food, length: snake.length, step: g.step + 1, deaths: g.deaths, complete };
}
