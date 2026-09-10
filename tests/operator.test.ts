import { describe, it, expect } from 'vitest';
import { Operator, type TelarchyClient, type ProposalRef } from '../src/operator.js';
import { newGame } from '../src/engine.js';
import type { Quotes } from '../src/decide.js';

type Call = { name: string; args: unknown[] };

function fakeClient(quotesFor: (step: number) => Quotes) {
  const calls: Call[] = [];
  let n = 0;
  const client: TelarchyClient = {
    async postProposal(title, description, decisionMinutes) {
      calls.push({ name: 'postProposal', args: [title, description, decisionMinutes] });
      return { id: `p${++n}`, title, url: `https://telarchy.com/snake/p/${n}` };
    },
    async readQuotes(refs: ProposalRef[]) {
      calls.push({ name: 'readQuotes', args: [refs.map(r => r.id)] });
      const step = Number(calls.filter(c => c.name === 'readQuotes').length);
      return quotesFor(step);
    },
    async decideProposal(ref, verdict) {
      calls.push({ name: 'decideProposal', args: [ref.id, verdict] });
    },
    async postReading(value, at, final) {
      calls.push({ name: 'postReading', args: [value, at.toISOString(), final] });
    },
  };
  return { client, calls };
}

const allTen = (): Quotes => ({ up: { approved: 10, declined: 10 }, right: { approved: 10, declined: 10 }, down: { approved: 10, declined: 10 }, left: { approved: 10, declined: 10 } });
const upWins = (): Quotes => ({ ...allTen(), up: { approved: 12, declined: 10 } });
const none = (): Quotes => ({ up: { approved: null, declined: null }, right: { approved: null, declined: null }, down: { approved: null, declined: null }, left: { approved: null, declined: null } });

const rng = () => 0;

describe('the operator loop (docs/snake.md, "The step" and "What must hold")', () => {
  it('posts exactly four proposals per minute, titled Move up/right/down/left, one-minute window', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const posts = calls.filter(c => c.name === 'postProposal');
    expect(posts.map(c => c.args[0])).toEqual(['Move up', 'Move right', 'Move down', 'Move left']);
    expect(posts.every(c => c.args[2] === 1)).toBe(true);
    await expect(op.openStep(new Date('2026-09-11T10:00:30Z'))).rejects.toThrow(/already open/);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(4);
  });

  it('the description names the step and the state in one line', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const desc = String(calls[0].args[1]);
    expect(desc).toMatch(/step 1\b/i);
    expect(desc).toMatch(/length 3\b/);
    expect(desc.includes('\n')).toBe(false);
  });

  it('decides before the deadline: approves the highest approved price, declines the other three', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:55Z'));
    expect(d.approved).toBe('up');
    const verdicts = calls.filter(c => c.name === 'decideProposal').map(c => c.args);
    expect(verdicts).toEqual([['p1', 'approve'], ['p2', 'decline'], ['p3', 'decline'], ['p4', 'decline']]);
  });

  it('the move is applied at the next top of minute, then the next four are posted', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:55Z'));
    expect(op.game.step).toBe(0);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.step).toBe(1);
    expect(op.game.heading).toBe('up');
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(8);
  });

  it('with no price readable the snake continues in its heading, all four are declined, nothing stays pending', async () => {
    const { client, calls } = fakeClient(none);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:55Z'));
    expect(d.undecided).toBe(true);
    expect(calls.filter(c => c.name === 'decideProposal' && c.args[1] === 'decline').length).toBe(4);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.heading).toBe('right');
    expect(op.game.snake[0]).toEqual({ x: 11, y: 10 });
  });

  it('a failing API on decide still declines the rest and logs the step as undecided', async () => {
    const { client, calls } = fakeClient(upWins);
    let failed = false;
    const flaky: TelarchyClient = {
      ...client,
      async decideProposal(ref, verdict) {
        if (!failed && verdict === 'approve') { failed = true; throw new Error('503'); }
        return client.decideProposal(ref, verdict);
      },
    };
    const op = new Operator(flaky, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:55Z'));
    expect(d.undecided).toBe(true);
    expect(d.direction).toBe('right');
    // The failed approve is retried as a decline: nothing stays pending.
    const verdicts = calls.filter(c => c.name === 'decideProposal').map(c => c.args);
    expect(verdicts).toEqual([['p1', 'decline'], ['p2', 'decline'], ['p3', 'decline'], ['p4', 'decline']]);
    expect(op.decisions[0].undecided).toBe(true);
  });

  it('posts a reading after every step, and marks the last reading before midnight UTC final', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T23:58:00Z'));
    await op.closeStep(new Date('2026-09-11T23:58:55Z'));
    await op.tick(new Date('2026-09-11T23:59:00Z'));
    let readings = calls.filter(c => c.name === 'postReading');
    expect(readings.length).toBe(1);
    expect(readings[0].args[2]).toBe(true); // the last step of the day
    await op.closeStep(new Date('2026-09-11T23:59:55Z'));
    await op.tick(new Date('2026-09-12T00:00:00Z'));
    readings = calls.filter(c => c.name === 'postReading');
    expect(readings.length).toBe(2);
    expect(readings[1].args[2]).toBe(false);
    expect(readings[1].args[1]).toBe('2026-09-12T00:00:00.000Z');
  });

  it('the operator never trades: only proposal, quote, decision and reading calls are made', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:55Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const names = new Set(calls.map(c => c.name));
    expect([...names].sort()).toEqual(['decideProposal', 'postProposal', 'postReading', 'readQuotes']);
  });

  it('records the last ten decisions with the four prices and the length change', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    let t = Date.parse('2026-09-11T10:00:00Z');
    await op.openStep(new Date(t));
    for (let i = 0; i < 12; i++) {
      await op.closeStep(new Date(t + 55_000));
      await op.tick(new Date(t + 60_000));
      t += 60_000;
    }
    expect(op.decisions.length).toBe(12);
    expect(op.recentDecisions().length).toBe(10);
    const d = op.decisions[0];
    expect(d.quotes.up.approved).toBe(12);
    expect(typeof d.lengthBefore).toBe('number');
    expect(typeof d.lengthAfter).toBe('number');
    expect(d.proposals.up.url).toMatch(/^https:/);
  });

  it('state round-trips through JSON so a restart continues the game', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:55Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const json = JSON.stringify(op.toJSON());
    const op2 = Operator.fromJSON(client, JSON.parse(json), rng);
    expect(op2.game).toEqual(op.game);
    expect(op2.decisions).toEqual(op.decisions);
    expect(op2.open?.step).toBe(op.open?.step);
  });

  it('/state carries the game, the open proposals with prices, recent decisions and counters', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:20Z'));
    expect(s.game.length).toBe(3);
    expect(s.open?.proposals.up.url).toMatch(/^https:/);
    expect(s.open?.decideAt).toBe('2026-09-11T10:00:55.000Z');
    expect(s.secondsToDecision).toBe(35);
    expect(s.recentDecisions).toEqual([]);
    expect(s.deathsToday).toBe(0);
  });
});
