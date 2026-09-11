import { describe, it, expect } from 'vitest';
import { Operator, type TelarchyClient, type ProposalRef } from '../src/operator.js';
import { newGame, step as applyStep } from '../src/engine.js';
import { actionOfTitle, proposalTitle } from '../src/decide.js';
import type { Quotes } from '../src/decide.js';

type Call = { name: string; args: unknown[] };
function fakeClient(quotesFor: () => Quotes) {
  const calls: Call[] = [];
  let n = 0;
  const client: TelarchyClient = {
    async postProposal(title, description, decideBy) {
      calls.push({ name: 'postProposal', args: [title, description, decideBy.toISOString()] });
      return { id: `p${++n}`, title, url: `https://telarchy.com/snake/p/${n}` };
    },
    async readQuotes(_refs: ProposalRef[]) { return quotesFor(); },
    async decideProposal() {},
    async postReading() {},
    async refreshBooks() {},
    async setRange() {},
    async readActivity() { return {}; },
    async readLeaderboard() { return []; },
  };
  return { client, calls };
}
const h = (a: number | null, d: number | null) => ({ m1: { approved: a, declined: d }, m5: { approved: a, declined: d }, m60: { approved: a, declined: d } });
const allTen = (): Quotes => ({ forward: h(10, 10), left: h(10, 10), right: h(10, 10) });
const upWins = (): Quotes => ({ ...allTen(), left: h(12, 10) });
const none = (): Quotes => ({ forward: h(null, null), left: h(null, null), right: h(null, null) });
const rng = () => 0;

async function playSteps(op: Operator, n: number, start = Date.parse('2026-09-11T10:00:00Z')) {
  for (let i = 0; i < n; i++) {
    if (!op.open) await op.openStep(new Date(start + i * 60_000));
    await op.closeStep(new Date(start + i * 60_000 + 58_000));
    await op.tick(new Date(start + (i + 1) * 60_000));
  }
}

describe('proposal titles (docs/snake.md, "The step")', () => {
  it('a title names the game and the move, then the action: Game 1, move 171: Turn left', () => {
    expect(proposalTitle('left', 1, 171)).toBe('Game 1, move 171: Turn left');
    expect(proposalTitle('forward', 3, 1)).toBe('Game 3, move 1: Continue forward');
    expect(proposalTitle('right', 12, 9999)).toBe('Game 12, move 9999: Turn right');
  });

  it('every title stays under the 80 characters Telarchy accepts', () => {
    expect(proposalTitle('forward', 999999, 99999999).length).toBeLessThan(80);
  });

  it('the action is read back from a titled proposal, and from a bare title too', () => {
    expect(actionOfTitle('Game 1, move 171: Turn left')).toBe('left');
    expect(actionOfTitle('Game 2, move 3: Continue forward')).toBe('forward');
    expect(actionOfTitle('Game 2, move 3: Turn right')).toBe('right');
    expect(actionOfTitle('Turn left')).toBe('left');
    expect(actionOfTitle('Game 1, move 2: Sit still')).toBe(null);
    expect(actionOfTitle('')).toBe(null);
  });

  it('the operator posts the three proposals of each step titled with the game and the move it decides', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    const titles = () => calls.filter(c => c.name === 'postProposal').map(c => String(c.args[0]));
    expect(titles().sort()).toEqual(['Game 1, move 1: Continue forward', 'Game 1, move 1: Turn left', 'Game 1, move 1: Turn right']);
    await op.closeStep(new Date('2026-09-11T10:00:58Z'));
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    expect(titles().slice(3).sort()).toEqual(['Game 1, move 2: Continue forward', 'Game 1, move 2: Turn left', 'Game 1, move 2: Turn right']);
  });

  it('a later game numbers its titles by that game, from move 1 again', async () => {
    const { client, calls } = fakeClient(upWins);
    const op = new Operator(client, { ...newGame(rng, 12, 2), step: 40 }, rng);
    await op.openStep(new Date('2026-09-11T10:00:00Z'));
    expect(calls.filter(c => c.name === 'postProposal').map(c => c.args[0])).toContain('Game 2, move 41: Turn left');
  });
});

