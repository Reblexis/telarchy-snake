import { describe, it, expect } from 'vitest';
import { Operator, RULE, type TelarchyClient, type ProposalRef, type MarketActivity, type LeaderRow } from '../src/operator.js';
import { newGame } from '../src/engine.js';
import type { Quotes, Action, ProposalOption } from '../src/decide.js';

type Call = { name: string; args: unknown[] };

function fakeClient(quotesFor: (step: number) => Quotes, activity: Record<string, MarketActivity> = {}, leaders: LeaderRow[] = [], settleFails = false, horizonFails = false) {
  const calls: Call[] = [];
  let n = 0;
  const client: TelarchyClient = {
    async postProposal(title, description, decideBy, options: ProposalOption[]) {
      calls.push({ name: 'postProposal', args: [title, description, decideBy.toISOString(), options] });
      n++;
      return { id: `p${n}`, number: n, url: `https://telarchy.com/snake/p/${n}` };
    },
    async readQuotes(ref: ProposalRef, cell: string) {
      calls.push({ name: 'readQuotes', args: [ref.id, cell] });
      const step = Number(calls.filter(c => c.name === 'readQuotes').length);
      return quotesFor(step);
    },
    async approveOption(ref, option: Action) {
      calls.push({ name: 'approveOption', args: [ref.id, option] });
    },
    async declineProposal(ref) {
      calls.push({ name: 'declineProposal', args: [ref.id] });
    },
    async postReading(value, at, final) {
      calls.push({ name: 'postReading', args: [value, at.toISOString(), final] });
    },
    async settleMetric(value, at, reason) {
      calls.push({ name: 'settleMetric', args: [value, at.toISOString(), reason] });
      if (settleFails) throw new Error('settle -> 500');
    },
    async refreshBooks() {
      calls.push({ name: 'refreshBooks', args: [] });
    },
    async setHorizon(cell: string) {
      calls.push({ name: 'setHorizon', args: [cell] });
      if (horizonFails) throw new Error('horizon -> 500');
    },
    async setRange(max) {
      calls.push({ name: 'setRange', args: [max] });
    },
    async setMetricDescription(text: string) {
      calls.push({ name: 'setMetricDescription', args: [text] });
    },
    async readActivity(marketIds) {
      calls.push({ name: 'readActivity', args: [marketIds] });
      const out: Record<string, MarketActivity> = {};
      for (const id of marketIds) if (activity[id]) out[id] = activity[id];
      return out;
    },
    async readLeaderboard(limit) {
      calls.push({ name: 'readLeaderboard', args: [limit] });
      return leaders.slice(0, limit);
    },
  };
  return { client, calls };
}

/** Quotes that carry market ids, as the HTTP client returns them once the books exist. */
const withIds = (): Quotes => {
  const q = upWins();
  for (const a of ['forward', 'left', 'right'] as const) for (const h of ['m60'] as const) {
    q[a][h] = { ...q[a][h], marketId: `${a}-${h}` };
  }
  return q;
};
const OPTIONS = [{ id: 'forward', label: 'Continue forward' }, { id: 'left', label: 'Turn left' }, { id: 'right', label: 'Turn right' }];
const trade = (id: string, handle: string, at: string, cost = 5, kind: 'buy' | 'sell' = 'buy') =>
  ({ id, handle, direction: 'higher' as const, kind, shares: 2, cost, createdAt: at });
const pos = (handle: string, cost = 5) => ({ handle, direction: 'higher' as const, shares: 2, cost, worth: 6 });

const h = (price: number | null, lead: number | null = null) => ({ m60: { price, lead } });
const T0 = new Date('2026-09-11T10:00:00Z');
const allTen = (): Quotes => ({ forward: h(10, 0), left: h(10, 0), right: h(10, 0) });
const upWins = (): Quotes => ({ forward: h(10, -2), left: h(12, 2), right: h(10, -2) }); // the snake heads right at the start, so 'left' turns it up
const none = (): Quotes => ({ forward: h(null), left: h(null), right: h(null) });

const rng = () => 0;

