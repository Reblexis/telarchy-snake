import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Operator, type TelarchyClient, type ProposalRef } from '../src/operator.js';
import { GameLog, type LogStep } from '../src/gamelog.js';
import { createServer } from '../src/server.js';
import { GRID, newGame } from '../src/engine.js';
import type { Quotes, Action } from '../src/decide.js';

function fakeClient(quotesFor: () => Quotes) {
  let n = 0;
  const client: TelarchyClient = {
    async postProposal() { n++; return { id: `p${n}`, number: n, url: `https://telarchy.com/snake/p/${n}` }; },
    async readQuotes(_ref: ProposalRef) { return quotesFor(); },
    async approveOption(_ref: ProposalRef, _option: Action) {},
    async declineProposal() {},
    async postReading() {},
    async refreshBooks() {},
    async setHorizon() {},
    async setRange() {},
    async readActivity() { return {}; },
    async readLeaderboard() { return []; },
  };
  return client;
}
const h = (price: number | null) => ({ m60: { price, lead: null } });
const allTen = (): Quotes => ({ forward: h(10), left: h(10), right: h(10) });
const upWins = (): Quotes => ({ ...allTen(), left: h(12) });
const none = (): Quotes => ({ forward: h(null), left: h(null), right: h(null) });
const rng = () => 0;

const dirs: string[] = [];
function tmp(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'snake-log-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function playSteps(op: Operator, n: number, start = Date.parse('2026-09-11T10:00:00Z')) {
  for (let i = 0; i < n; i++) {
    if (!op.open) await op.openStep(new Date(start + i * 60_000));
    await op.closeStep(new Date(start + i * 60_000 + 58_000));
    await op.tick(new Date(start + (i + 1) * 60_000));
  }
}

const line = (step: number, extra: Partial<LogStep> = {}): LogStep => ({
  step, at: `2026-09-11T10:${String(step % 60).padStart(2, '0')}:00.000Z`, snake: [{ x: 6, y: 6 }, { x: 5, y: 6 }], food: { x: 0, y: 0 },
  heading: 'right', action: step === 0 ? null : 'forward', direction: 'right', undecided: false,
  prices: { forward: null, left: null, right: null }, length: 2, deaths: 0, ...extra,
});

