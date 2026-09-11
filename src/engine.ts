// The game, docs/snake.md "The game". Pure: a state in, a state out.
/** The first game's grid; each later game is one larger (GameState.size). */
export const GRID = 12;

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
  /** This game's grid, size by size cells. */
  size: number;
  /** 1 for the first game, counting up as games complete. */
  gameNumber: number;
}

export type Rng = () => number; // returns a non-negative integer or a float in [0,1)

const DELTA: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function startSnake(size: number): Cell[] {
  const c = Math.floor(size / 2);
  return [{ x: c, y: c }, { x: c - 1, y: c }];
}

function occupied(snake: Cell[], c: Cell): boolean {
  return snake.some(s => s.x === c.x && s.y === c.y);
}

/** A random free cell. The rng may return an integer index or a float; both
 *  are mapped onto the grid, and a cell under the snake is rejected and the
 *  rng asked again (bounded by scanning forward from the pick, so a
 *  degenerate rng still terminates). */
export function spawnFood(snake: Cell[], rng: Rng, size: number = GRID): Cell {
  const total = size * size;
  const raw = rng();
  let idx = Number.isInteger(raw) ? raw : Math.floor(raw * total);
  idx = ((idx % total) + total) % total;
  for (let i = 0; i < total; i++) {
    const k = (idx + i) % total;
    const c = { x: k % size, y: Math.floor(k / size) };
    if (!occupied(snake, c)) return c;
  }
  return { x: 0, y: 0 }; // unreachable while the snake is shorter than the grid
}

export function newGame(rng: Rng, size: number = GRID, gameNumber: number = 1): GameState {
  const snake = startSnake(size);
  return { snake, heading: 'right', food: spawnFood(snake, rng, size), length: 2, step: 0, deaths: 0, complete: false, size, gameNumber };
}

export function step(g: GameState, dir: Direction, rng: Rng = Math.random): GameState {
  if (g.complete) return g;
  const size = g.size ?? GRID;
  const head = g.snake[0];
  const d = DELTA[dir];
  const next = { x: head.x + d.x, y: head.y + d.y };
  const hitsWall = next.x < 0 || next.y < 0 || next.x >= size || next.y >= size;
  const eats = next.x === g.food.x && next.y === g.food.y;
  // The tail moves away this step unless the snake grows, so its cell is free.
  const body = eats ? g.snake : g.snake.slice(0, -1);
  const hitsSelf = occupied(body, next);
  if (hitsWall || hitsSelf) {
    const snake = startSnake(size);
    return { snake, heading: 'right', food: spawnFood(snake, rng, size), length: 2, step: g.step + 1, deaths: g.deaths + 1, complete: false, size, gameNumber: g.gameNumber ?? 1 };
  }
  const snake = [next, ...body];
  const complete = snake.length >= size * size;
  const food = complete ? g.food : eats ? spawnFood(snake, rng, size) : g.food;
  return { snake, heading: dir, food, length: snake.length, step: g.step + 1, deaths: g.deaths, complete, size, gameNumber: g.gameNumber ?? 1 };
}