describe('the operator loop (docs/snake.md, "The step" and "What must hold")', () => {
  it('EXACTLY ONE PROPOSAL PER MINUTE, titled Game G, attempt A, move N, carrying the three options forward, left, right in that order, with the deadline at the next top of minute', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00.700Z'));
    const posts = calls.filter(c => c.name === 'postProposal');
    expect(posts.length).toBe(1);
    expect(posts[0].args[0]).toBe('Game 1, attempt 1, move 1');
    expect(posts[0].args[2]).toBe('2026-09-11T10:01:00.000Z');
    expect(posts[0].args[3]).toEqual(OPTIONS);
    expect(op.open?.proposal).toEqual({ id: 'p1', number: 1, url: 'https://telarchy.com/snake/p/1' });
    expect(op.open?.decideAt).toBe('2026-09-11T10:00:58.000Z');
    expect(op.open?.deadline).toBe('2026-09-11T10:01:00.000Z');
    await expect(op.openStep(new Date('2026-09-11T10:00:30Z'))).rejects.toThrow(/already open/);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(1);
  });

  it('the description is the proposal in the snake\'s first person, one line per option in option order, then the state, the cell and the rule', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng, 12, 1), rng, { boardUrl: 'https://snake.telarchy.com' });
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const desc = String(calls.find(c => c.name === 'postProposal')!.args[1]);
    const lines = desc.split('\n');
    // Heading right at the start: forward is right, left is up, right is down.
    expect(lines[0]).toMatch(/^I will continue forward at move 1 of attempt 1, game 1: from \(\d+,\d+\) heading right, that is right\.$/);
    expect(lines[1]).toMatch(/^I will turn left at move 1 of attempt 1, game 1: from \(\d+,\d+\) heading right, that is up\.$/);
    expect(lines[2]).toMatch(/^I will turn right at move 1 of attempt 1, game 1: from \(\d+,\d+\) heading right, that is down\.$/);
    const rest = lines.slice(3).join(' ');
    expect(rest).toMatch(/length 2\b/i);
    expect(rest).toMatch(/record 2\b/i);
    expect(rest).toMatch(/food at \(\d+,\d+\)/);
    expect(rest).toContain('11:00');
    expect(rest).not.toContain('10:01');
    expect(rest).toMatch(/highest price at :58/);
    expect(rest).toMatch(/void/);
    expect(rest).toMatch(/refund/);
    expect(rest).toMatch(/ties continue forward/);
    expect(desc).not.toMatch(/impact|approved minus declined/);
    // No board address: the game is on the floor (docs/snake.md, "The step").
    expect(desc).not.toContain('snake.telarchy.com');
    expect(desc).not.toMatch(/^Step \d+:/);
    expect(desc.length).toBeLessThan(900);
  });

  it('polling during the minute publishes live quotes on the open step without deciding', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:05Z')).open?.quotes.left.m60.price).toBe(null);
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:06Z')).open?.quotes.left.m60.price).toBe(12);
    expect(op.publicState(new Date('2026-09-11T10:00:06Z')).open?.quotes.left.m60.lead).toBe(2);
    expect(op.open?.decision).toBe(null);
    expect(calls.filter(c => c.name === 'approveOption' || c.name === 'declineProposal').length).toBe(0);
  });

  it('decides before the deadline: approves the proposal naming the option with the highest price, in one call, and declines nothing', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.approved).toBe('left');
    expect(d.direction).toBe('up');
    const approves = calls.filter(c => c.name === 'approveOption').map(c => c.args);
    expect(approves).toEqual([['p1', 'left']]);
    expect(calls.filter(c => c.name === 'declineProposal').length).toBe(0);
    expect(op.decisions[0].approved).toBe('left');
    expect(op.decisions[0].prices).toEqual({ forward: 10, left: 12, right: 10 });
  });

  it('the move is applied at the next top of minute, then the next four are posted', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(op.game.step).toBe(0);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.step).toBe(1);
    expect(op.game.heading).toBe('up');
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(2);
  });

  it('with no price readable the snake continues forward, the proposal is declined with refund once, nothing stays pending', async () => {
    const { client, calls } = fakeClient(none);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(calls.filter(c => c.name === 'declineProposal').map(c => c.args)).toEqual([['p1']]);
    expect(calls.filter(c => c.name === 'approveOption').length).toBe(0);
    expect(op.decisions[0].prices).toEqual({ forward: null, left: null, right: null });
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.heading).toBe('right');
    expect(op.game.snake[0]).toEqual({ x: 7, y: 6 });
  });

  it('a failing approval falls back to a decline with refund and logs the step as undecided', async () => {
    const { client, calls } = fakeClient(upWins);
    const flaky: TelarchyClient = { ...client, async approveOption() { throw new Error('503'); } };
    const op = new Operator(flaky, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(d.direction).toBe('right');
    // The failed approve is followed by a decline: nothing stays pending.
    expect(calls.filter(c => c.name === 'declineProposal').map(c => c.args)).toEqual([['p1']]);
    expect(op.decisions[0].undecided).toBe(true);
    expect(op.decisions[0].approved).toBe(null);
  });

  it('a decline that fails after a failed approval is still recorded as undecided and the loop goes on', async () => {
    const { client } = fakeClient(upWins);
    const dead: TelarchyClient = { ...client, async approveOption() { throw new Error('503'); }, async declineProposal() { throw new Error('503'); } };
    const op = new Operator(dead, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.step).toBe(1);
  });

  it('posts a reading after every step, and marks the last reading before midnight UTC final', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T23:58:00Z'));
    await op.closeStep(new Date('2026-09-11T23:58:58Z'));
    await op.tick(new Date('2026-09-11T23:59:00Z'));
    let readings = calls.filter(c => c.name === 'postReading');
    expect(readings.length).toBe(1);
    expect(readings[0].args[2]).toBe(true); // the last step of the day
    await op.closeStep(new Date('2026-09-11T23:59:58Z'));
    await op.tick(new Date('2026-09-12T00:00:00Z'));
    readings = calls.filter(c => c.name === 'postReading');
    expect(readings.length).toBe(2);
    expect(readings[1].args[2]).toBe(false);
    expect(readings[1].args[1]).toBe('2026-09-12T00:00:00.000Z');
  });

  it('the operator never trades: only proposal, quote, decision and reading calls are made', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const names = new Set(calls.map(c => c.name));
    expect([...names].sort()).toEqual(['approveOption', 'postProposal', 'postReading', 'readQuotes', 'refreshBooks', 'setHorizon']);
    expect(Object.keys(client).some(k => /trade|order/i.test(k))).toBe(false);
  });

  it('forces the rolling-market refresh before the proposal of every step', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(calls.map(c => c.name).slice(0, 2)).toEqual(['setHorizon', 'refreshBooks']);
    expect(calls[2].name).toBe('postProposal');
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(calls.filter(c => c.name === 'refreshBooks').length).toBe(2);
    const second = calls.map(c => c.name).lastIndexOf('refreshBooks');
    expect(calls[second + 1].name).toBe('postProposal');
  });

  it('one cell per attempt: the first step sets the horizon to the minute sixty ahead, before the proposals, and later steps of the attempt keep it', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, { ...newGame(rng, 12, 1), food: { x: 0, y: 0 } }, rng);
    await op.openStep(T0);
    const names = calls.map(c => c.name);
    expect(calls.find(c => c.name === 'setHorizon')!.args).toEqual(['2026-09-11T11:00']);
    expect(names.indexOf('setHorizon')).toBeLessThan(names.indexOf('postProposal'));
    expect(names.indexOf('setHorizon')).toBeLessThan(names.lastIndexOf('refreshBooks'));
    expect(op.open?.cells).toEqual({ m60: '2026-09-11T11:00' });
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.closeStep(new Date('2026-09-11T10:01:58Z'));
    await op.tick(new Date('2026-09-11T10:02:00Z'));
    expect(calls.filter(c => c.name === 'setHorizon')).toHaveLength(1);
    expect(op.open?.cells).toEqual({ m60: '2026-09-11T11:00' });
    expect(calls.filter(c => c.name === 'readQuotes').every(c => c.args[1] === '2026-09-11T11:00')).toBe(true);
    const desc = String(calls.filter(c => c.name === 'postProposal').pop()!.args[1]);
    expect(desc).toContain('11:00');
    expect(desc).not.toContain('11:02');
  });

  it('a death ends the cell: the next step sets a new one sixty minutes ahead of it', async () => {
    const { client, calls } = fakeClient(allTen);
    const g = { ...newGame(rng, 12, 1), snake: [{ x: 11, y: 6 }, { x: 10, y: 6 }], length: 2, food: { x: 0, y: 0 } };
    const op = new Operator(client, g, rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z')); // dies
    expect(op.game.deaths).toBe(1);
    expect(calls.filter(c => c.name === 'setHorizon').map(c => c.args[0])).toEqual(['2026-09-11T11:00', '2026-09-11T11:01']);
    expect(op.open?.cells).toEqual({ m60: '2026-09-11T11:01' });
    const names = calls.map(c => c.name);
    expect(names.lastIndexOf('settleMetric')).toBeLessThan(names.lastIndexOf('setHorizon'));
  });

  it('when the cell\'s minute has passed with the attempt alive, the next step sets the next cell', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, { ...newGame(rng, 12, 1), food: { x: 0, y: 0 } }, rng);
    await op.openStep(T0);
    op.cell = '2026-09-11T10:00'; // as if the attempt had been running an hour
    op.open!.cells = { m60: '2026-09-11T10:00' };
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(calls.filter(c => c.name === 'setHorizon').map(c => c.args[0]).pop()).toBe('2026-09-11T11:01');
    expect(op.open?.cells).toEqual({ m60: '2026-09-11T11:01' });
  });

  it('the cell survives a restart', async () => {
    const { client } = fakeClient(allTen);
    const op = new Operator(client, { ...newGame(rng, 12, 1), food: { x: 0, y: 0 } }, rng);
    await op.openStep(T0);
    const back = Operator.fromJSON(client, JSON.parse(JSON.stringify(op.toJSON())), rng);
    expect(back.cell).toBe('2026-09-11T11:00');
  });

  it('if setting the cell fails the step still runs and the next step tries again', async () => {
    const { client, calls } = fakeClient(allTen, {}, [], false, true);
    const op = new Operator(client, { ...newGame(rng, 12, 1), food: { x: 0, y: 0 } }, rng);
    await op.openStep(T0);
    expect(calls.filter(c => c.name === 'postProposal')).toHaveLength(1);
    expect(op.cell).toBeNull();
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(calls.filter(c => c.name === 'setHorizon')).toHaveLength(2);
  });

  it('the quotes are read for the attempt\'s cell, so the client can name it', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00.700Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(calls.find(c => c.name === 'readQuotes')!.args[1]).toBe('2026-09-11T11:00');
  });

  it('a step never opens with under ten seconds to its deadline (a restart late in the minute waits for the next one)', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    expect(op.canOpen(new Date('2026-09-11T10:00:51Z'))).toBe(false);
    expect(op.canOpen(new Date('2026-09-11T10:00:49Z'))).toBe(true);
    await expect(op.openStep(new Date('2026-09-11T10:00:55Z'))).rejects.toThrow(/deadline/);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(0);
  });

  it('a complete game posts the full length as its reading every minute and no proposals, through the cooldown', async () => {
    const { client, calls } = fakeClient(upWins);
    const g = { ...newGame(rng, 12, 1), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.completedAt).toBe('2026-09-11T10:01:00.000Z');
    await op.tick(new Date('2026-09-11T10:02:00Z'));
    await op.tick(new Date('2026-09-11T10:03:00Z'));
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(0);
    expect(calls.filter(c => c.name === 'postReading').map(c => c.args[0])).toEqual([144, 144, 144]);
    expect(op.open).toBe(null);
    const st = op.publicState(new Date('2026-09-11T10:04:00Z'));
    expect(st.complete).toBe(true);
    // Five minutes from the fill, not an hour (Viktor, 2026-09-11).
    expect(st.nextGameAt).toBe('2026-09-11T10:06:00.000Z');
    await expect(op.openStep(new Date('2026-09-11T10:04:30Z'))).rejects.toThrow(/complete/);
  });

  it('after the cooldown, the range is raised to the new full grid and a new game starts two cells larger, numbered up', async () => {
    const { client, calls } = fakeClient(upWins);
    const g = { ...newGame(rng, 12, 1), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T10:05:00Z')); // four minutes in: still waiting
    expect(calls.filter(c => c.name === 'setRange').length).toBe(0);
    await op.tick(new Date('2026-09-11T10:06:00Z'));
    expect(calls.filter(c => c.name === 'setRange').map(c => c.args[0])).toEqual([196]);
    expect(op.game.size).toBe(14);
    expect(op.game.gameNumber).toBe(2);
    expect(op.game.length).toBe(2);
    expect(op.game.complete).toBe(false);
    expect(op.completedAt).toBe(null);
    // the range is raised before the new game's proposals are posted
    const names = calls.map(c => c.name);
    expect(names.indexOf('setRange')).toBeLessThan(names.lastIndexOf('postProposal'));
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(1);
    expect(op.publicState(new Date('2026-09-11T10:06:10Z')).grid).toBe(14);
  });

  it('if the range cannot be raised yet (a traded open book), the cooldown continues and it is retried next minute', async () => {
    const { client, calls } = fakeClient(upWins);
    let fails = 1;
    const blocked: TelarchyClient = { ...client, async setRange(max) { if (fails-- > 0) throw new Error('409'); return client.setRange(max); } };
    const g = { ...newGame(rng, 12, 1), complete: true, length: 144 };
    const op = new Operator(blocked, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T11:01:00Z'));
    expect(op.game.size).toBe(12);
    expect(op.game.complete).toBe(true);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(0);
    await op.tick(new Date('2026-09-11T11:02:00Z'));
    expect(op.game.size).toBe(14);
    expect(calls.filter(c => c.name === 'setRange').length).toBe(1);
  });

  it('the completion instant and game number survive a restart', async () => {
    const { client } = fakeClient(upWins);
    const g = { ...newGame(rng, 12, 1), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const op2 = Operator.fromJSON(client, JSON.parse(JSON.stringify(op.toJSON())), rng);
    expect(op2.completedAt).toBe(op.completedAt);
    expect(op2.game.gameNumber).toBe(1);
  });

  it('a failing refresh does not stop the proposal', async () => {
    const { client, calls } = fakeClient(upWins);
    const flaky: TelarchyClient = { ...client, async refreshBooks() { throw new Error('503'); } };
    const op = new Operator(flaky, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(1);
  });

  it('records the last ten decisions with the chosen option, every option\'s price at the close and the length change', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    let t = Date.parse('2026-09-11T10:00:00Z');
    await op.openStep(new Date(t));
    for (let i = 0; i < 12; i++) {
      await op.closeStep(new Date(t + 58_000));
      await op.tick(new Date(t + 60_000));
      t += 60_000;
    }
    expect(op.decisions.length).toBe(12);
    expect(op.recentDecisions().length).toBe(10);
    const d = op.decisions[0];
    expect(d.quotes.left.m60.price).toBe(12);
    expect(d.prices).toEqual({ forward: 10, left: 12, right: 10 });
    expect(d.action).toBe('left');
    expect(d.approved).toBe('left');
    expect(typeof d.lengthBefore).toBe('number');
    expect(typeof d.lengthAfter).toBe('number');
    expect(d.proposal.url).toMatch(/^https:/);
    expect((d as any).proposals).toBeUndefined();
  });

  it('state round-trips through JSON so a restart continues the game', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const json = JSON.stringify(op.toJSON());
    // Restored inside the open step's window: a step whose deadline has passed
    // is dropped rather than served (docs/snake.md, "The feed"), so the restart
    // that continues a game is one that happens while the step is still live.
    const op2 = Operator.fromJSON(client, JSON.parse(json), rng, {}, new Date('2026-09-11T10:01:30Z'));
    expect(op2.game).toEqual(op.game);
    expect(op2.decisions).toEqual(op.decisions);
    expect(op2.open?.step).toBe(op.open?.step);
  });

  it('/state names the grid size so a board can draw it', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    expect(op.publicState(new Date()).grid).toBe(12);
    expect(op.publicState(new Date()).gameNumber).toBe(1);
  });

  it('/state carries the game, the ONE open proposal, a price and lead per option, recent decisions and counters', async () => {
    const { client } = fakeClient(withIds);
    const op = new Operator(client, newGame(rng, 12, 1), rng, { workspaceId: 'ws-1', metricId: 'm-1' });
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:20Z'));
    expect(s.game.length).toBe(2);
    expect(s.open?.proposal).toEqual({ id: 'p1', number: 1, url: 'https://telarchy.com/snake/p/1' });
    expect((s.open as any).proposals).toBeUndefined();
    expect(s.open?.quotes.left).toEqual({ m60: { price: 12, lead: 2, marketId: 'left-m60' } });
    expect(s.open?.quotes.forward.m60).toEqual({ price: 10, lead: -2, marketId: 'forward-m60' });
    expect(Object.keys(s.open!.quotes.forward.m60).sort()).toEqual(['lead', 'marketId', 'price']);
    expect(s.game.heading).toBe('right');
    expect(s.open?.directions).toEqual({ forward: 'right', left: 'up', right: 'down' });
    expect(s.open?.decideAt).toBe('2026-09-11T10:00:58.000Z');
    expect(s.open?.deadline).toBe('2026-09-11T10:01:00.000Z');
    expect(s.open?.cells).toEqual({ m60: '2026-09-11T11:00' });
    expect(s.nextStepAt).toBe('2026-09-11T10:01:00.000Z');
    expect(s.complete).toBe(false);
    expect(s.secondsToDecision).toBe(38);
    expect(typeof s.rule).toBe('string');
    expect(s.rule).toMatch(/hour/);
    expect(s.recentDecisions).toEqual([]);
    expect(s.deathsToday).toBe(0);
    expect(s.workspaceId).toBe('ws-1');
    expect(s.metricId).toBe('m-1');
  });
});