describe('the game log (docs/snake.md, "The feed": /games and /history)', () => {
  it('the games list has the contract shape, oldest first, the running game last with endedAt null', async () => {
    const log = new GameLog(tmp());
    const g = { ...newGame(rng, 12, 1), complete: true, length: 144 };
    const op = new Operator(fakeClient(upWins), g as any, rng, { log });
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T11:01:00Z')); // cooldown over: game 2 on 13x13
    await playSteps(op, 2, Date.parse('2026-09-11T11:01:00Z'));
    const games = log.games();
    expect(games.map(x => x.number)).toEqual([1, 2]);
    expect(Object.keys(games[1]).sort()).toEqual(['bestLength', 'deaths', 'endedAt', 'number', 'size', 'startedAt', 'steps']);
    expect(games[1]).toEqual({ number: 2, size: 14, startedAt: '2026-09-11T11:01:00.000Z', endedAt: null, steps: 2, bestLength: 2, deaths: 0 });
    expect(games[0].endedAt).not.toBe(null);
  });

  it('step 0 is the starting position, recorded when the game starts on a fresh process', () => {
    const log = new GameLog(tmp());
    const op = Operator.fresh(fakeClient(upWins), rng, { log });
    expect(log.games().length).toBe(1);
    // A fresh process starts game 1 on the first grid (docs/snake.md, "The game").
    expect(log.games()[0]).toMatchObject({ number: 1, size: GRID, steps: 0, bestLength: 2, deaths: 0, endedAt: null });
    expect(log.games()[0]).not.toHaveProperty('partial');
    return log.history('current').then(r => {
      expect(r!.total).toBe(1);
      expect(r!.from).toBe(0);
      expect(r!.steps[0]).toMatchObject({ step: 0, snake: op.game.snake, food: op.game.food, heading: 'right', action: null, direction: 'right', undecided: false, prices: { forward: null, left: null, right: null }, length: 2, deaths: 0 });
      expect(typeof r!.steps[0].at).toBe('string');
    });
  });

  it('a step records the state after the move with action, direction, every option\'s price and undecided', async () => {
    const log = new GameLog(tmp());
    const op = new Operator(fakeClient(upWins), newGame(rng, 12, 1), rng, { log });
    await playSteps(op, 1);
    const r = (await log.history(1))!;
    expect(r.total).toBe(2);
    expect(r.steps[1]).toEqual({
      step: 1, at: '2026-09-11T10:01:00.000Z', snake: op.game.snake, food: op.game.food, heading: 'up',
      action: 'left', direction: 'up', undecided: false, prices: { forward: 10, left: 12, right: 10 }, length: 2, deaths: 0,
    });
    expect(r.steps[1].snake[0]).toEqual({ x: 6, y: 5 });
  });

  it('an undecided step records forward, undecided true and null prices', async () => {
    const log = new GameLog(tmp());
    const op = new Operator(fakeClient(none), newGame(rng, 12, 1), rng, { log });
    await playSteps(op, 1);
    const r = (await log.history(1))!;
    expect(r.steps[1]).toMatchObject({ step: 1, action: 'forward', direction: 'right', undecided: true, prices: { forward: null, left: null, right: null } });
  });

  it('a death step records length 2 and the new deaths count', async () => {
    const log = new GameLog(tmp());
    const g = { ...newGame(rng, 12, 1), snake: [{ x: 11, y: 6 }, { x: 10, y: 6 }, { x: 9, y: 6 }], length: 3, food: { x: 0, y: 0 } };
    const op = new Operator(fakeClient(allTen), g, rng, { log });
    await playSteps(op, 1);
    const r = (await log.history(1))!;
    expect(r.steps[0]).toMatchObject({ step: 0, length: 3, deaths: 0 });
    expect(r.steps[1]).toMatchObject({ step: 1, length: 2, deaths: 1, snake: [{ x: 6, y: 6 }, { x: 5, y: 6 }] });
    expect(log.games()[0]).toMatchObject({ deaths: 1, bestLength: 3, steps: 1 });
  });

  it('a completed game gets endedAt and the next game gets its own file and number', async () => {
    const dir = tmp();
    const log = new GameLog(dir);
    const g = { ...newGame(rng, 12, 1), complete: true, length: 144 };
    const op = new Operator(fakeClient(upWins), g as any, rng, { log });
    await op.tick(new Date('2026-09-11T10:01:00Z'));
    await op.tick(new Date('2026-09-11T11:01:00Z'));
    await playSteps(op, 1, Date.parse('2026-09-11T11:01:00Z'));
    expect(fs.existsSync(path.join(dir, '1.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '2.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(true);
    const [g1, g2] = log.games();
    expect(typeof g1.endedAt).toBe('string');
    expect(g2).toMatchObject({ number: 2, size: 14, endedAt: null, steps: 1 });
    expect((await log.history(2))!.steps.map(s => s.step)).toEqual([0, 1]);
    expect((await log.history(2))!.game).toEqual({ number: 2, size: 14, startedAt: '2026-09-11T11:01:00.000Z', endedAt: null });
  });

  it('a game that fills the grid is ended at the step that filled it', async () => {
    const log = new GameLog(tmp());
    // A 2x2 grid: the snake at (1,1),(0,1) heading right; turning left goes up to (1,0), eats and fills 3, then left to (0,0) fills 4.
    const g = { ...newGame(rng, 2), snake: [{ x: 1, y: 1 }, { x: 0, y: 1 }], food: { x: 1, y: 0 }, size: 2 };
    const op = new Operator(fakeClient(upWins), g, rng, { log });
    await playSteps(op, 2);
    expect(op.game.complete).toBe(true);
    expect(log.games()[0]).toMatchObject({ endedAt: '2026-09-11T10:02:00.000Z', steps: 2, bestLength: 4 });
  });

  it('partial flag when the log starts mid-game: the first entry is the state at game.step and earlier steps are unavailable', async () => {
    const log = new GameLog(tmp());
    const op = new Operator(fakeClient(upWins), newGame(rng, 12, 1), rng);
    await playSteps(op, 3);
    const back = Operator.fromJSON(fakeClient(upWins), JSON.parse(JSON.stringify(op.toJSON())), rng, { log });
    expect(log.games()[0]).toMatchObject({ number: 1, partial: true, steps: 3, bestLength: 2 });
    const r = (await log.history('current'))!;
    expect(r.total).toBe(1);
    expect(r.from).toBe(0);
    expect(r.steps[0]).toMatchObject({ step: 3, snake: back.game.snake, action: null, length: 2 });
    await playSteps(back, 1, Date.parse('2026-09-11T10:03:00Z'));
    const r2 = (await log.history('current'))!;
    expect(r2.total).toBe(2);
    expect(r2.steps.map(s => s.step)).toEqual([3, 4]);
    expect(log.games()[0].steps).toBe(4);
  });

  it('a partial start carries the game record (bestLength), not the current length', async () => {
    const log = new GameLog(tmp());
    const op = new Operator(fakeClient(upWins), { ...newGame(rng, 12, 1), food: { x: 6, y: 5 } }, rng);
    await playSteps(op, 1); // eats: length 3
    op.game = { ...op.game, snake: [{ x: 6, y: 6 }, { x: 5, y: 6 }], length: 2, deaths: 1, step: 5 }; // died since
    expect(op.bestLength).toBe(3);
    Operator.fromJSON(fakeClient(upWins), JSON.parse(JSON.stringify(op.toJSON())), rng, { log });
    expect(log.games()[0]).toMatchObject({ partial: true, bestLength: 3, steps: 5, deaths: 1 });
    expect((await log.history(1))!.steps[0].length).toBe(2);
  });

  it('a log that already exists for the running game is continued on restart, not started again', async () => {
    const dir = tmp();
    const op = new Operator(fakeClient(upWins), newGame(rng, 12, 1), rng, { log: new GameLog(dir) });
    await playSteps(op, 2);
    const log2 = new GameLog(dir);
    const back = Operator.fromJSON(fakeClient(upWins), JSON.parse(JSON.stringify(op.toJSON())), rng, { log: log2 });
    await playSteps(back, 1, Date.parse('2026-09-11T10:02:00Z'));
    expect(log2.games().length).toBe(1);
    expect(log2.games()[0]).not.toHaveProperty('partial');
    expect((await log2.history(1))!.steps.map(s => s.step)).toEqual([0, 1, 2, 3]);
  });

  it('history default window is the last 300', async () => {
    const dir = tmp();
    const log = new GameLog(dir);
    log.start(1, 12, '2026-09-11T10:00:00.000Z', line(0), false);
    for (let i = 1; i <= 450; i++) log.append(1, line(i), 2, false);
    const r = (await log.history(1))!;
    expect(r.total).toBe(451);
    expect(r.from).toBe(151);
    expect(r.steps.length).toBe(300);
    expect(r.steps[0].step).toBe(151);
    expect(r.steps[299].step).toBe(450);
  });

  it('from and limit are honoured, limit is capped at 2000, and a window past the end is empty', async () => {
    const log = new GameLog(tmp());
    log.start(1, 12, '2026-09-11T10:00:00.000Z', line(0), false);
    for (let i = 1; i <= 50; i++) log.append(1, line(i), 2, false);
    let r = (await log.history(1, 10, 5))!;
    expect(r.from).toBe(10);
    expect(r.steps.map(s => s.step)).toEqual([10, 11, 12, 13, 14]);
    r = (await log.history(1, 48, 10))!;
    expect(r.steps.map(s => s.step)).toEqual([48, 49, 50]);
    r = (await log.history(1, 99, 10))!;
    expect(r.steps).toEqual([]);
    expect(r.total).toBe(51);
    r = (await log.history(1, 0, 5000))!;
    expect(r.steps.length).toBe(51);
    expect(await log.history(1, -3, 2)).toMatchObject({ from: 0 });
    expect((await log.history(1, 0, 0))!.steps.length).toBe(1);
  });

  it('game=current is the newest recorded game; an unknown game is null', async () => {
    const log = new GameLog(tmp());
    log.start(1, 12, '2026-09-11T10:00:00.000Z', line(0), false);
    log.start(2, 13, '2026-09-11T12:00:00.000Z', line(0), false);
    expect((await log.history('current'))!.game.number).toBe(2);
    expect((await log.history(undefined))!.game.number).toBe(2);
    expect(await log.history(7)).toBe(null);
    expect(await log.history(NaN)).toBe(null);
    expect((await new GameLog(tmp()).history('current'))).toBe(null);
    expect(new GameLog(tmp()).games()).toEqual([]);
  });

  it('slicing a 5,000-line log returns the right lines without reading it all into memory', async () => {
    const dir = tmp();
    const log = new GameLog(dir);
    log.start(1, 12, '2026-09-11T10:00:00.000Z', line(0), false);
    const chunk: string[] = [];
    for (let i = 1; i < 5000; i++) chunk.push(JSON.stringify(line(i)));
    fs.appendFileSync(path.join(dir, '1.jsonl'), chunk.join('\n') + '\n');
    const parse = vi.spyOn(JSON, 'parse');
    const whole = vi.spyOn(fs, 'readFileSync');
    const r = (await log.history(1, 1200, 7))!;
    expect(r.total).toBe(5000);
    expect(r.steps.map(s => s.step)).toEqual([1200, 1201, 1202, 1203, 1204, 1205, 1206]);
    // only the returned lines are parsed; the log file is never read whole
    expect(parse.mock.calls.filter(c => String(c[0]).startsWith('{"step"')).length).toBe(7);
    expect(whole.mock.calls.some(c => String(c[0]).endsWith('1.jsonl'))).toBe(false);
    const tail = (await log.history(1))!;
    expect(tail.from).toBe(4700);
    expect(tail.steps.length).toBe(300);
    expect(tail.steps[299].step).toBe(4999);
  });

  it('a crash mid-write loses at most the last line: a torn last line is skipped and closed off at the next start', async () => {
    const dir = tmp();
    const log = new GameLog(dir);
    log.start(1, 12, '2026-09-11T10:00:00.000Z', line(0), false);
    log.append(1, line(1), 2, false);
    fs.appendFileSync(path.join(dir, '1.jsonl'), JSON.stringify(line(2)).slice(0, 40));
    expect((await log.history(1))!.steps.map(s => s.step)).toEqual([0, 1]);
    const log2 = new GameLog(dir);
    log2.append(1, line(2), 2, false);
    const r = (await log2.history(1))!;
    expect(r.steps.map(s => s.step)).toEqual([0, 1, 2]);
    expect(r.total).toBe(3);
  });

  it('the index is written whole and atomically: no partial index.json is ever left behind', () => {
    const dir = tmp();
    const log = new GameLog(dir);
    log.start(1, 12, '2026-09-11T10:00:00.000Z', line(0), false);
    log.append(1, line(1), 2, false);
    expect(fs.readdirSync(dir).sort()).toEqual(['1.jsonl', 'index.json']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).games[0].steps).toBe(1);
  });
});

describe('the feed over HTTP (docs/snake.md, "The feed")', () => {
  async function serve(op: Operator) {
    const server = createServer(op, Buffer.from('<html>'));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as any).port;
    const get = (p: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${p}`, res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }).on('error', reject);
    });
    return { get, close: () => new Promise<void>(r => server.close(() => r())) };
  }

  it('/games and /history carry CORS * and no-store, like /state', async () => {
    const op = new Operator(fakeClient(upWins), newGame(rng, 12, 1), rng, { log: new GameLog(tmp()) });
    await playSteps(op, 2);
    const { get, close } = await serve(op);
    try {
      for (const p of ['/state', '/games', '/history?game=current&limit=5']) {
        const r = await get(p);
        expect(r.status).toBe(200);
        expect(r.headers['access-control-allow-origin']).toBe('*');
        expect(r.headers['cache-control']).toBe('no-store');
        expect(r.headers['content-type']).toBe('application/json');
      }
      const games = JSON.parse((await get('/games')).body);
      expect(games.games[0]).toMatchObject({ number: 1, size: 12, endedAt: null, steps: 2 });
      const hist = JSON.parse((await get('/history?game=1&from=1&limit=1')).body);
      expect(hist.game).toEqual({ number: 1, size: 12, startedAt: expect.any(String), endedAt: null });
      expect(hist.total).toBe(3);
      expect(hist.from).toBe(1);
      expect(hist.steps.map((s: any) => s.step)).toEqual([1]);
      expect(JSON.parse((await get('/history')).body).steps.length).toBe(3);
      expect(JSON.parse((await get('/history?game=current&limit=5000')).body).steps.length).toBe(3);
    } finally { await close(); }
  });

  it('404 on unknown game: { "error": "no such game" }, JSON, with CORS', async () => {
    const op = new Operator(fakeClient(upWins), newGame(rng, 12, 1), rng, { log: new GameLog(tmp()) });
    const { get, close } = await serve(op);
    try {
      for (const p of ['/history?game=9', '/history?game=abc']) {
        const r = await get(p);
        expect(r.status).toBe(404);
        expect(JSON.parse(r.body)).toEqual({ error: 'no such game' });
        expect(r.headers['access-control-allow-origin']).toBe('*');
      }
    } finally { await close(); }
  });

  it('without a log the feed answers an empty games list and 404 on every history', async () => {
    const op = new Operator(fakeClient(upWins), newGame(rng, 12, 1), rng);
    const { get, close } = await serve(op);
    try {
      expect(JSON.parse((await get('/games')).body)).toEqual({ games: [] });
      expect((await get('/history?game=current')).status).toBe(404);
    } finally { await close(); }
  });
});

describe('an old log line from before options (docs/snake.md, "The feed")', () => {
  it('a line written with `impact` reads back with every option\'s price null and no impact field', async () => {
    const log = new GameLog(tmp());
    const { prices: _p, ...rest } = line(0);
    log.start(1, 12, '2026-09-11T10:00:00.000Z', { ...rest, impact: { forward: 1, left: 2, right: 0 } } as any, false);
    log.append(1, line(1), 2, false);
    const r = (await log.history(1))!;
    expect(r.steps[0].prices).toEqual({ forward: null, left: null, right: null });
    expect(r.steps[0]).not.toHaveProperty('impact');
    expect(r.steps[1].prices).toEqual({ forward: null, left: null, right: null });
  });
});
