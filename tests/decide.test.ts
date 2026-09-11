import { describe, it, expect } from 'vitest';
import { decide, ACTIONS, turn, HORIZONS, emptyDirectionQuotes, priceOf, proposalOptions, proposalTitle, OPTION_LABEL } from '../src/decide.js';

const q = (price: number | null, lead: number | null = null) => ({ m60: { price, lead } });

describe('actions are relative to the heading (docs/snake.md, "The game")', () => {
  it('lists the three actions in the option order forward, left, right', () => {
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

describe('the proposal and its options (docs/snake.md, "The step")', () => {
  it('the title names the game, the attempt and the move, with no action after a colon', () => {
    expect(proposalTitle(1, 30, 3)).toBe('Game 1, attempt 30, move 3');
    expect(proposalTitle(12, 2, 9999)).toBe('Game 12, attempt 2, move 9999');
    expect(proposalTitle(999999, 999999, 99999999).length).toBeLessThan(80);
    expect(proposalTitle(1, 1, 1)).not.toContain(':');
  });

  it('the options are exactly forward, left, right in that order, ids fit Telarchy\'s ^[a-z0-9-]{1,24}$ and labels are under 40 characters', () => {
    const opts = proposalOptions();
    expect(opts).toEqual([
      { id: 'forward', label: 'Continue forward' },
      { id: 'left', label: 'Turn left' },
      { id: 'right', label: 'Turn right' },
    ]);
    for (const o of opts) {
      expect(o.id).toMatch(/^[a-z0-9-]{1,24}$/);
      expect(o.label.length).toBeLessThanOrEqual(40);
      expect(OPTION_LABEL[o.id as 'forward']).toBe(o.label);
    }
    expect(new Set(opts.map(o => o.id)).size).toBe(3);
  });
});

describe('THE OPTION WITH THE HIGHEST PRICE IS THE ONE CHOSEN (docs/snake.md, "The step")', () => {
  it('chooses the option with the highest price', () => {
    const d = decide({ forward: q(10), left: q(12), right: q(9) }, 'up');
    expect(d.approved).toBe('left');
    expect(d.direction).toBe('left');
    expect(d.undecided).toBe(false);
  });

  it('it is the price that decides, never the lead: an option whose lead is stale but whose price is highest wins', () => {
    const d = decide({ forward: q(50, -1), left: q(11, 9), right: q(30, 0) }, 'up');
    expect(d.approved).toBe('forward');
  });

  it('a lead without a price counts for nothing', () => {
    const d = decide({ forward: q(null, 5), left: q(8, -1), right: q(null, 2) }, 'up');
    expect(d.approved).toBe('left');
  });

  it('an option with no readable price never wins, even against a low price', () => {
    const d = decide({ forward: q(null), left: q(0.5), right: q(null) }, 'up');
    expect(d.approved).toBe('left');
  });

  it('A TIE CONTINUES IN THE CURRENT HEADING: all equal goes forward', () => {
    const d = decide({ forward: q(12), left: q(12), right: q(12) }, 'down');
    expect(d.approved).toBe('forward');
    expect(d.direction).toBe('down');
  });

  it('prices within a billionth are a tie', () => {
    const d = decide({ forward: q(12), left: q(12 + 1e-10), right: q(11) }, 'down');
    expect(d.approved).toBe('forward');
    const e = decide({ forward: q(12), left: q(12 + 1e-6), right: q(11) }, 'down');
    expect(e.approved).toBe('left');
  });

  it('a tie between the two turns goes to the one whose direction comes first in up, right, down, left', () => {
    // Heading right: left turns up, right turns down; up wins.
    expect(decide({ forward: q(5), left: q(12), right: q(12) }, 'right').approved).toBe('left');
    // Heading left: left turns down, right turns up; up wins, so right.
    expect(decide({ forward: q(5), left: q(12), right: q(12) }, 'left').approved).toBe('right');
    // Heading up: left turns left, right turns right; right comes before left.
    expect(decide({ forward: q(5), left: q(12), right: q(12) }, 'up').approved).toBe('right');
    // Heading down: left turns right, right turns left; right comes first, so left.
    expect(decide({ forward: q(5), left: q(12), right: q(12) }, 'down').approved).toBe('left');
  });

  it('with no price readable at all the step is undecided and the snake continues forward', () => {
    const d = decide({ forward: q(null), left: q(null), right: q(null) }, 'left');
    expect(d.approved).toBe(null);
    expect(d.direction).toBe('left');
    expect(d.undecided).toBe(true);
  });

  it('a non-finite price is unreadable', () => {
    expect(priceOf({ m60: { price: NaN, lead: null } })).toBe(null);
    expect(priceOf({ m60: { price: Infinity, lead: null } })).toBe(null);
    expect(priceOf({ m60: { price: 3, lead: null } })).toBe(3);
    expect(priceOf(undefined)).toBe(null);
  });

  it('the one horizon is 60 moves and the empty quotes carry a null price and lead', () => {
    expect(HORIZONS).toEqual(['m60']);
    expect(Object.keys(emptyDirectionQuotes())).toEqual(['m60']);
    expect(emptyDirectionQuotes().m60).toEqual({ price: null, lead: null });
  });

  it('the direction to apply is the turned heading', () => {
    const d = decide({ forward: q(1), left: q(2), right: q(30) }, 'up');
    expect(d.direction).toBe('right');
    const d2 = decide({ forward: q(1), left: q(2), right: q(30) }, 'left');
    expect(d2.direction).toBe('up');
  });
});
