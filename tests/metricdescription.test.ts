import { describe, expect, it } from 'vitest';
import { GRID, newGame } from '../src/engine.js';
import { metricDescription, Operator } from '../src/operator.js';
import type { MarketActivity, Quotes, TelarchyClient } from '../src/operator.js';

/**
 * The metric says which grid is being played (docs/snake.md, "The workspace").
 * It is the first thing a trader reads on the floor, so a grid it names has to
 * be the grid on screen: after game 1 filled its 4x4 the metric still said
 * "on a 4 by 4 grid" and "the grid filled at 16" while the snake was on a 6x6
 * board whose full length is 36.
 */

const rng = () => 0.5;

function fakeClient() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const client: TelarchyClient = {
    async postProposal(title, description, decideBy, options) {
      calls.push({ name: 'postProposal', args: [title, description, decideBy, options] });
      return { id: `p-${calls.length}`, number: calls.length, url: 'u' };
    },
    async readQuotes(): Promise<Quotes> {
      return {
        forward: { m60: { consensus: 3, reason: null } },
        left: { m60: { consensus: 2, reason: null } },
        right: { m60: { consensus: 2, reason: null } },
      } as unknown as Quotes;
    },
    async choose(ref, option) {
      calls.push({ name: 'choose', args: [ref.id, option] });
    },
    async voidAll(ref) {
      calls.push({ name: 'voidAll', args: [ref.id] });
    },
    async postReading(value) {
      calls.push({ name: 'postReading', args: [value] });
    },
    async refreshBooks() {},
    async setHorizon(cell) {
      calls.push({ name: 'setHorizon', args: [cell] });
    },
    async setRange(max) {
      calls.push({ name: 'setRange', args: [max] });
    },
    async setMetricDescription(text) {
      calls.push({ name: 'setMetricDescription', args: [text] });
    },
    async readActivity(): Promise<Record<string, MarketActivity>> {
      return {};
    },
    async readLeaderboard() {
      return [];
    },
  } as unknown as TelarchyClient;
  return { client, calls };
}

describe('the metric names the grid being played', () => {
  it('the sentence names this grid and its full length', () => {
    expect(metricDescription(4)).toMatch(/4 by 4/);
    expect(metricDescription(4)).toMatch(/16/);
    expect(metricDescription(6)).toMatch(/6 by 6/);
    expect(metricDescription(6)).toMatch(/36/);
    expect(metricDescription(6)).not.toMatch(/4 by 4/);
  });

  it('a new game on a larger grid rewrites the metric, so it never names the grid before it', async () => {
    const { client, calls } = fakeClient();
    const g = { ...newGame(rng, GRID, 1), complete: true, length: GRID * GRID };
    const op = new Operator(client, g as never, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T10:06:00Z'));
    const wrote = calls.filter(c => c.name === 'setMetricDescription').map(c => String(c.args[0]));
    expect(wrote.length).toBe(1);
    expect(wrote[0]).toMatch(/6 by 6/);
    expect(wrote[0]).toMatch(/36/);
    expect(wrote[0]).not.toMatch(/4 by 4/);
  });

  it('the rewrite is not what starts the game: a refusal leaves the new game running', async () => {
    const { client, calls } = fakeClient();
    (client as { setMetricDescription: () => Promise<void> }).setMetricDescription = async () => {
      throw new Error('description -> 500');
    };
    const g = { ...newGame(rng, GRID, 1), complete: true, length: GRID * GRID };
    const op = new Operator(client, g as never, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T10:06:00Z'));
    expect(op.game.size).toBe(GRID + 2);
    expect(op.game.gameNumber).toBe(2);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(1);
  });
});