describe('activity on /state (docs/snake.md, "The board" and "The feed")', () => {
  const T0 = new Date('2026-09-11T10:00:00Z');

  async function opened(activity: Record<string, MarketActivity> = {}, leaders: LeaderRow[] = []) {
    const { client, calls } = fakeClient(withIds, activity, leaders);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    return { op, calls, client };
  }

  it('next: before the decision it is the live leader with its compass direction and the seconds to the decision', async () => {
    const { op } = await opened();
    const s = op.publicState(new Date('2026-09-11T10:00:10Z'));
    expect(s.next).toEqual({ action: 'left', direction: 'up', decided: false, seconds: 48 });
  });

  it('next: with no price readable it is forward, the default of the rule', async () => {
    const { client } = fakeClient(none);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:10Z')).next).toEqual({ action: 'forward', direction: 'right', decided: false, seconds: 48 });
  });

  it('next: after the decision it is the approved action, held until the move', async () => {
    const { op } = await opened();
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:59Z')).next).toEqual({ action: 'left', direction: 'up', decided: true, seconds: 0 });
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.publicState(new Date('2026-09-11T10:01:01Z')).next?.decided).toBe(false);
  });

  it('next is null while no step is open', () => {
    const { client } = fakeClient(withIds);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    expect(op.publicState(T0).next).toBe(null);
  });

  it('pollActivity reads the three option books of the open step, one per action', async () => {
    const { op, calls } = await opened();
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    const reads = calls.filter(c => c.name === 'readActivity');
    expect(reads.length).toBe(1);
    expect((reads[0].args[0] as string[]).sort()).toEqual(['forward-m60', 'left-m60', 'right-m60']);
  });

  it('pollActivity reads nothing before the quotes have named the books, and nothing while no step is open', async () => {
    const { client, calls } = fakeClient(withIds);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.pollActivity(T0);
    await op.openStep(T0);
    await op.pollActivity(new Date('2026-09-11T10:00:02Z'));
    expect(calls.filter(c => c.name === 'readActivity').length).toBe(0);
  });

  it('the three books of the open step are the only books read, on every call', async () => {
    const { op, calls } = await opened();
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:36Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:46Z'));
    const sizes = calls.filter(c => c.name === 'readActivity').map(c => (c.args[0] as string[]).length);
    expect(sizes).toEqual([3, 3, 3]);
  });

  it('traders: every position in the polled books, with handle, action, horizon, side, stake and worth, no branch; distinct count this step', async () => {
    const { op } = await opened({
      'left-m60': { consensus: 3, positions: [pos('ada'), pos('bob', 20)], trades: [] },
      'forward-m60': { consensus: 2, positions: [pos('ada')], trades: [] },
    });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:11Z'));
    expect(s.traders).toEqual(expect.arrayContaining([
      { handle: 'ada', action: 'left', horizon: 'm60', side: 'higher', shares: 2, cost: 5, worth: 6 },
      { handle: 'bob', action: 'left', horizon: 'm60', side: 'higher', shares: 2, cost: 20, worth: 6 },
      { handle: 'ada', action: 'forward', horizon: 'm60', side: 'higher', shares: 2, cost: 5, worth: 6 },
    ]));
    expect(s.traders.length).toBe(3);
    expect(s.tradersThisStep).toBe(2);
  });

  it('traders are the open step\'s only: they clear when the next step opens', async () => {
    const { op, client } = await opened({ 'left-m60': { consensus: 3, positions: [pos('ada')], trades: [] } });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:11Z')).tradersThisStep).toBe(1);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    void client;
    expect(op.publicState(new Date('2026-09-11T10:01:01Z')).traders).toEqual([]);
    expect(op.publicState(new Date('2026-09-11T10:01:01Z')).tradersThisStep).toBe(0);
  });

  it('recentTrades: trades across the books, newest first, with step, action, horizon, side, kind, amount and the book price when first seen', async () => {
    const { op } = await opened({
      'left-m60': { consensus: 3.5, positions: [], trades: [trade('t1', 'ada', '2026-09-11T10:00:04Z', 5), trade('t2', 'bob', '2026-09-11T10:00:08Z', 10, 'sell')] },
      'right-m60': { consensus: 2, positions: [], trades: [trade('t3', 'cy', '2026-09-11T10:00:06Z', 1)] },
    });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:11Z'));
    expect(s.recentTrades.map(t => t.id)).toEqual(['t2', 't3', 't1']);
    expect(s.recentTrades[0]).toEqual({ id: 't2', at: '2026-09-11T10:00:08Z', handle: 'bob', step: 1, action: 'left', horizon: 'm60', side: 'higher', kind: 'sell', shares: 2, cost: 10, marketId: 'left-m60', price: 3.5 });
    expect(s.recentTrades[1].action).toBe('right');
  });

  it('recentTrades never repeats a trade seen on an earlier poll, and keeps the last 30 only', async () => {
    const trades = Array.from({ length: 40 }, (_, i) => trade(`t${i}`, 'ada', `2026-09-11T10:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`));
    const activity = { 'left-m60': { consensus: 3, positions: [], trades: trades.slice(0, 20) } };
    const { op } = await opened(activity);
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:20Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:21Z')).recentTrades.length).toBe(20);
    activity['left-m60'].trades = trades;
    await op.pollActivity(new Date('2026-09-11T10:00:30Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:31Z'));
    expect(s.recentTrades.length).toBe(30);
    expect(s.recentTrades[0].id).toBe('t39');
    expect(new Set(s.recentTrades.map(t => t.id)).size).toBe(30);
  });

  it('tradersToday counts distinct handles that traded or hold a position since midnight UTC, and resets at midnight', async () => {
    const activity: Record<string, MarketActivity> = {
      'left-m60': { consensus: 3, positions: [pos('ada')], trades: [trade('t1', 'bob', '2026-09-11T10:00:04Z')] },
    };
    const { op } = await opened(activity);
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:11Z')).tradersToday).toBe(2);
    activity['left-m60'] = { consensus: 3, positions: [], trades: [trade('t2', 'bob', '2026-09-11T10:00:12Z')] };
    await op.pollActivity(new Date('2026-09-11T10:00:20Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:21Z')).tradersToday).toBe(2);
    expect(op.publicState(new Date('2026-09-12T00:00:01Z')).tradersToday).toBe(0);
  });

  it('tradersToday and recentTrades survive a restart; traders and the leaderboard do not need to', async () => {
    const { op, client } = await opened({ 'left-m60': { consensus: 3, positions: [pos('ada')], trades: [trade('t1', 'bob', '2026-09-11T10:00:04Z')] } });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    const back = Operator.fromJSON(client, JSON.parse(JSON.stringify(op.toJSON())), rng);
    const s = back.publicState(new Date('2026-09-11T10:00:12Z'));
    expect(s.tradersToday).toBe(2);
    expect(s.recentTrades.map(t => t.id)).toEqual(['t1']);
    await back.pollActivity(new Date('2026-09-11T10:00:20Z'));
    expect(back.publicState(new Date('2026-09-11T10:00:21Z')).recentTrades.length).toBe(1);
  });

  it('a state file from before the activity fields loads with empty activity', () => {
    const { client } = fakeClient(withIds);
    const op = Operator.fromJSON(client, { game: newGame(rng, 12, 1), open: null, decisions: [], pending: null, completedAt: null }, rng);
    const s = op.publicState(T0);
    expect(s.recentTrades).toEqual([]); expect(s.traders).toEqual([]); expect(s.tradersToday).toBe(0); expect(s.leaderboard).toEqual([]);
    expect(s.bestLength).toBe(2);
  });

  it('the leaderboard is read once a minute, top five of this workspace by profit', async () => {
    const leaders = [{ rank: 1, handle: 'ada', profit: 12.5, trades: 9 }, { rank: 2, handle: 'bob', profit: -1, trades: 2 }];
    const { op, calls } = await opened({}, leaders);
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:20Z'));
    await op.pollActivity(new Date('2026-09-11T10:01:11Z'));
    const reads = calls.filter(c => c.name === 'readLeaderboard');
    expect(reads.length).toBe(2);
    expect(reads[0].args[0]).toBe(5);
    expect(op.publicState(new Date('2026-09-11T10:01:12Z')).leaderboard).toEqual(leaders);
  });

  it('a failing activity read keeps the last activity and never throws into the loop', async () => {
    const { op, client } = await opened({ 'left-m60': { consensus: 3, positions: [pos('ada')], trades: [] } });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    client.readActivity = async () => { throw new Error('503'); };
    client.readLeaderboard = async () => { throw new Error('503'); };
    await expect(op.pollActivity(new Date('2026-09-11T10:00:20Z'))).resolves.toBeUndefined();
    expect(op.publicState(new Date('2026-09-11T10:00:21Z')).traders.length).toBe(1);
  });

  it('activity polling never trades: only read calls are made', async () => {
    const { op, calls } = await opened();
    const before = calls.length;
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:46Z'));
    const names = new Set(calls.slice(before).map(c => c.name));
    expect([...names].sort()).toEqual(['readActivity', 'readLeaderboard']);
  });

  /** Head one cell from the right wall, heading right, length 4: the forward move dies. */
  const dying = () => ({ ...newGame(rng, 12, 1), snake: [{ x: 11, y: 6 }, { x: 10, y: 6 }, { x: 9, y: 6 }, { x: 8, y: 6 }], length: 4, food: { x: 0, y: 0 }, deaths: 2 });

  it('the reading is the snake\'s length: 2 again after a death, 2 again on a new game', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, dying(), rng);
    op.bestLength = 4;
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.deaths).toBe(3);
    expect(op.game.length).toBe(2);
    expect(calls.filter(c => c.name === 'postReading').map(c => c.args[0])).toEqual([2]);
    op.game = { ...op.game, complete: true };
    op.completedAt = '2026-09-11T10:01:00Z';
    await op.tick(new Date('2026-09-11T11:02:00Z'));
    expect(op.game.gameNumber).toBe(2);
    expect(calls.filter(c => c.name === 'postReading').map(c => c.args[0]).pop()).toBe(2);
  });

  it('the move that ends an attempt settles the metric at the length the attempt reached, with the game and attempt named, before the new reading', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, dying(), rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const names = calls.map(c => c.name);
    const settle = calls.find(c => c.name === 'settleMetric')!;
    expect(settle).toBeDefined();
    expect(settle.args[0]).toBe(4);
    expect(settle.args[1]).toBe('2026-09-11T10:01:00.000Z');
    expect(settle.args[2]).toBe('Game 1, attempt 3 ended at length 4');
    expect(names.indexOf('settleMetric')).toBeLessThan(names.indexOf('postReading'));
    expect(names.filter(n => n === 'settleMetric')).toHaveLength(1);
    // The next step still opens.
    expect(op.open?.step).toBe(2);
  });

  it('a move that does not end the attempt never settles anything', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, { ...newGame(rng, 12, 1), food: { x: 7, y: 6 } }, rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z')); // eats
    await op.closeStep(new Date('2026-09-11T10:01:58Z'));
    await op.tick(new Date('2026-09-11T10:02:00Z'));
    expect(calls.filter(c => c.name === 'settleMetric')).toHaveLength(0);
  });

  it('filling the grid ends the attempt too: the metric settles at the full grid', async () => {
    const { client, calls } = fakeClient(allTen);
    // A 2 by 2 grid: length 3 heading into the last free cell, where the food is.
    const g = { ...newGame(rng, 2, 1), snake: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }], heading: 'right' as const, length: 3, food: { x: 1, y: 1 } };
    const op = new Operator(client, g, rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    op['pending'] = 'down';
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.complete).toBe(true);
    const settle = calls.find(c => c.name === 'settleMetric')!;
    expect(settle.args[0]).toBe(4);
    expect(settle.args[2]).toMatch(/complete/);
  });

  it('a failed settlement is logged and the step carries on: the reading is posted and the next step opens', async () => {
    const { client, calls } = fakeClient(allTen, {}, [], true);
    const op = new Operator(client, dying(), rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(calls.filter(c => c.name === 'settleMetric')).toHaveLength(1);
    expect(calls.filter(c => c.name === 'postReading').map(c => c.args[0])).toEqual([2]);
    expect(op.open?.step).toBe(2);
    expect(op.publicState(new Date('2026-09-11T10:01:01Z')).settleFailures).toBe(1);
  });

  it('the rule names one proposal with three options, the highest price, the void with refund, and the attempt\'s one book an hour after it starts', () => {
    expect(RULE).toMatch(/reached|attempt/i);
    expect(RULE).toMatch(/one hour|hour mark/);
    expect(RULE).toMatch(/one proposal/i);
    expect(RULE).toMatch(/three options/i);
    expect(RULE).toMatch(/highest price/);
    expect(RULE).toMatch(/refund/);
    expect(RULE).not.toMatch(/1, 5 and 60|max length|impact|approved minus declined|three proposals/i);
  });

  it('bestLength is the longest the snake has been this game, persists, and resets with a new game', async () => {
    const { client } = fakeClient(allTen);
    const op = new Operator(client, { ...newGame(rng, 12, 1), food: { x: 7, y: 6 } }, rng);
    expect(op.publicState(T0).bestLength).toBe(2);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z')); // eats
    expect(op.game.length).toBe(3);
    expect(op.publicState(new Date('2026-09-11T10:01:01Z')).bestLength).toBe(3);
    const back = Operator.fromJSON(client, JSON.parse(JSON.stringify(op.toJSON())), rng);
    expect(back.publicState(new Date('2026-09-11T10:01:02Z')).bestLength).toBe(3);
    back.game = { ...back.game, complete: true };
    back.completedAt = '2026-09-11T10:01:00Z';
    await back.tick(new Date('2026-09-11T11:02:00Z'));
    expect(back.game.gameNumber).toBe(2);
    expect(back.publicState(new Date('2026-09-11T11:02:01Z')).bestLength).toBe(2);
  });

  it('/state carries a commentary line', async () => {
    const { op } = await opened();
    const s = op.publicState(new Date('2026-09-11T10:00:10Z'));
    expect(typeof s.commentary).toBe('string');
    expect(s.commentary.length).toBeGreaterThan(0);
    expect(s.commentary.includes('\n')).toBe(false);
  });
});

