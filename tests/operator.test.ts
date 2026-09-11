import { describe, it, expect } from 'vitest';
import { Operator, RULE, type TelarchyClient, type ProposalRef, type MarketActivity, type LeaderRow } from '../src/operator.js';
import { newGame } from '../src/engine.js';
import type { Quotes } from '../src/decide.js';

type Call = { name: string; args: unknown[] };

function fakeClient(quotesFor: (step: number) => Quotes, activity: Record<string, MarketActivity> = {}, leaders: LeaderRow[] = [], settleFails = false) {
  const calls: Call[] = [];
  let n = 0;
  const client: TelarchyClient = {
    async postProposal(title, description, decideBy) {
      calls.push({ name: 'postProposal', args: [title, description, decideBy.toISOString()] });
      return { id: `p${++n}`, title, url: `https://telarchy.com/snake/p/${n}` };
    },
    async readQuotes(refs: ProposalRef[], openedAt: Date) {
      calls.push({ name: 'readQuotes', args: [refs.map(r => r.id), openedAt.toISOString()] });
      const step = Number(calls.filter(c => c.name === 'readQuotes').length);
      return quotesFor(step);
    },
    async decideProposal(ref, verdict) {
      calls.push({ name: 'decideProposal', args: [ref.id, verdict] });
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
    async setRange(max) {
      calls.push({ name: 'setRange', args: [max] });
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
    q[a][h] = { ...q[a][h], approvedMarketId: `${a}-${h}-a`, declinedMarketId: `${a}-${h}-d` };
  }
  return q;
};
const trade = (id: string, handle: string, at: string, cost = 5, kind: 'buy' | 'sell' = 'buy') =>
  ({ id, handle, direction: 'higher' as const, kind, shares: 2, cost, createdAt: at });
const pos = (handle: string, cost = 5) => ({ handle, direction: 'higher' as const, shares: 2, cost, worth: 6 });

const h = (a: number | null, d: number | null) => ({ m60: { approved: a, declined: d } });
const allTen = (): Quotes => ({ forward: h(10, 10), left: h(10, 10), right: h(10, 10) });
const upWins = (): Quotes => ({ ...allTen(), left: h(12, 10) }); // the snake heads right at the start, so 'left' turns it up
const none = (): Quotes => ({ forward: h(null, null), left: h(null, null), right: h(null, null) });

const rng = () => 0;

describe('the operator loop (docs/snake.md, "The step" and "What must hold")', () => {
  it('posts exactly three proposals per minute, titled Game G, attempt A, move N: Turn left / Turn right / Continue forward, all with the same deadline: the next top of minute', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00.700Z'));
    const posts = calls.filter(c => c.name === 'postProposal');
    expect(posts.map(c => c.args[0]).sort()).toEqual(['Game 1, attempt 1, move 1: Continue forward', 'Game 1, attempt 1, move 1: Turn left', 'Game 1, attempt 1, move 1: Turn right']);
    expect(posts.every(c => c.args[2] === '2026-09-11T10:01:00.000Z')).toBe(true);
    expect(op.open?.decideAt).toBe('2026-09-11T10:00:58.000Z');
    expect(op.open?.deadline).toBe('2026-09-11T10:01:00.000Z');
    await expect(op.openStep(new Date('2026-09-11T10:00:30Z'))).rejects.toThrow(/already open/);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(3);
  });

  it('the description names the step, the state, the record, the one cell, the rule and the board, in one line', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng, { boardUrl: 'https://snake.telarchy.com' });
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const desc = String(calls.find(c => c.name === 'postProposal')!.args[1]);
    expect(desc).toMatch(/step 1\b/i);
    expect(desc).toMatch(/length 2\b/);
    expect(desc).toMatch(/heading right/);
    expect(desc).toMatch(/left.*up|up.*left/i); // turning left from right goes up
    expect(desc).not.toContain('10:01');
    expect(desc).not.toContain('10:05');
    expect(desc).toContain('11:00');
    expect(desc).toMatch(/60.move/i);
    expect(desc).toMatch(/record 2\b/i);
    expect(desc).toMatch(/reached|attempt/i);
    expect(desc).not.toMatch(/1, 5 and 60|max length/i);
    expect(desc).toContain('https://snake.telarchy.com');
    expect(desc.includes('\n')).toBe(false);
    expect(desc.length).toBeLessThan(600);
  });

  it('the three proposals are posted concurrently, not one after another', async () => {
    const { client, calls } = fakeClient(allTen);
    let inFlight = 0, maxInFlight = 0;
    const slow: TelarchyClient = {
      ...client,
      async postProposal(t, d, by) {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        return client.postProposal(t, d, by);
      },
    };
    const op = new Operator(slow, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(maxInFlight).toBe(3);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(3);
  });

  it('polling during the minute publishes live quotes on the open step without deciding', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:05Z')).open?.quotes.left.m60.approved).toBe(null);
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:06Z')).open?.quotes.left.m60.approved).toBe(12);
    expect(op.open?.decision).toBe(null);
    expect(calls.filter(c => c.name === 'decideProposal').length).toBe(0);
  });

  it('decides before the deadline: approves the highest 60-move impact, declines the other two', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.approved).toBe('left');
    expect(d.direction).toBe('up');
    const verdicts = calls.filter(c => c.name === 'decideProposal').map(c => c.args);
    const left = op.decisions[0].proposals.left.id;
    expect(verdicts[0]).toEqual([left, 'approve']);
    expect(verdicts.slice(1).map(v => v[1])).toEqual(['decline', 'decline']);
  });

  it('the move is applied at the next top of minute, then the next four are posted', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(op.game.step).toBe(0);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.step).toBe(1);
    expect(op.game.heading).toBe('up');
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(6);
  });

  it('with no price readable the snake continues forward, all three are declined, nothing stays pending', async () => {
    const { client, calls } = fakeClient(none);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(calls.filter(c => c.name === 'decideProposal' && c.args[1] === 'decline').length).toBe(3);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.game.heading).toBe('right');
    expect(op.game.snake[0]).toEqual({ x: 7, y: 6 });
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
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(d.direction).toBe('right');
    // The failed approve is retried as a decline: nothing stays pending.
    const verdicts = calls.filter(c => c.name === 'decideProposal').map(c => c.args);
    expect(verdicts.map(v => v[1])).toEqual(['decline', 'decline', 'decline']);
    expect(op.decisions[0].undecided).toBe(true);
  });

  it('posts a reading after every step, and marks the last reading before midnight UTC final', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
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
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const names = new Set(calls.map(c => c.name));
    expect([...names].sort()).toEqual(['decideProposal', 'postProposal', 'postReading', 'readQuotes', 'refreshBooks']);
    expect(Object.keys(client).some(k => /trade|order/i.test(k))).toBe(false);
  });

  it('forces the rolling-market refresh before the three proposals of every step', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(calls[0].name).toBe('refreshBooks');
    expect(calls[1].name).toBe('postProposal');
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(calls.filter(c => c.name === 'refreshBooks').length).toBe(2);
    const second = calls.map(c => c.name).lastIndexOf('refreshBooks');
    expect(calls[second + 1].name).toBe('postProposal');
  });

  it('the quotes are read for the minute the step opened in, so the client can name its cells', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00.700Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(calls.find(c => c.name === 'readQuotes')!.args[1]).toBe('2026-09-11T10:00:00.700Z');
  });

  it('a step never opens with under ten seconds to its deadline (a restart late in the minute waits for the next one)', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng);
    expect(op.canOpen(new Date('2026-09-11T10:00:51Z'))).toBe(false);
    expect(op.canOpen(new Date('2026-09-11T10:00:49Z'))).toBe(true);
    await expect(op.openStep(new Date('2026-09-11T10:00:55Z'))).rejects.toThrow(/deadline/);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(0);
  });

  it('a complete game posts the full length as its reading every minute and no proposals, for one hour', async () => {
    const { client, calls } = fakeClient(upWins);
    const g = { ...newGame(rng), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(op.completedAt).toBe('2026-09-11T10:01:00.000Z');
    await op.tick(new Date('2026-09-11T10:02:00Z'));
    await op.tick(new Date('2026-09-11T10:30:00Z'));
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(0);
    expect(calls.filter(c => c.name === 'postReading').map(c => c.args[0])).toEqual([144, 144, 144]);
    expect(op.open).toBe(null);
    const st = op.publicState(new Date('2026-09-11T10:31:00Z'));
    expect(st.complete).toBe(true);
    expect(st.nextGameAt).toBe('2026-09-11T11:01:00.000Z');
    await expect(op.openStep(new Date('2026-09-11T10:32:00Z'))).rejects.toThrow(/complete/);
  });

  it('after the hour, the range is raised to the new full grid and a new game starts one cell larger, numbered up', async () => {
    const { client, calls } = fakeClient(upWins);
    const g = { ...newGame(rng), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T11:01:00Z'));
    expect(calls.filter(c => c.name === 'setRange').map(c => c.args[0])).toEqual([169]);
    expect(op.game.size).toBe(13);
    expect(op.game.gameNumber).toBe(2);
    expect(op.game.length).toBe(2);
    expect(op.game.complete).toBe(false);
    expect(op.completedAt).toBe(null);
    // the range is raised before the new game's proposals are posted
    const names = calls.map(c => c.name);
    expect(names.indexOf('setRange')).toBeLessThan(names.lastIndexOf('postProposal'));
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(3);
    expect(op.publicState(new Date('2026-09-11T11:01:10Z')).grid).toBe(13);
  });

  it('if the range cannot be raised yet (a traded open book), the cooldown continues and it is retried next minute', async () => {
    const { client, calls } = fakeClient(upWins);
    let fails = 1;
    const blocked: TelarchyClient = { ...client, async setRange(max) { if (fails-- > 0) throw new Error('409'); return client.setRange(max); } };
    const g = { ...newGame(rng), complete: true, length: 144 };
    const op = new Operator(blocked, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T11:01:00Z'));
    expect(op.game.size).toBe(12);
    expect(op.game.complete).toBe(true);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(0);
    await op.tick(new Date('2026-09-11T11:02:00Z'));
    expect(op.game.size).toBe(13);
    expect(calls.filter(c => c.name === 'setRange').length).toBe(1);
  });

  it('the completion instant and game number survive a restart', async () => {
    const { client } = fakeClient(upWins);
    const g = { ...newGame(rng), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const op2 = Operator.fromJSON(client, JSON.parse(JSON.stringify(op.toJSON())), rng);
    expect(op2.completedAt).toBe(op.completedAt);
    expect(op2.game.gameNumber).toBe(1);
  });

  it('a failing refresh does not stop the three proposals', async () => {
    const { client, calls } = fakeClient(upWins);
    const flaky: TelarchyClient = { ...client, async refreshBooks() { throw new Error('503'); } };
    const op = new Operator(flaky, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(3);
  });

  it('records the last ten decisions with the four prices and the length change', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
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
    expect(d.quotes.left.m60.approved).toBe(12);
    expect(d.action).toBe('left');
    expect(typeof d.lengthBefore).toBe('number');
    expect(typeof d.lengthAfter).toBe('number');
    expect(d.proposals.left.url).toMatch(/^https:/);
  });

  it('state round-trips through JSON so a restart continues the game', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    const json = JSON.stringify(op.toJSON());
    const op2 = Operator.fromJSON(client, JSON.parse(json), rng);
    expect(op2.game).toEqual(op.game);
    expect(op2.decisions).toEqual(op.decisions);
    expect(op2.open?.step).toBe(op.open?.step);
  });

  it('/state names the grid size so a board can draw it', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    expect(op.publicState(new Date()).grid).toBe(12);
    expect(op.publicState(new Date()).gameNumber).toBe(1);
  });

  it('/state carries the game, the open proposals with prices, recent decisions and counters', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng, { workspaceId: 'ws-1', metricId: 'm-1' });
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:20Z'));
    expect(s.game.length).toBe(2);
    expect(s.open?.proposals.forward.url).toMatch(/^https:/);
    expect(s.game.heading).toBe('right');
    expect(s.open?.directions).toEqual({ forward: 'right', left: 'up', right: 'down' });
    expect(s.open?.decideAt).toBe('2026-09-11T10:00:58.000Z');
    expect(s.open?.deadline).toBe('2026-09-11T10:01:00.000Z');
    expect(s.open?.cells).toEqual({ m60: '2026-09-11T11:00' });
    expect(s.nextStepAt).toBe('2026-09-11T10:01:00.000Z');
    expect(s.complete).toBe(false);
    expect(s.secondsToDecision).toBe(38);
    expect(typeof s.rule).toBe('string');
    expect(s.rule).toMatch(/60/);
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
    const op = new Operator(client, newGame(rng), rng);
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
    const op = new Operator(client, newGame(rng), rng);
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
    const op = new Operator(client, newGame(rng), rng);
    expect(op.publicState(T0).next).toBe(null);
  });

  it('pollActivity reads the six 60-move books of the open step, approved and declined per action', async () => {
    const { op, calls } = await opened();
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    const reads = calls.filter(c => c.name === 'readActivity');
    expect(reads.length).toBe(1);
    expect((reads[0].args[0] as string[]).sort()).toEqual(['forward-m60-a', 'forward-m60-d', 'left-m60-a', 'left-m60-d', 'right-m60-a', 'right-m60-d']);
  });

  it('pollActivity reads nothing before the quotes have named the books, and nothing while no step is open', async () => {
    const { client, calls } = fakeClient(withIds);
    const op = new Operator(client, newGame(rng), rng);
    await op.pollActivity(T0);
    await op.openStep(T0);
    await op.pollActivity(new Date('2026-09-11T10:00:02Z'));
    expect(calls.filter(c => c.name === 'readActivity').length).toBe(0);
  });

  it('the six books of the open step are the only books read, on every call', async () => {
    const { op, calls } = await opened();
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:36Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:46Z'));
    const sizes = calls.filter(c => c.name === 'readActivity').map(c => (c.args[0] as string[]).length);
    expect(sizes).toEqual([6, 6, 6]);
  });

  it('traders: every position in the polled books, with handle, action, horizon, branch, side, stake and worth; distinct count this step', async () => {
    const { op } = await opened({
      'left-m60-a': { consensus: 3, positions: [pos('ada'), pos('bob', 20)], trades: [] },
      'forward-m60-d': { consensus: 2, positions: [pos('ada')], trades: [] },
    });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:11Z'));
    expect(s.traders).toEqual(expect.arrayContaining([
      { handle: 'ada', action: 'left', horizon: 'm60', branch: 'approved', side: 'higher', shares: 2, cost: 5, worth: 6 },
      { handle: 'bob', action: 'left', horizon: 'm60', branch: 'approved', side: 'higher', shares: 2, cost: 20, worth: 6 },
      { handle: 'ada', action: 'forward', horizon: 'm60', branch: 'declined', side: 'higher', shares: 2, cost: 5, worth: 6 },
    ]));
    expect(s.traders.length).toBe(3);
    expect(s.tradersThisStep).toBe(2);
  });

  it('traders are the open step\'s only: they clear when the next step opens', async () => {
    const { op, client } = await opened({ 'left-m60-a': { consensus: 3, positions: [pos('ada')], trades: [] } });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:11Z')).tradersThisStep).toBe(1);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    void client;
    expect(op.publicState(new Date('2026-09-11T10:01:01Z')).traders).toEqual([]);
    expect(op.publicState(new Date('2026-09-11T10:01:01Z')).tradersThisStep).toBe(0);
  });

  it('recentTrades: trades across the books, newest first, with step, action, horizon, branch, side, kind, amount and the book price when first seen', async () => {
    const { op } = await opened({
      'left-m60-a': { consensus: 3.5, positions: [], trades: [trade('t1', 'ada', '2026-09-11T10:00:04Z', 5), trade('t2', 'bob', '2026-09-11T10:00:08Z', 10, 'sell')] },
      'right-m60-d': { consensus: 2, positions: [], trades: [trade('t3', 'cy', '2026-09-11T10:00:06Z', 1)] },
    });
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:11Z'));
    expect(s.recentTrades.map(t => t.id)).toEqual(['t2', 't3', 't1']);
    expect(s.recentTrades[0]).toEqual({ id: 't2', at: '2026-09-11T10:00:08Z', handle: 'bob', step: 1, action: 'left', horizon: 'm60', branch: 'approved', side: 'higher', kind: 'sell', shares: 2, cost: 10, marketId: 'left-m60-a', price: 3.5 });
    expect(s.recentTrades[1].branch).toBe('declined');
    expect(s.recentTrades[1].action).toBe('right');
  });

  it('recentTrades never repeats a trade seen on an earlier poll, and keeps the last 30 only', async () => {
    const trades = Array.from({ length: 40 }, (_, i) => trade(`t${i}`, 'ada', `2026-09-11T10:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`));
    const activity = { 'left-m60-a': { consensus: 3, positions: [], trades: trades.slice(0, 20) } };
    const { op } = await opened(activity);
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    await op.pollActivity(new Date('2026-09-11T10:00:20Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:21Z')).recentTrades.length).toBe(20);
    activity['left-m60-a'].trades = trades;
    await op.pollActivity(new Date('2026-09-11T10:00:30Z'));
    const s = op.publicState(new Date('2026-09-11T10:00:31Z'));
    expect(s.recentTrades.length).toBe(30);
    expect(s.recentTrades[0].id).toBe('t39');
    expect(new Set(s.recentTrades.map(t => t.id)).size).toBe(30);
  });

  it('tradersToday counts distinct handles that traded or hold a position since midnight UTC, and resets at midnight', async () => {
    const activity: Record<string, MarketActivity> = {
      'left-m60-a': { consensus: 3, positions: [pos('ada')], trades: [trade('t1', 'bob', '2026-09-11T10:00:04Z')] },
    };
    const { op } = await opened(activity);
    await op.pollActivity(new Date('2026-09-11T10:00:10Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:11Z')).tradersToday).toBe(2);
    activity['left-m60-a'] = { consensus: 3, positions: [], trades: [trade('t2', 'bob', '2026-09-11T10:00:12Z')] };
    await op.pollActivity(new Date('2026-09-11T10:00:20Z'));
    expect(op.publicState(new Date('2026-09-11T10:00:21Z')).tradersToday).toBe(2);
    expect(op.publicState(new Date('2026-09-12T00:00:01Z')).tradersToday).toBe(0);
  });

  it('tradersToday and recentTrades survive a restart; traders and the leaderboard do not need to', async () => {
    const { op, client } = await opened({ 'left-m60-a': { consensus: 3, positions: [pos('ada')], trades: [trade('t1', 'bob', '2026-09-11T10:00:04Z')] } });
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
    const op = Operator.fromJSON(client, { game: newGame(rng), open: null, decisions: [], pending: null, completedAt: null }, rng);
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
    const { op, client } = await opened({ 'left-m60-a': { consensus: 3, positions: [pos('ada')], trades: [] } });
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
  const dying = () => ({ ...newGame(rng), snake: [{ x: 11, y: 6 }, { x: 10, y: 6 }, { x: 9, y: 6 }, { x: 8, y: 6 }], length: 4, food: { x: 0, y: 0 }, deaths: 2 });

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
    const op = new Operator(client, { ...newGame(rng), food: { x: 7, y: 6 } }, rng);
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

  it('the rule names the reached length of the attempt on the 60-move horizon', () => {
    expect(RULE).toMatch(/reached|attempt/i);
    expect(RULE).toMatch(/60 moves/);
    expect(RULE).not.toMatch(/1, 5 and 60|max length/i);
  });

  it('bestLength is the longest the snake has been this game, persists, and resets with a new game', async () => {
    const { client } = fakeClient(allTen);
    const op = new Operator(client, { ...newGame(rng), food: { x: 7, y: 6 } }, rng);
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
    const op = new Operator(stuck, newGame(rng), rng, { pollTimeoutMs: 20, decideReadTimeoutMs: 20 });
    await op.openStep(T0);
    const t = Date.now();
    await op.pollQuotes(new Date('2026-09-11T10:00:05Z'));
    expect(Date.now() - t).toBeLessThan(1000);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(false);
    expect(d.approved).toBe('left');
    expect(calls.filter(c => c.name === 'decideProposal' && c.args[1] === 'approve').length).toBe(1);
  });

  it('no poll starts in the last ten seconds before the decision, so a slow poll can delay nothing past :58', async () => {
    const { client, calls } = fakeClient(withIds);
    const op = new Operator(client, newGame(rng), rng);
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
    const op = new Operator(stuck, newGame(rng), rng, { decideReadTimeoutMs: 20 });
    await op.openStep(T0);
    await op.pollQuotes(new Date('2026-09-11T10:00:30Z'));
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(false);
    expect(d.approved).toBe('left');
    expect(op.decisions[0].undecidedReason).toBe(null);
    expect(calls.filter(c => c.name === 'decideProposal' && c.args[1] === 'approve').map(c => c.args[0])).toEqual([op.decisions[0].proposals.left.id]);
  });

  it('with nothing polled and the decision read hung, the step is undecided and says no answer', async () => {
    const { client } = fakeClient(upWins);
    const stuck: TelarchyClient = { ...client, async readQuotes() { return hang(); } };
    const op = new Operator(stuck, newGame(rng), rng, { decideReadTimeoutMs: 20 });
    await op.openStep(T0);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(op.decisions[0].undecidedReason).toMatch(/no answer/);
  });

  it('an undecided step records which action had no price and what was missing', async () => {
    const reasons = (): Quotes => ({
      forward: { m60: { approved: null, declined: null, reason: 'no pair on 2026-09-11T11:00' } },
      left: { m60: { approved: 3, declined: null, reason: 'no consensus' } },
      right: { m60: { approved: null, declined: null, reason: 'GET /proposals/p3 -> 500' } },
    });
    const { client } = fakeClient(reasons);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(T0);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    const r = op.decisions[0].undecidedReason!;
    expect(r).toMatch(/forward.*no pair on 2026-09-11T11:00/);
    expect(r).toMatch(/left.*no consensus/);
    expect(r).toMatch(/right.*GET \/proposals\/p3 -> 500/);
    expect(op.publicState(new Date('2026-09-11T10:00:59Z')).recentDecisions[0].undecidedReason).toBe(r);
  });

  it('a null price with no reason given still names the action', async () => {
    const { client } = fakeClient(none);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(op.decisions[0].undecidedReason).toMatch(/forward/);
    expect(op.decisions[0].undecidedReason).toMatch(/left/);
    expect(op.decisions[0].undecidedReason).toMatch(/right/);
  });

  it('an approval Telarchy refuses is the reason, with its error', async () => {
    const { client } = fakeClient(upWins);
    const refusing: TelarchyClient = {
      ...client,
      async decideProposal(ref, verdict) {
        if (verdict === 'approve') throw new Error('POST /proposals/p2/approve -> 400 Proposal is not pending');
        return client.decideProposal(ref, verdict);
      },
    };
    const op = new Operator(refusing, newGame(rng), rng);
    await op.openStep(T0);
    const d = await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(d.undecided).toBe(true);
    expect(op.decisions[0].undecidedReason).toBe('approve of left failed: POST /proposals/p2/approve -> 400 Proposal is not pending');
  });

  it('a decided step carries no reason, and the reason survives a restart', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
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

  it('the decision\'s three declines after the approval run concurrently, so the decision lands inside the two seconds', async () => {
    const { client } = fakeClient(upWins);
    let inFlight = 0, maxInFlight = 0;
    const slow: TelarchyClient = {
      ...client,
      async decideProposal(ref, verdict) {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        return client.decideProposal(ref, verdict);
      },
    };
    const op = new Operator(slow, newGame(rng), rng);
    await op.openStep(T0);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    expect(maxInFlight).toBe(2);
  });
});
