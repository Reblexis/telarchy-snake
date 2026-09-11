import { describe, it, expect } from 'vitest';
import { decide, ACTIONS, turn, HORIZONS, emptyDirectionQuotes } from '../src/decide.js';

const q = (approved60: number | null, declined60: number | null = 10) =>
  ({ m60: { approved: approved60, declined: declined60 } });

describe('actions are relative to the heading (docs/snake.md, "The game")', () => {
  it('lists the three actions in the tie order forward, left, right', () => {
    expect(ACTIONS).toEqual(['forward', 'left', 'right']);
  });
  it('turn left and turn right are relative; forward keeps the heading', () => {
    expect(turn('up', 'left')).toBe('left');
    expect(turn('up', 'right')).toBe('right');
    expect(turn('right', 'left')).toBe('up');
    expect(turn('right', 'right')).toBe('down');
    expect(turn('down', 'left')).toBe('right');
    expect(turn('down', 'right')).toBe('left');
    expect(turn('left', 'left')).toBe('down');
    expect(turn('left', 'right')).toBe('up');
    expect(turn('left', 'forward')).toBe('left');
  });
});

describe('the decision rule (docs/snake.md, "The step")', () => {
  it('approves the action with the highest 60-move impact (approved minus declined) and declines the other two', () => {
    const d = decide({ forward: q(10), left: q(12), right: q(9) }, 'up');
    expect(d.approved).toBe('left');
    expect(d.declined.sort()).toEqual(['forward', 'right']);
    expect(d.direction).toBe('left');
    expect(d.undecided).toBe(false);
  });

  it('a tie goes to continue forward: it is the default', () => {
    const d = decide({ forward: q(12, 12), left: q(12, 12), right: q(12, 12) }, 'down');
    expect(d.approved).toBe('forward');
    expect(d.direction).toBe('down');
  });

  it('a tie between the turns goes to left', () => {
    const d = decide({ forward: q(5, 10), left: q(12, 10), right: q(12, 10) }, 'up');
    expect(d.approved).toBe('left');
  });

  it('an action with no readable 60-move impact never wins', () => {
    const d = decide({ forward: q(null), left: q(8), right: q(null, 1) }, 'up');
    expect(d.approved).toBe('left');
  });

  it('with no impact readable at all the snake continues forward and all three are declined', () => {
    const d = decide({ forward: q(null), left: q(null), right: q(null) }, 'left');
    expect(d.approved).toBe(null);
    expect(d.direction).toBe('left');
    expect(d.declined.sort()).toEqual(['forward', 'left', 'right']);
    expect(d.undecided).toBe(true);
  });

  it('it is the impact that decides, not the approved price', () => {
    const d = decide({ forward: q(50, 60), left: q(11, 1), right: q(30, 30) }, 'up');
    expect(d.approved).toBe('left');
  });

  it('the one horizon is 60 moves and the empty quotes carry nothing else', () => {
    expect(HORIZONS).toEqual(['m60']);
    expect(Object.keys(emptyDirectionQuotes())).toEqual(['m60']);
  });

  it('the direction to apply is the turned heading', () => {
    const d = decide({ forward: q(1, 10), left: q(2, 10), right: q(30, 10) }, 'up');
    expect(d.direction).toBe('right');
    const d2 = decide({ forward: q(1, 10), left: q(2, 10), right: q(30, 10) }, 'left');
    expect(d2.direction).toBe('up');
  });
});
