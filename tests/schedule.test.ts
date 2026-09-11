import { describe, expect, test } from 'vitest';
import { type LoopState, nextAction } from '../src/schedule.js';

/**
 * The loop's order (docs/snake.md, "Operation"). The rule this file exists
 * to protect: **a completed game runs its cooldown, it never tries to open a
 * step.** Game 1 filled its 4x4 grid at 23:08 UTC on 2026-09-11 and the game
 * never came back: a complete game has no open step, so the loop asked for a
 * step every second, the operator refused ("the game is complete"), and the
 * cooldown that starts the next game was never reached.
 */

const base: LoopState = {
  complete: false,
  hasOpen: false,
  decided: false,
  canOpen: true,
  sec: 0,
  minute: 100,
  lastTickMinute: 99,
  lastCloseMinute: 99,
  sinceLastPoll: 0,
  sinceLastActivity: 0,
};
const at = (over: Partial<LoopState>) => nextAction({ ...base, ...over });

describe('a completed game waits out its cooldown', () => {
  test('the top of the minute runs the cooldown, not a new step', () => {
    expect(at({ complete: true, hasOpen: false })).toBe('cooldown');
  });

  test('the cooldown runs once a minute, like every other tick', () => {
    expect(at({ complete: true, hasOpen: false, lastTickMinute: 100 })).not.toBe('cooldown');
  });

  test('a completed game never asks to open a step, at any second', () => {
    for (const sec of [0, 5, 30, 49, 50, 58, 59]) {
      expect(at({ complete: true, hasOpen: false, sec, canOpen: sec <= 49 })).not.toBe('open');
    }
  });

  test('the finished game still reports activity between cooldown ticks', () => {
    expect(at({ complete: true, lastTickMinute: 100, sinceLastActivity: 20_000 })).toBe('activity');
  });
});

describe('a running game keeps the order it had', () => {
  test('no step and room in the minute: open one', () => {
    expect(at({ hasOpen: false })).toBe('open');
  });

  test('too late in the minute to trade: do not open one', () => {
    expect(at({ hasOpen: false, sec: 55, canOpen: false })).not.toBe('open');
  });

  test('the last two seconds of a traded step: close it', () => {
    expect(at({ hasOpen: true, decided: false, sec: 58 })).toBe('close');
  });

  test('a traded step mid-minute: poll its quotes', () => {
    expect(at({ hasOpen: true, decided: false, sec: 20, sinceLastPoll: 6_000 })).toBe('poll');
  });

  test('a ruled step at the top of the minute: move the snake', () => {
    expect(at({ hasOpen: true, decided: true, sec: 1 })).toBe('tick');
  });

  test('nothing to do and no timer due: idle', () => {
    expect(at({ hasOpen: true, decided: true, sec: 1, lastTickMinute: 100 })).toBe('idle');
  });
});
