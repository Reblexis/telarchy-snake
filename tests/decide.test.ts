import { describe, it, expect } from 'vitest';
import { decide, DIRECTIONS, type Quote } from '../src/decide.js';

const q = (approved: number | null, declined: number | null = 10): Quote => ({ approved, declined });

describe('the decision rule (docs/snake.md, "The step")', () => {
  it('lists the four directions in the tie order up, right, down, left', () => {
    expect(DIRECTIONS).toEqual(['up', 'right', 'down', 'left']);
  });

  it('approves the direction whose approved-branch price is highest and declines the other three', () => {
    const d = decide({ up: q(10), right: q(12), down: q(9), left: q(3) }, 'up');
    expect(d.approved).toBe('right');
    expect(d.declined.sort()).toEqual(['down', 'left', 'up']);
    expect(d.undecided).toBe(false);
  });

  it('a tie goes to the current heading', () => {
    const d = decide({ up: q(12), right: q(12), down: q(12), left: q(12) }, 'down');
    expect(d.approved).toBe('down');
  });

  it('a tie not involving the heading goes to up, right, down, left in that order', () => {
    const d = decide({ up: q(5), right: q(12), down: q(12), left: q(12) }, 'up');
    expect(d.approved).toBe('right');
    const d2 = decide({ up: q(5), right: q(5), down: q(12), left: q(12) }, 'up');
    expect(d2.approved).toBe('down');
  });

  it('a direction with no readable price never wins', () => {
    const d = decide({ up: q(null), right: q(8), down: q(null), left: q(7) }, 'up');
    expect(d.approved).toBe('right');
  });

  it('with no price readable at all the snake continues in its heading and all four are declined', () => {
    const d = decide({ up: q(null), right: q(null), down: q(null), left: q(null) }, 'left');
    expect(d.approved).toBe(null);
    expect(d.direction).toBe('left');
    expect(d.declined.sort()).toEqual(['down', 'left', 'right', 'up']);
    expect(d.undecided).toBe(true);
  });

  it('the direction to apply is the approved one when there is one', () => {
    const d = decide({ up: q(1), right: q(2), down: q(30), left: q(4) }, 'up');
    expect(d.direction).toBe('down');
  });

  it('the declined-branch price never decides anything', () => {
    const d = decide({ up: q(10, 99), right: q(11, 1), down: q(1, 99), left: q(1, 99) }, 'up');
    expect(d.approved).toBe('right');
  });
});
