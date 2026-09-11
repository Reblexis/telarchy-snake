import { describe, it, expect } from 'vitest';
import { commentary } from '../src/commentary.js';

const base = () => ({
  game: { snake: [{ x: 6, y: 6 }, { x: 5, y: 6 }], heading: 'right', food: { x: 6, y: 3 }, length: 2, step: 4, deaths: 0, complete: false, size: 12, gameNumber: 1 },
  grid: 12,
  gameNumber: 1,
  complete: false,
  nextGameAt: null as string | null,
  bestLength: 2,
  open: { step: 5 },
  next: { action: 'left', direction: 'up', decided: false, seconds: 30 } as any,
  traders: [] as any[],
  tradersThisStep: 0,
  recentTrades: [] as any[],
  recentDecisions: [] as any[],
});
const now = new Date('2026-09-11T10:00:30Z');

describe('the commentary line (docs/snake.md, "The board": a fixed rule set, no model)', () => {
  it('is one left-aligned line: no newline, under 120 characters, no dashes', () => {
    const c = commentary(base(), now);
    expect(c.includes('\n')).toBe(false);
    expect(c.length).toBeLessThan(120);
    expect(/[–—]/.test(c)).toBe(false);
  });

  it('names the food relative to the head and which way the market leans', () => {
    const c = commentary({ ...base(), traders: [{ handle: 'ada' }] }, now);
    expect(c).toMatch(/food is 3 cells up/i);
    expect(c).toMatch(/leans turn left \(up\)/i);
  });

  it('names both axes when the food is off the diagonal', () => {
    const s = base(); s.game.food = { x: 8, y: 9 }; s.traders = [{ handle: 'ada' }];
    expect(commentary(s, now)).toMatch(/3 cells down and 2 cells right/i);
  });

  it('says nobody has traded this step yet, and that forward is then the default', () => {
    const s = base(); s.next = { action: 'forward', direction: 'right', decided: false, seconds: 30 };
    expect(commentary(s, now)).toMatch(/nobody has traded step 5 yet: forward it is/i);
  });

  it('when nobody traded but the books alone lean a way, says so', () => {
    const c = commentary(base(), now);
    expect(c).toMatch(/nobody has traded/i);
    expect(c).toMatch(/turn left/i);
  });

  it('a trade this step counts as traded', () => {
    const s = base(); s.recentTrades = [{ step: 5, handle: 'ada' }];
    expect(commentary(s, now)).not.toMatch(/nobody/i);
  });

  it('reports a death in the last two steps with its number', () => {
    const s = base(); s.game.deaths = 4;
    s.recentDecisions = [{ step: 4, lengthBefore: 9, lengthAfter: 2 }];
    expect(commentary(s, now)).toMatch(/death #4 last step.*was 9/i);
    s.recentDecisions = [{ step: 4, lengthBefore: 2, lengthAfter: 2 }, { step: 3, lengthBefore: 9, lengthAfter: 2 }];
    expect(commentary(s, now)).toMatch(/death #4 two steps ago/i);
    s.recentDecisions = [{ step: 4, lengthBefore: 2, lengthAfter: 2 }, { step: 3, lengthBefore: 2, lengthAfter: 2 }, { step: 2, lengthBefore: 9, lengthAfter: 2 }];
    expect(commentary(s, now)).not.toMatch(/death/i);
  });

  it('celebrates a new record length when the last move grew the snake to its best', () => {
    const s = base(); s.game.length = 17; s.bestLength = 17; s.traders = [{ handle: 'ada' }];
    s.recentDecisions = [{ step: 4, lengthBefore: 16, lengthAfter: 17 }];
    expect(commentary(s, now)).toMatch(/new record length 17/i);
    s.bestLength = 20;
    expect(commentary(s, now)).not.toMatch(/record/i);
  });

  it('warns when the leading move hits the wall or the body next move', () => {
    const s = base(); s.traders = [{ handle: 'ada' }];
    s.game.snake = [{ x: 6, y: 0 }, { x: 5, y: 0 }]; s.game.heading = 'right';
    s.next = { action: 'left', direction: 'up', decided: false, seconds: 30 };
    expect(commentary(s, now)).toMatch(/turn left \(up\) hits the wall next move/i);
    s.game.snake = [{ x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 7 }, { x: 5, y: 6 }, { x: 5, y: 5 }]; s.game.heading = 'up';
    s.next = { action: 'left', direction: 'left', decided: false, seconds: 30 };
    expect(commentary(s, now)).toMatch(/hits its own body next move/i);
  });

  it('a complete game says so and names the next grid and the wait', () => {
    const s = base(); s.complete = true; s.game.complete = true; s.game.length = 144; s.open = null as any; s.next = null;
    s.nextGameAt = new Date(now.getTime() + 25 * 60_000).toISOString();
    expect(commentary(s, now)).toMatch(/game 1 complete.*13 by 13.*25 min/i);
  });

  it('a decided step names the chosen move until it happens', () => {
    const s = base(); s.traders = [{ handle: 'ada' }];
    s.next = { action: 'right', direction: 'down', decided: true, seconds: 0 };
    expect(commentary(s, now)).toMatch(/decided: turn right \(down\) at the top of the minute/i);
  });

  it('with no open step and no other news it says the snake is waiting', () => {
    const s = base(); s.open = null as any; s.next = null;
    expect(commentary(s, now)).toMatch(/waiting/i);
  });
});