describe('the replay record (docs/snake.md, "The replay" and "The feed")', () => {
  it('a fresh operator records the start frame of game 1 at step 0 and no moves', () => {
    const op = new Operator(fakeClient(allTen).client, newGame(rng), rng);
    const r = op.replay();
    expect(r).not.toBe(null);
    expect(r!.games).toEqual([1]);
    expect(r!.gameNumber).toBe(1);
    expect(r!.size).toBe(12);
    expect(r!.start).toEqual({ step: 0, snake: [{ x: 6, y: 6 }, { x: 5, y: 6 }], heading: 'right', food: { x: 0, y: 0 }, deaths: 0 });
    expect(r!.moves).toEqual([]);
  });

  it('every applied move is recorded with its step, time, action, direction and whether it was undecided', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await playSteps(op, 2);
    const r = op.replay()!;
    expect(r.moves.length).toBe(2);
    expect(r.moves[0]).toMatchObject({ step: 1, at: '2026-09-11T10:01:00.000Z', action: 'left', direction: 'up', undecided: false, died: false });
    expect(r.moves[1]).toMatchObject({ step: 2, at: '2026-09-11T10:02:00.000Z', action: 'left', direction: 'left', undecided: false, died: false });
    expect(r.moves[0]).not.toHaveProperty('food');
  });

  it('an undecided step is recorded as forward and undecided', async () => {
    const { client } = fakeClient(none);
    const op = new Operator(client, newGame(rng), rng);
    await playSteps(op, 1);
    expect(op.replay()!.moves[0]).toMatchObject({ step: 1, action: 'forward', direction: 'right', undecided: true });
  });

  it('the food is recorded only when the move changed it, and a death is marked with the new food', async () => {
    const { client } = fakeClient(allTen); // ties continue forward: the snake runs right into the wall
    const g = { ...newGame(rng), food: { x: 7, y: 6 } }; // one cell ahead
    const op = new Operator(client, g, rng);
    await playSteps(op, 6);
    const r = op.replay()!;
    expect(r.moves[0].food).toEqual({ x: 0, y: 0 }); // eaten at once, the rng spawns at 0,0
    expect(r.moves[1]).not.toHaveProperty('food');
    const death = r.moves.find(m => m.died)!;
    expect(death).toBeTruthy();
    expect(death.step).toBe(6); // 7,8,9,10,11 then off the grid
    expect(death.food).toEqual({ x: 0, y: 0 });
  });

  it('replaying the recorded moves through the rules reproduces the live game exactly', async () => {
    const { client } = fakeClient(upWins);
    const rnd = () => Math.floor(Math.random() * 144);
    const op = new Operator(client, newGame(rnd), rnd);
    await playSteps(op, 30);
    const r = op.replay()!;
    let snake = r.start.snake, food = r.start.food, deaths = r.start.deaths;
    for (const m of r.moves) {
      const before = { snake, heading: 'right' as const, food, length: snake.length, step: 0, deaths, complete: false, size: r.size, gameNumber: 1 };
      const after = applyStep(before, m.direction, () => { if (!m.food) throw new Error('no food recorded'); return m.food.y * r.size + m.food.x; });
      snake = after.snake; food = after.food; deaths = after.deaths;
      expect(after.deaths > before.deaths).toBe(!!m.died);
    }
    expect(snake).toEqual(op.game.snake);
    expect(food).toEqual(op.game.food);
    expect(deaths).toBe(op.game.deaths);
  });

  it('from=I returns the moves from index I on, so a follower reads only what it lacks', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await playSteps(op, 5);
    expect(op.replay(undefined, 3)!.moves.map(m => m.step)).toEqual([4, 5]);
    expect(op.replay(undefined, 5)!.moves).toEqual([]);
    expect(op.replay(undefined, 99)!.moves).toEqual([]);
    expect(op.replay(1, 0)!.moves.length).toBe(5);
  });

  it('every game since recording began is kept, listed oldest first, and asked for by number; an unknown game is null', async () => {
    const { client } = fakeClient(upWins);
    const g = { ...newGame(rng), complete: true, length: 144 };
    const op = new Operator(client, g as any, rng);
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T11:01:00Z')); // the cooldown is over: game 2 on 13x13
    await playSteps(op, 2, Date.parse('2026-09-11T11:01:00Z'));
    const r = op.replay()!;
    expect(r.games).toEqual([1, 2]);
    expect(r.gameNumber).toBe(2);
    expect(r.size).toBe(13);
    expect(r.start.step).toBe(0);
    expect(r.moves.length).toBe(2);
    const g1 = op.replay(1)!;
    expect(g1.gameNumber).toBe(1);
    expect(g1.complete).toBe(true);
    expect(op.replay(7)).toBe(null);
  });

  it('the record survives a restart, and a state file from before recording seeds the start frame from the game as it stands', async () => {
    const { client } = fakeClient(upWins);
    const op = new Operator(client, newGame(rng), rng);
    await playSteps(op, 3);
    const back = Operator.fromJSON(client, JSON.parse(JSON.stringify(op.toJSON())), rng);
    expect(back.replay()).toEqual(op.replay());
    await playSteps(back, 1, Date.parse('2026-09-11T10:03:00Z'));
    expect(back.replay()!.moves.length).toBe(4);

    const old = Operator.fromJSON(client, { game: { ...op.game }, open: null, decisions: [], pending: null, completedAt: null }, rng);
    const r = old.replay()!;
    expect(r.start).toEqual({ step: 3, snake: op.game.snake, heading: op.game.heading, food: op.game.food, deaths: op.game.deaths });
    expect(r.moves).toEqual([]);
  });
});