describe('bounded calls and the reason a step is undecided (docs/snake.md, "The step": "No call to Telarchy waits without limit")', () => {
  const hang = () => new Promise<never>(() => {});
  const T0 = new Date('2026-09-11T10:00:00Z');

  it('a poll read that does not answer is abandoned within the bound, and the step still decides at :58 on a read that does answer', async () => {
    const { client, calls } = fakeClient(upWins);
    let reads = 0;
    const stuck: TelarchyClient = { ...client, async readQuotes(refs, at) { reads++; if (reads === 1) return hang(); return client.readQuotes(refs, at); } };
    const op = new Operator(stuck, newGame(rng, 12, 1), rng, { pollTimeoutMs: 20, decideReadTimeoutMs: 20 });
    await op.openStep(T0);
    const t = Date.now();
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    expect(Date.now() - t).toBeLessThan(1000);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(false);
    expect(d.approved).toBe('left');
    expect(calls.filter(c => c.name === 'approveOption').length).toBe(1);
  });

  it('no poll starts in the last ten seconds before the decision, so a slow poll can delay nothing past :58', async () => {
    const { client, calls } = fakeClient(withIds);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    await op.pollQuotes(new Date('2026-09-11T10:00:47Z'));
    expect(calls.filter(c => c.name === 'readQuotes').length).toBe(1);
    await op.pollQuotes(new Date('2026-09-11T10:00:48Z'));
    await op.pollQuotes(new Date('2026-09-11T10:00:57Z'));
    expect(calls.filter(c => c.name === 'readQuotes').length).toBe(1);
    await op.pollActivity(new Date('2026-09-11T10:00:49Z'));
    expect(calls.filter(c => c.name === 'readActivity').length).toBe(0);
    expect(calls.filter(c => c.name === 'readLeaderboard').length).toBe(0);
    await op.pollActivity(new Date('2026-09-11T10:01:05Z'));
    expect(calls.filter(c => c.name === 'readActivity').length).toBe(1);
  });

  it('when the decision\'s own read does not answer within its bound, the decision falls on the prices last polled', async () => {
    const { client, calls } = fakeClient(upWins);
    let reads = 0;
    const stuck: TelarchyClient = { ...client, async readQuotes(refs, at) { reads++; if (reads === 2) return hang(); return client.readQuotes(refs, at); } };
    const op = new Operator(stuck, newGame(rng, 12, 1), rng, { decideReadTimeoutMs: 20 });
    await op.openStep(T0);
    await op.pollQuotes(new Date('2026-09-11T10:00:30Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(false);
    expect(d.approved).toBe('left');
    expect(op.decisions[0].undecidedReason).toBe(null);
    expect(calls.filter(c => c.name === 'approveOption').map(c => c.args)).toEqual([[op.decisions[0].proposal.id, 'left']]);
  });

  it('with nothing polled and the decision read hung, the step is undecided and says no answer', async () => {
    const { client } = fakeClient(upWins);
    const stuck: TelarchyClient = { ...client, async readQuotes() { return hang(); } };
    const op = new Operator(stuck, newGame(rng, 12, 1), rng, { decideReadTimeoutMs: 20 });
    await op.openStep(T0);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(op.decisions[0].undecidedReason).toMatch(/no answer/);
  });

  it('an undecided step records which option had no price and what was missing', async () => {
    const reasons = (): Quotes => ({
      forward: { m60: { price: null, lead: null, reason: 'no options on 2026-09-11T11:00' } },
      left: { m60: { price: null, lead: null, reason: 'no consensus' } },
      right: { m60: { price: null, lead: null, reason: 'GET /proposals/p1 -> 500' } },
    });
    const { client } = fakeClient(reasons);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    const r = op.decisions[0].undecidedReason!;
    expect(r).toMatch(/forward.*no options on 2026-09-11T11:00/);
    expect(r).toMatch(/left.*no consensus/);
    expect(r).toMatch(/right.*GET \/proposals\/p1 -> 500/);
    expect(op.publicState(new Date('2026-09-11T10:00:59Z')).recentDecisions[0].undecidedReason).toBe(r);
  });

  it('one priced option is enough to decide: the others\' missing prices are no reason', async () => {
    const one = (): Quotes => ({ forward: h(null), left: h(null), right: { m60: { price: 4, lead: null, marketId: 'r' } } });
    const { client } = fakeClient(one);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(T0);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(false);
    expect(d.approved).toBe('right');
    expect(op.decisions[0].undecidedReason).toBe(null);
  });

  it('a null price with no reason given still names the action', async () => {
    const { client } = fakeClient(none);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(op.decisions[0].undecidedReason).toMatch(/forward/);
    expect(op.decisions[0].undecidedReason).toMatch(/left/);
    expect(op.decisions[0].undecidedReason).toMatch(/right/);
  });

  it('an approval Telarchy refuses is the reason, with its error', async () => {
    const { client } = fakeClient(upWins);
    const refusing: TelarchyClient = { ...client, async approveOption() { throw new Error('POST /proposals/p1/approve -> 400 option_required'); } };
    const op = new Operator(refusing, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(op.decisions[0].undecidedReason).toBe('approve of left failed: POST /proposals/p1/approve -> 400 option_required');
  });

  it('a state file from before options (open.proposals, three refs) does not resume that step: the old proposals lapse and a fresh step opens', async () => {
    const { client, calls } = fakeClient(upWins);
    const raw = {
      game: newGame(rng), decisions: [], pending: null, completedAt: null,
      open: { step: 1, openedAt: T0.toISOString(), decideAt: '2026-09-11T10:00:58.000Z', deadline: '2026-09-11T10:01:00.000Z', cells: { m60: '2026-09-11T11:00' },
        directions: { forward: 'right', left: 'up', right: 'down' },
        proposals: { forward: { id: 'a', title: 'x: Continue forward', url: '' }, left: { id: 'b', title: 'x: Turn left', url: '' }, right: { id: 'c', title: 'x: Turn right', url: '' } },
        quotes: null, decision: null },
    };
    const op = Operator.fromJSON(client, raw, rng);
    expect(op.open).toBe(null);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(calls.filter(c => c.name === 'approveOption' || c.name === 'declineProposal').length).toBe(0);
    expect(op.open?.proposal.id).toBe('p1');
  });

  it('a decided step carries no reason, and the reason survives a restart', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(op.decisions[0].undecidedReason).toBe(null);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const stuck: TelarchyClient = { ...client, async readQuotes() { return none(); } };
    const op2 = new Operator(stuck, op.game, rng);
    op2.open = op.open;
    await op2.closeStep(new Date('2026-09-11T10:01:58Z'));
    const back = Operator.fromJSON(client, JSON.parse(JSON.stringify(op2.toJSON())), rng);
    expect(back.decisions[0].undecidedReason).toMatch(/forward/);
  });

  it('a decided step makes exactly one decision call: the approval, nothing after it', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(T0);
    const before = calls.length;
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    const writes = calls.slice(before).filter(c => c.name !== 'readQuotes');
    expect(writes.map(c => c.name)).toEqual(['approveOption']);
  });
});

describe('the feed never blanks between steps (docs/snake.md, "The feed")', () => {
  const rng = () => 0;

  it('THE FEED NEVER BLANKS THE OPEN STEP BETWEEN STEPS: the ruled step keeps its one proposal and its prices until the next is posted', async () => {
    const { client } = fakeClient(upWins);
    const seen: Array<{ step: number | null; phase: string; proposal: string | null; leftPrice: number | null }> = [];
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    // Sample the feed from inside the slow call that posts the next step's
    // proposal: that is the window in which the step used to read null.
    const slow: TelarchyClient = {
      ...client,
      async postProposal(t, d, by, options) {
        const s = op.publicState(new Date('2026-09-11T10:01:00Z'));
        seen.push({ step: s.open ? s.open.step : null, phase: s.phase, proposal: s.open ? s.open.proposal.id : null, leftPrice: s.open ? s.open.quotes.left.m60.price : null });
        return client.postProposal(t, d, by, options);
      },
    };
    (op as unknown as { client: TelarchyClient }).client = slow;
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(seen).toEqual([{ step: 1, phase: 'decided', proposal: 'p1', leftPrice: 12 }]);
    const after = op.publicState(new Date('2026-09-11T10:01:01Z'));
    expect(after.open?.step).toBe(2);
    expect(after.open?.proposal.id).toBe('p2');
    expect(after.phase).toBe('open');
  });

  it('A DECIDED STEP IS REPLACED, NOT CLEARED', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    const ruled = op.publicState(new Date('2026-09-11T10:00:59Z'));
    expect(ruled.phase).toBe('decided');
    expect(ruled.open?.proposal.id).toBe('p1');
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.open?.step).toBe(2);
    expect(op.open?.proposal.id).toBe('p2');
    expect(op.open?.decision).toBe(null);
  });

  it('AN UNDECIDED OPEN STEP STILL REFUSES A SECOND OPEN', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await expect(op.openStep(new Date('2026-09-11T10:00:10Z'))).rejects.toThrow(/already open/);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(1);
  });

  it('with no step at all the phase says so', () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng, 12, 1), rng);
    expect(op.publicState(new Date('2026-09-11T10:00:00Z')).phase).toBe('idle');
  });
});

