import { describe, it, expect } from 'vitest';
import { Operator, type TelarchyClient, type ProposalRef } from '../src/operator.js';
import { newGame } from '../src/engine.js';
import type { Quotes } from '../src/decide.js';

type Call = { name: string; args: unknown[] };

function fakeClient(quotesFor: (step: number) => Quotes) {
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
    async refreshBooks() {
      calls.push({ name: 'refreshBooks', args: [] });
    },
  };
  return { client, calls };
}

const h = (a: number | null, d: number | null) => ({ m1: { approved: a, declined: d }, m5: { approved: a, declined: d }, m60: { approved: a, declined: d } });
const allTen = (): Quotes => ({ forward: h(10, 10), left: h(10, 10), right: h(10, 10) });
const upWins = (): Quotes => ({ ...allTen(), left: h(12, 10) }); // the snake heads right at the start, so 'left' turns it up
const none = (): Quotes => ({ forward: h(null, null), left: h(null, null), right: h(null, null) });

const rng = () => 0;

describe('the operator loop (docs/snake.md, "The step" and "What must hold")', () => {
  it('posts exactly three proposals per minute, titled Turn left / Turn right / Continue forward, all with the same deadline: the next top of minute', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00.700Z'));
    const posts = calls.filter(c => c.name === 'postProposal');
    expect(posts.map(c => c.args[0]).sort()).toEqual(['Continue forward', 'Turn left', 'Turn right']);
    expect(posts.every(c => c.args[2] === '2026-09-11T10:01:00.000Z')).toBe(true);
    expect(op.open?.decideAt).toBe('2026-09-11T10:00:58.000Z');
    expect(op.open?.deadline).toBe('2026-09-11T10:01:00.000Z');
    await expect(op.openStep(new Date('2026-09-11T10:00:30Z'))).rejects.toThrow(/already open/);
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(3);
  });

  it('the description names the step, the state, the three cells, the rule and the board, in one line', async () => {
    const { client, calls } = fakeClient(allTen);
    const op = new Operator(client, newGame(rng), rng, { boardUrl: 'https://snake.telarchy.com' });
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const desc = String(calls.find(c => c.name === 'postProposal')!.args[1]);
    expect(desc).toMatch(/step 1\b/i);
    expect(desc).toMatch(/length 2\b/);
    expect(desc).toMatch(/heading right/);
    expect(desc).toMatch(/left.*up|up.*left/i); // turning left from right goes up
    expect(desc).toContain('10:01');
    expect(desc).toContain('10:05');
    expect(desc).toContain('11:00');
    expect(desc).toMatch(/60.move/i);
    expect(desc).toContain('https://snake.telarchy.com');
    expect(desc.includes('\n')).toBe(false);
    expect(desc.length).toBeLessThan(600);
  });

  it('the four proposals are posted concurrently, not one after another', async () => {
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
  });

  it('forces the rolling-market refresh before the four proposals of every step', async () => {
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

  it('a complete game posts its final reading and no more proposals', async () => {
    const { client, calls } = fakeClient(upWins);
    const g = { ...newGame(rng), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(calls.filter(c => c.name === 'postProposal').length).toBe(0);
    expect(calls.filter(c => c.name === 'postReading').length).toBe(1);
    expect(op.open).toBe(null);
    expect(op.publicState(new Date('2026-09-11T10:01:05Z')).complete).toBe(true);
    await expect(op.openStep(new Date('2026-09-11T10:02:00Z'))).rejects.toThrow(/complete/);
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
    expect(s.open?.cells).toEqual({ m1: '2026-09-11T10:01', m5: '2026-09-11T10:05', m60: '2026-09-11T11:00' });
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
