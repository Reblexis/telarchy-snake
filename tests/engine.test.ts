import { describe, it, expect } from 'vitest';
import { newGame, step, GRID, type Direction, type GameState } from '../src/engine.js';

function rng(seq: number[]) {
  let i = 0;
  return () => seq[i++ % seq.length];
}

describe('the game (docs/snake.md, "The game")', () => {
  it('starts at the centre with length 2, heading right, one food on a free cell', () => {
    const g = newGame(rng([0]));
    expect(GRID).toBe(12);
    expect(g.size).toBe(12);
    expect(g.gameNumber).toBe(1);
    expect(g.snake).toEqual([{ x: 6, y: 6 }, { x: 5, y: 6 }]);
    expect(g.heading).toBe('right');
    expect(g.snake.some(s => s.x === g.food.x && s.y === g.food.y)).toBe(false);
    expect(g.deaths).toBe(0);
    expect(g.length).toBe(2);
    expect(g.complete).toBe(false);
  });

  it('moves one cell per step in the chosen direction and keeps its length', () => {
    const g = newGame(rng([0]));
    const g2 = step(g, 'up');
    expect(g2.snake[0]).toEqual({ x: 6, y: 5 });
    expect(g2.snake.length).toBe(2);
    expect(g2.heading).toBe('up');
    expect(g2.length).toBe(2);
  });

  it('eating food grows the snake by one and spawns new food on a free cell', () => {
    let g = newGame(rng([0]));
    g = { ...g, food: { x: 7, y: 6 } };
    const g2 = step(g, 'right');
    expect(g2.snake.length).toBe(3);
    expect(g2.length).toBe(3);
    expect(g2.food).not.toEqual({ x: 7, y: 6 });
    expect(g2.snake.some(s => s.x === g2.food.x && s.y === g2.food.y)).toBe(false);
  });

  it('hitting a wall is a death: respawn at once at length 2 in the starting state, deaths counted', () => {
    let g = newGame(rng([0]));
    g = { ...g, snake: [{ x: 11, y: 6 }, { x: 10, y: 6 }, { x: 9, y: 6 }], heading: 'right', length: 3 };
    const g2 = step(g, 'right');
    expect(g2.deaths).toBe(1);
    expect(g2.snake).toEqual([{ x: 6, y: 6 }, { x: 5, y: 6 }]);
    expect(g2.heading).toBe('right');
    expect(g2.length).toBe(2);
  });

  it('hitting its own body is a death', () => {
    let g = newGame(rng([0]));
    // A 5-long snake curled so that moving left runs into its own body.
    g = {
      ...g,
      snake: [{ x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 7 }, { x: 5, y: 6 }, { x: 5, y: 5 }],
      heading: 'up',
      length: 5,
    };
    const g2 = step(g, 'left');
    expect(g2.deaths).toBe(1);
    expect(g2.length).toBe(2);
  });

  it('reversing into the second segment is a death like any other', () => {
    let g = newGame(rng([0]));
    g = { ...g, snake: [{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }], length: 3 };
    const g2 = step(g, 'left');
    expect(g2.deaths).toBe(1);
    expect(g2.length).toBe(2);
  });

  it('the starting length-2 snake reversing enters its tail cell, which the tail vacates the same step: no death', () => {
    const g = newGame(rng([0]));
    const g2 = step(g, 'left');
    expect(g2.deaths).toBe(0);
    expect(g2.snake[0]).toEqual({ x: 5, y: 6 });
  });

  it('the tail cell is free to move into (the tail moves away the same step)', () => {
    let g = newGame(rng([0]));
    // Square of 4: head at (10,10), body (11,10), (11,11), tail (10,11). Moving down enters the tail cell.
    g = { ...g, snake: [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 7, y: 7 }, { x: 6, y: 7 }], heading: 'left', length: 4 };
    const g2 = step(g, 'down');
    expect(g2.deaths).toBe(0);
    expect(g2.snake[0]).toEqual({ x: 6, y: 7 });
  });

  it('food never spawns on the snake even when the rng keeps pointing at it', () => {
    let g = newGame(rng([78, 78, 78, 0]));
    g = { ...g, food: { x: 7, y: 6 } };
    const g2 = step(g, 'right');
    expect(g2.snake.some(s => s.x === g2.food.x && s.y === g2.food.y)).toBe(false);
  });

  it('counts steps', () => {
    const g = newGame(rng([0]));
    expect(g.step).toBe(0);
    expect(step(step(g, 'up'), 'up').step).toBe(2);
  });

  it('death resets length to 2 but keeps deaths and steps', () => {
    let g = newGame(rng([0]));
    g = { ...g, snake: [{ x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }], heading: 'left', length: 4, step: 7, deaths: 2 };
    const g2 = step(g, 'left');
    expect(g2.deaths).toBe(3);
    expect(g2.step).toBe(8);
    expect(g2.length).toBe(2);
  });

  it('a later game is one cell larger, numbered, starts at the centre at length 2', () => {
    const g = newGame(rng([0]), 13, 2);
    expect(g.size).toBe(13);
    expect(g.gameNumber).toBe(2);
    expect(g.snake[0]).toEqual({ x: 6, y: 6 });
    expect(g.length).toBe(2);
    // the far wall is at 12 on a 13-grid
    let h = { ...g, snake: [{ x: 12, y: 6 }, { x: 11, y: 6 }], heading: 'right' as Direction };
    expect(step(h, 'right').deaths).toBe(1);
    h = { ...g, snake: [{ x: 11, y: 6 }, { x: 10, y: 6 }], heading: 'right' as Direction };
    expect(step(h, 'right').deaths).toBe(0);
  });

  it('death on a larger grid respawns on the same grid, not the first one', () => {
    let g = newGame(rng([0]), 13, 2);
    g = { ...g, snake: [{ x: 12, y: 6 }, { x: 11, y: 6 }], heading: 'right' };
    const g2 = step(g, 'right');
    expect(g2.size).toBe(13);
    expect(g2.gameNumber).toBe(2);
    expect(g2.snake[0]).toEqual({ x: 6, y: 6 });
  });

  it('filling the grid completes the game: length 144, complete, and further steps change nothing', () => {
    // A snake of 143 cells in a boustrophedon with the last free cell at the end of the path.
    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < GRID; y++) for (let i = 0; i < GRID; i++) cells.push({ x: y % 2 === 0 ? i : GRID - 1 - i, y });
    const body = cells.slice(0, 143).reverse();
    const free = cells[143];
    let g = newGame(rng([0]));
    g = { ...g, snake: body, heading: 'right', length: 143, food: free };
    const dir = free.x > body[0].x ? 'right' : free.x < body[0].x ? 'left' : free.y > body[0].y ? 'down' : 'up';
    const g2 = step(g, dir as Direction);
    expect(g2.length).toBe(144);
    expect(g2.complete).toBe(true);
    const g3 = step(g2, 'up');
    expect(g3).toEqual(g2);
  });

  it('attemptStep counts the moves of the current attempt: up from 0 at a start, back to 0 on a death', () => {
    let g = newGame(() => 0);
    expect(g.attemptStep).toBe(0);
    g = step(g, 'right', () => 0); g = step(g, 'right', () => 0);
    expect(g.attemptStep).toBe(2);
    while (!(g.deaths > 0)) g = step(g, 'right', () => 0);
    expect(g.attemptStep).toBe(0);
    g = step(g, 'down', () => 0);
    expect(g.attemptStep).toBe(1);
    expect(g.step).toBeGreaterThan(g.attemptStep);
  });
});