/**
 * The feed a bot trades from (docs/snake.md, "The feed", 2026-09-12, from
 * notes/snake-agent-readiness-2026-09-12.md in the telarchy umbrella): one
 * read says what is open, what it is worth, whether it can still be bet on,
 * and how to bet on it.
 */
describe('THE FEED IS TRADEABLE FROM ONE READ', () => {
  const opts = { boardUrl: 'https://snake.telarchy.com', workspaceId: 'ws-1', metricId: 'metric-1' };

  it('/state names its schema, the attempt, the cell as an instant, when the prices were read, and how to trade', async () => {
    const { client } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng, opts);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:20Z')) as Record<string, any>;
    expect(typeof s.schema).toBe('number');
    expect(s.attempt).toBe(1);
    // The cell key keeps its display form; the instant is a real instant.
    expect(s.cell).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(s.cellEndsAt).toBe(`${s.cell}:00Z`);
    expect(Number.isNaN(Date.parse(s.cellEndsAt))).toBe(false);
    expect(s.rules).toEqual({
      decideSecond: 58,
      moveSecond: 0,
      horizonMinutes: 60,
      tieBreak: ['forward', 'left', 'right'],
      voidRefund: true,
      settlesEarlyOnDeath: true,
    });
    expect(s.rule).toBe(RULE);
    expect(s.trade).toEqual({
      base: 'https://telarchy.com/api',
      endpoint: 'POST /api/predictions/trade',
      auth: 'X-Agent-Key',
      workspaceHeader: 'X-Workspace-Id',
      workspaceId: 'ws-1',
      rangeMin: 0,
      rangeMax: op.publicState(new Date()).grid ** 2,
    });
  });

  it('open.tradeable is true only while the step is open and its deadline is ahead', async () => {
    const { client } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng, opts);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:20Z')).open?.tradeable).toBe(true);
    // Past the deadline, the step is still shown but is not tradeable.
    expect(op.publicState(new Date('2026-09-11T10:01:30Z')).open?.tradeable).toBe(false);
  });

  it('a price poll that fails leaves the market id and the last price standing', async () => {
    let calls = 0;
    const { client } = fakeClient(step => {
      calls++;
      if (calls > 1) throw new Error('quotes -> 500');
      return allTen(step);
    });
    const op = new Operator(client, newGame(rng), rng, opts);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.pollQuotes(new Date('2026-09-11T10:00:06Z'));
    const first = op.publicState(new Date('2026-09-11T10:00:07Z')).open!.quotes.left.m60;
    expect(first.price).toBe(10);
    await op.pollQuotes(new Date('2026-09-11T10:00:12Z'));
    const after = op.publicState(new Date('2026-09-11T10:00:13Z')).open!.quotes.left.m60;
    expect(after.marketId).toBe(first.marketId);
    expect(after.price).toBe(10);
  });

  it('before the first poll every quote says why it has no price', async () => {
    const { client } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng, opts);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const q = op.publicState(new Date('2026-09-11T10:00:01Z')).open!.quotes.forward.m60;
    expect(q.price).toBe(null);
    expect(q.reason).toBe('not polled yet');
    expect(op.publicState(new Date('2026-09-11T10:00:01Z')).quotesAt).toBe(null);
  });

  it('a restored step whose deadline has passed is dropped, never served as open', async () => {
    const { client } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng, opts);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const saved = JSON.parse(JSON.stringify(op.toJSON()));
    const back = Operator.fromJSON(client, saved, rng, opts, new Date('2026-09-11T10:30:00Z'));
    expect(back.publicState(new Date('2026-09-11T10:30:00Z')).open).toBe(null);
    const still = Operator.fromJSON(client, saved, rng, opts, new Date('2026-09-11T10:00:30Z'));
    expect(still.publicState(new Date('2026-09-11T10:00:30Z')).open?.step).toBe(1);
  });
});

describe('THE HTTP SURFACE ANSWERS A BOT IN JSON', () => {
  async function serve() {
    const { createServer } = await import('../src/server.js');
    const { client } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng, { boardUrl: 'https://snake.telarchy.com' });
    const server = createServer(op, Buffer.from('<html></html>'));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => server.close(() => r())) };
  }

  it('an unknown path is JSON and carries the CORS header', async () => {
    const { base, close } = await serve();
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ error: 'not found' });
    await close();
  });

  it('a write method is refused with 405 and an allow header; OPTIONS answers the preflight', async () => {
    const { base, close } = await serve();
    const post = await fetch(`${base}/state`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect((await post.json()).error).toBe('method not allowed');
    const pre = await fetch(`${base}/state`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    await close();
  });

  it('a reader that hammers the feed is capped, with retry-after', async () => {
    const { base, close } = await serve();
    let last = new Response();
    for (let i = 0; i < 65; i++) last = await fetch(`${base}/state`);
    expect(last.status).toBe(429);
    expect(last.headers.get('retry-after')).toBeTruthy();
    expect((await last.json()).error).toBe('too many requests');
    await close();
  });
});
