import { describe, it, expect } from 'vitest';
import { buildScene, snakeAt, headingAt, drawFull, drawShort, FULL_SIZE, SHORT_SIZE, FULL_BOX, FULL_MARGIN, GAME } from '../src/draw.js';
import { frameAt, frameCountOf } from '../src/frames.js';
import type { Segment } from '../src/timeline.js';
import type { GameEntry, LogStep } from '../src/gamelog.js';
import type { TradeRow } from '../src/level.js';

// docs/level-video.md: "The trades: race bars", "Motion and type", "Structure".

const T0 = Date.parse('2026-09-11T20:00:00Z');
const at = (i: number, s = 0) => new Date(T0 + i * 60_000 + s * 1000).toISOString();
type Cell = { x: number; y: number };
const size = 6;
const path: Cell[] = [];
for (let y = 0; y < size; y++) for (let k = 0; k < size; k++) path.push({ x: y % 2 ? size - 1 - k : k, y });
/** The snake of a given length along the serpentine, head last-visited first. */
const snakeOf = (length: number, offset: number) => path.slice(offset, offset + length).reverse();
const PRICES = { forward: 20, left: 12, right: 5 };
// 30 entries: the snake walks the serpentine, eating now and then; one death at move 12
const entries: LogStep[] = [];
let len = 2, off = 0, deaths = 0;
for (let i = 0; i <= 30; i++) {
  if (i === 12) { deaths = 1; len = 2; off = 0; }
  else if (i > 0) { off++; if (i % 5 === 0) len++; }
  entries.push({ step: i, at: at(i), snake: snakeOf(len, off), food: path[Math.min(off + len + 2, path.length - 1)], heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PRICES, length: len, deaths });
}
/** A trade on an option; `against` lowered the option's price instead of raising it. */
const trade = (move: number, credits: number, handle: string, option: 'forward' | 'left' | 'right', k: number, against = false): TradeRow => ({
  id: `t${move}-${k}`, at: at(move - 1, 5 + k), kind: 'trade', actor: { id: handle, handle },
  detail: { side: 'buy', direction: against ? 'lower' : 'higher', shares: 1, cost: credits, callBefore: against ? 30 : 1, callAfter: PRICES[option], marketId: `m-${option}` },
});
const byMove: TradeRow[][] = entries.map(() => []);
// move 20 (entries 19 -> 20): five trades, the three largest 900, 400, 300 (dee's against left), and all of forward's credits 900 + 50 = 950
byMove[19] = [trade(20, 50, 'ann', 'forward', 0), trade(20, 900, 'vi0', 'forward', 1), trade(20, 400, 'bob', 'left', 2), trade(20, 20, 'cy', 'right', 3), trade(20, 300, 'dee', 'left', 4, true)];
const game: GameEntry = { number: 2, size, startedAt: at(0), endedAt: at(30), steps: 30, bestLength: len, deaths: 1 };
const scene = () => buildScene(game, [game], entries, byMove);

const TL: Segment[] = [
  { kind: 'run', from: 0, to: 19, speed: 24, frames: 30, easeIn: false, easeOut: true },
  { kind: 'beat', move: 20, chips: 3, frames: 192, slow: true, caption: 'Traders price each direction. The highest price moves.' },
  { kind: 'run', from: 20, to: 30, speed: 4, frames: 75, easeIn: true, easeOut: false },
  { kind: 'hold', fx: 'hitstop', entry: 30, frames: 4 },
  { kind: 'hold', fx: 'filled', entry: 30, frames: 90 },
  { kind: 'credits', frames: 540 },
];
const info = (f: number) => frameAt(TL, entries, f);
// the captioned beat plays at half speed: chips on frames 30 to 149 (40 each), the lock 150 to 185, the move to 221
const gameplayFrames = [0, 10, 29, 30, 45, 62, 74, 80, 120, 160, 200, 230, 280, 300, 350];
const creditsFrame = 30 + 192 + 75 + 4 + 90 + 100;

describe('the gliding snake', () => {
  it('at a whole position the snake is exactly that entry', () => {
    const sc = scene();
    for (const i of [0, 7, 19]) expect(snakeAt(sc, i)).toEqual(entries[i].snake);
  });
  it('halfway between two entries the head is halfway from one head to the next', () => {
    const sc = scene();
    const h = snakeAt(sc, 19.5)[0], a = entries[19].snake[0], b = entries[20].snake[0];
    expect(h.x).toBeCloseTo((a.x + b.x) / 2, 9);
    expect(h.y).toBeCloseTo((a.y + b.y) / 2, 9);
  });
});

describe('the head faces the way it is going', () => {
  // right along row 0, a turn down at move 2, a crash at move 3 and a respawn heading up
  const turn: LogStep[] = [
    { x: 1, y: 0, heading: 'right', deaths: 0 },
    { x: 2, y: 0, heading: 'right', deaths: 0 },
    { x: 2, y: 1, heading: 'down', deaths: 0 },
    { x: 3, y: 3, heading: 'up', deaths: 1 },
  ].map((c, i) => ({ step: i, at: at(i), snake: [{ x: c.x, y: c.y }, { x: c.x - 1, y: c.y }], food: { x: 5, y: 5 }, heading: c.heading as LogStep['heading'], action: i ? 'forward' : null, direction: c.heading as LogStep['direction'], undecided: false, prices: PRICES, length: 2, deaths: c.deaths }));
  const g: GameEntry = { number: 1, size, startedAt: at(0), endedAt: at(3), steps: 3, bestLength: 2, deaths: 1 };
  const sc = () => buildScene(g, [g], turn, [[], [], []]);
  it('at a whole position the head has that entry\'s heading', () => {
    expect(headingAt(sc(), 1)).toBe('right');
    expect(headingAt(sc(), 2)).toBe('down');
  });
  it('gliding into a turn the eyes already face the new way', () => {
    expect(headingAt(sc(), 1.05)).toBe('down');
    expect(headingAt(sc(), 1.5)).toBe('down');
    expect(headingAt(sc(), 1.95)).toBe('down');
  });
  it('before a respawn the snake keeps its heading until it jumps', () => {
    expect(headingAt(sc(), 2.5)).toBe('down');
    expect(headingAt(sc(), 3)).toBe('up');
  });
  it('the drawn eyes follow it: mid-turn the eyes sit below the head\'s centre', () => {
    const tl: Segment[] = [{ kind: 'run', from: 1, to: 2, speed: 4, frames: 8, easeIn: false, easeOut: false }, { kind: 'credits', frames: 10 }];
    const f = [...Array(8).keys()].find(k => { const p = frameAt(tl, turn, k).position; return p > 1.3 && p < 1.7; })!;
    const d = drawFull(sc(), frameAt(tl, turn, f));
    const { x, y } = d.rects.head;
    // the pupils are the only dark pixels inside the head block
    let above = 0, below = 0;
    for (let dy = -60; dy <= 60; dy++) for (let dx = -60; dx <= 60; dx++) {
      const k = (Math.round(y + dy) * 1920 + Math.round(x + dx)) * 3;
      const dark = d.buffer[k + 1] < 60;
      const inDisc = dx * dx + dy * dy < 55 * 55;
      if (dark && inDisc) { if (dy < 0) above++; else if (dy > 0) below++; }
    }
    expect(below, `eyes above ${above}, below ${below}`).toBeGreaterThan(above);
  });
});

describe('the game looks like a game', () => {
  // a hold shows one entry exactly, with no push-in
  const still = (entry: number) => drawFull(scene(), frameAt([{ kind: 'hold', fx: 'hitstop', entry, frames: 4 }, { kind: 'credits', frames: 10 }], entries, 0));
  const CELL = Math.floor(FULL_BOX.px / size), BX = FULL_BOX.x, BY = FULL_BOX.y;
  const px = (d: { buffer: Buffer }, x: number, y: number) => { const k = (Math.round(y) * 1920 + Math.round(x)) * 3; return '#' + [0, 1, 2].map(j => d.buffer[k + j].toString(16).padStart(2, '0')).join(''); };
  const centre = (c: Cell) => [BX + c.x * CELL + CELL / 2, BY + c.y * CELL + CELL / 2] as const;
  const e = entries[8]; // length 3 on row 0 and 1, far from the bottom rows
  const free = (c: Cell) => !e.snake.some(s => s.x === c.x && s.y === c.y) && !(e.food.x === c.x && e.food.y === c.y);

  it('the board is a checkerboard: cells that share an edge differ, diagonal cells match', () => {
    const d = still(8);
    const a = { x: 0, y: 4 }, right = { x: 1, y: 4 }, below = { x: 0, y: 5 }, diagonal = { x: 1, y: 5 };
    for (const c of [a, right, below, diagonal]) expect(free(c)).toBe(true);
    const at = (c: Cell) => px(d, ...centre(c));
    expect([GAME.boardA, GAME.boardB]).toContain(at(a));
    expect(at(right)).not.toBe(at(a));
    expect(at(below)).not.toBe(at(a));
    expect(at(diagonal)).toBe(at(a));
  });
  it('the board has no grid lines: the edge between two cells is one of the two tones', () => {
    const d = still(8);
    expect([GAME.boardA, GAME.boardB]).toContain(px(d, BX + CELL, BY + 4 * CELL + CELL / 2));
    expect([GAME.boardA, GAME.boardB]).toContain(px(d, BX + CELL / 2, BY + 5 * CELL));
  });
  it('the body is blocks joined by a narrow link: board shows at both sides of the link, and the shades alternate', () => {
    const d = still(8);
    const [s1, s2] = [e.snake[1], e.snake[2]];
    const [x1, y1] = centre(s1), [x2, y2] = centre(s2);
    expect([GAME.bodyA, GAME.bodyB]).toContain(px(d, x1, y1));
    expect([GAME.bodyA, GAME.bodyB]).toContain(px(d, x2, y2));
    expect(px(d, x1, y1)).not.toBe(px(d, x2, y2));
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    expect(px(d, mx, my)).toBe(GAME.link);
    // across the link: the segments sit side by side along one axis, so the other axis is "beside"
    const [ox, oy] = x1 === x2 ? [CELL * 0.38, 0] : [0, CELL * 0.38];
    expect([GAME.boardA, GAME.boardB]).toContain(px(d, mx + ox, my + oy));
    expect([GAME.boardA, GAME.boardB]).toContain(px(d, mx - ox, my - oy));
  });
  it('cells that touch without being neighbours along the body are not linked', () => {
    // a snake folded back on itself: row 0 rightwards, then row 1 leftwards
    const s: Cell[] = [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }];
    const fold: LogStep[] = [{ step: 0, at: at(0), snake: s, food: { x: 5, y: 5 }, heading: 'left', action: null, direction: 'left', undecided: false, prices: PRICES, length: 6, deaths: 0 }];
    const g: GameEntry = { number: 1, size, startedAt: at(0), endedAt: at(1), steps: 0, bestLength: 6, deaths: 0 };
    const d = drawFull(buildScene(g, [g], fold, []), frameAt([{ kind: 'hold', fx: 'hitstop', entry: 0, frames: 4 }, { kind: 'credits', frames: 10 }], fold, 0));
    let checked = 0;
    for (let a = 0; a < s.length; a++) for (let b = a + 2; b < s.length; b++) {
      if (Math.abs(s[a].x - s[b].x) + Math.abs(s[a].y - s[b].y) !== 1) continue;
      const [ax, ay] = centre(s[a]), [bx, by] = centre(s[b]);
      expect([GAME.boardA, GAME.boardB]).toContain(px(d, (ax + bx) / 2, (ay + by) / 2));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('a segment is a square: its corner region is filled, where a round band would show board', () => {
    const d = still(8);
    const [x, y] = centre(e.snake[1]);
    expect([GAME.bodyA, GAME.bodyB]).toContain(px(d, x - CELL * 0.36, y - CELL * 0.36));
  });
  it('the head is a darker block with white eyes and dark pupils', () => {
    const d = still(8);
    const [x, y] = centre(e.snake[0]);
    const seen = new Set<string>();
    for (let dy = -70; dy <= 70; dy += 2) for (let dx = -70; dx <= 70; dx += 2) seen.add(px(d, x + dx, y + dy));
    expect(seen.has(GAME.head)).toBe(true);
    expect(seen.has(GAME.eye)).toBe(true);
    expect(seen.has(GAME.pupil)).toBe(true);
  });
  it('the food is an apple: a red fruit with a stem and a leaf above it', () => {
    const d = still(8);
    const [x, y] = centre(e.food);
    expect(px(d, x, y + CELL * 0.08)).toBe(GAME.apple);
    const top = new Set<string>();
    for (let dy = -CELL * 0.45; dy < -CELL * 0.1; dy += 1) for (let dx = -CELL * 0.3; dx <= CELL * 0.3; dx += 1) top.add(px(d, x + dx, y + dy));
    expect(top.has(GAME.stem)).toBe(true);
    expect(top.has(GAME.leaf)).toBe(true);
  });
  it('the tail leaves as the head arrives: on a glide that does not eat the tail\'s cell is half vacated halfway', () => {
    // entries 8 -> 9 does not eat (lengths change on multiples of 5)
    expect(entries[9].length).toBe(entries[8].length);
    const tl: Segment[] = [{ kind: 'run', from: 8, to: 9, speed: 4, frames: 8, easeIn: false, easeOut: false }, { kind: 'credits', frames: 10 }];
    const f = [...Array(8).keys()].find(k => { const p = frameAt(tl, entries, k).position; return p > 8.4 && p < 8.6; })!;
    const d = drawFull(scene(), frameAt(tl, entries, f));
    const tail = e.snake[e.snake.length - 1], before = e.snake[e.snake.length - 2];
    const [tx, ty] = centre(tail);
    // the far side of the tail's cell (away from the body) is board again
    const away = { x: tx - (before.x - tail.x) * CELL * 0.3, y: ty - (before.y - tail.y) * CELL * 0.3 };
    expect([GAME.boardA, GAME.boardB]).toContain(px(d, away.x, away.y));
  });
  it('on a move that eats the tail stays whole', () => {
    expect(entries[10].length).toBe(entries[9].length + 1);
    const tl: Segment[] = [{ kind: 'run', from: 9, to: 10, speed: 4, frames: 8, easeIn: false, easeOut: false }, { kind: 'credits', frames: 10 }];
    const f = [...Array(8).keys()].find(k => { const p = frameAt(tl, entries, k).position; return p > 9.4 && p < 9.6; })!;
    const d = drawFull(scene(), frameAt(tl, entries, f));
    const s9 = entries[9].snake, tail = s9[s9.length - 1], before = s9[s9.length - 2];
    const [tx, ty] = centre(tail);
    expect([GAME.bodyA, GAME.bodyB]).toContain(px(d, tx - (before.x - tail.x) * CELL * 0.3, ty - (before.y - tail.y) * CELL * 0.3));
  });
});

describe('the board carries no option arrows', () => {
  it('in a beat no pixel of the board has an option\'s hue, in either cut', () => {
    const hues = [[0x38, 0xbd, 0xf8], [0xa7, 0x8b, 0xfa], [0xf4, 0x72, 0xb6]];
    for (const [draw, w] of [[drawFull, 1920], [drawShort, 1080]] as const) for (const f of [45, 160, 200]) {
      const d = draw(scene(), info(f)), b = d.rects.drawnBoard;
      let hits = 0;
      for (let y = Math.ceil(b.y); y < b.y + b.h; y += 2) for (let x = Math.ceil(b.x); x < b.x + b.w; x += 2) {
        const k = (y * w + x) * 3;
        if (hues.some(h => Math.abs(d.buffer[k] - h[0]) + Math.abs(d.buffer[k + 1] - h[1]) + Math.abs(d.buffer[k + 2] - h[2]) < 24)) hits++;
      }
      expect(hits, `frame ${f} width ${w}`).toBe(0);
    }
  });
});

describe('the full cut frame', () => {
  it('is 1920 by 1080 and carries no link while the game plays; the credits carry it', () => {
    expect(FULL_SIZE).toEqual({ w: 1920, h: 1080 });
    const sc = scene();
    for (const f of gameplayFrames) {
      const d = drawFull(sc, info(f));
      expect(d.buffer.length).toBe(1920 * 1080 * 3);
      expect(d.texts.some(t => /telarchy\.com/.test(t.text)), String(f)).toBe(false);
    }
    const credits = drawFull(sc, info(creditsFrame)).texts.map(t => t.text);
    expect(credits).toContain('telarchy.com/snake');
    expect(credits.some(t => t.includes('vi0'))).toBe(true);
  });

  it('the market panel shows its race bars in every frame of the game; chips fly only in a beat', () => {
    const sc = scene();
    const gameplay = frameCountOf(TL) - 540;
    for (let f = 0; f < gameplay; f += 3) {
      const i = info(f);
      const d = drawFull(sc, i);
      expect(d.rects.lanes, `${i.kind} frame ${f}`).not.toBeNull();
      if (!i.beat) expect(d.rects.chips, `${i.kind} frame ${f}`).toEqual([]);
    }
    expect(drawFull(sc, info(creditsFrame)).rects.lanes).toBeNull();
  }, 60_000);

  it('the terminal: every cell is labelled in every frame of the game, and none shows in the credits', () => {
    const sc = scene();
    const labels = ['SNAKE/L2', 'LEN', 'BEST', 'DEATHS', 'ATTEMPT', 'MOVE', 'WHERE SHOULD THE SNAKE GO?', 'OPTION', 'FORECAST LENGTH', 'Δ', 'CREDITS', 'FORECASTS · LAST 40 MOVES', 'TAPE'];
    for (const f of gameplayFrames) {
      const texts = drawFull(sc, info(f)).texts.map(t => t.text);
      for (const l of labels) expect(texts, `frame ${f}`).toContain(l);
      expect(texts.some(t => /^6×6 · T\+/.test(t)), `frame ${f}`).toBe(true);
    }
    const credits = drawFull(sc, info(creditsFrame)).texts.map(t => t.text);
    // the credits' own stats card has a DEATHS figure; the terminal's labels are what must be gone
    for (const l of labels.filter(l => l !== 'DEATHS')) expect(credits).not.toContain(l);
    expect(drawFull(sc, info(creditsFrame)).rects.panels).toEqual([]);
  });

  it('the stat cells read the move on screen: length, best of the grid, deaths, attempt', () => {
    const sc = scene();
    // frame 250 is in the run after the beat, past the death at move 12
    const i = info(250), e = entries[Math.floor(i.position)];
    const texts = drawFull(sc, i).texts.map(t => t.text);
    expect(texts).toContain(String(e.length));
    expect(texts).toContain(String(sc.best[Math.floor(i.position)]));
    expect(texts).toContain('/36');
    expect(texts).toContain(String(e.deaths + 1));
    expect(texts).toContain(String(Math.floor(i.position)));
  });

  it('the grid\'s cells stay clear of the board and of the margin its push-in may grow into, inside the frame, never overlapping', () => {
    const sc = scene();
    for (const f of gameplayFrames) {
      const d = drawFull(sc, info(f));
      const ps = d.rects.panels;
      expect(ps.length, `frame ${f}`).toBe(4);
      const grown = { x: FULL_BOX.x - FULL_MARGIN, y: FULL_BOX.y - FULL_MARGIN, w: FULL_BOX.px + 2 * FULL_MARGIN, h: FULL_BOX.px + 2 * FULL_MARGIN };
      for (const r of ps) {
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1920 && r.y + r.h <= 1080, JSON.stringify(r)).toBe(true);
        expect(r.x < grown.x + grown.w && grown.x < r.x + r.w && r.y < grown.y + grown.h && grown.y < r.y + r.h, `cell over the board: ${JSON.stringify(r)}`).toBe(false);
      }
      for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
        const A = ps[a], B = ps[b];
        expect(A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h, `frame ${f} cells ${a},${b}`).toBe(false);
      }
    }
  });

  it('no two texts overlap anywhere on the terminal', () => {
    const sc = scene();
    for (const f of gameplayFrames) {
      const texts = drawFull(sc, info(f)).texts;
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `frame ${f}: ${JSON.stringify(a)} over ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  it('the tape never shows a trade of a move that has not yet been shown', () => {
    const moves: TradeRow[][] = entries.map(() => []);
    moves[19] = byMove[19];
    moves[4] = [trade(5, 70, 'eve', 'forward', 0), trade(5, 80, 'fay', 'left', 1)];
    moves[2] = ['g1', 'g2', 'g3', 'g4'].map((h, k) => trade(3, 10 + k, h, 'right', k));
    const sc = buildScene(game, [game], entries, moves);
    const tape = (f: number) => drawFull(sc, info(f)).tape.map(r => r.handle);
    expect(tape(0)).toEqual([]);
    // by the run's last frame every early trade is on the tape, newest first
    expect(tape(29)).toEqual(['fay', 'eve', 'g4', 'g3', 'g2', 'g1']);
    // the beat on move 20: a chip's trade enters when its chip starts (chips at frames 30, 70, 110)
    expect(tape(30)).toEqual(['vi0', 'fay', 'eve', 'g4', 'g3', 'g2', 'g1']);
    expect(tape(69)).toEqual(['vi0', 'fay', 'eve', 'g4', 'g3', 'g2', 'g1']);
    expect(tape(70)).toEqual(['bob', 'vi0', 'fay', 'eve', 'g4', 'g3', 'g2', 'g1']);
    expect(tape(115)).toEqual(['dee', 'bob', 'vi0', 'fay', 'eve', 'g4', 'g3', 'g2', 'g1']);
    // at the lock the move's smaller trades enter; the tape holds the nine most recent, newest first
    expect(tape(150)).toEqual(['dee', 'cy', 'bob', 'vi0', 'ann', 'fay', 'eve', 'g4', 'g3']);
    expect(tape(250)).toEqual(['dee', 'cy', 'bob', 'vi0', 'ann', 'fay', 'eve', 'g4', 'g3']);
  });

  it('a tape row says who, which way, how much and the price it moved; a bet against is a minus', () => {
    const d = drawFull(scene(), info(160));
    const dee = d.tape.find(r => r.handle === 'dee')!;
    expect(dee).toMatchObject({ option: 'left', against: true });
    const texts = d.texts.map(t => t.text);
    expect(texts).toContain('−300');
    expect(texts).toContain('+900');
    expect(texts).toContain('30.0 → 12.0');
    // the trade's clock time: dee's trade was made 9 seconds into the minute before move 20
    expect(texts).toContain(new Date(T0 + 19 * 60_000 + 9_000).toISOString().slice(11, 19));
  });

  it('nothing on screen gives away how the level goes on: a frame looks the same if the record stopped at the move it shows', () => {
    const sc = scene();
    for (const f of [0, 10, 29, 30, 75, 120, 160, 200, 230, 280]) {
      const i = info(f);
      const upTo = Math.max(Math.floor(i.position) + 1, i.beat?.move ?? 0);
      const cut = entries.slice(0, upTo + 1);
      const stopped = buildScene({ ...game, endedAt: cut[cut.length - 1].at, steps: cut.length - 1 }, [game], cut, byMove.slice(0, cut.length));
      expect(drawFull(stopped, i).buffer.equals(drawFull(sc, i).buffer), `frame ${f}`).toBe(true);
    }
  });

  it('the ladder\'s Δ is the change the move\'s trades made to the option: green up, red down', () => {
    // at the lock of move 20: from the first trade's price before to the last trade's price after
    const texts = drawFull(scene(), info(160)).texts.map(t => t.text);
    for (const t of ['+19.0', '+11.0', '+4.0']) expect(texts).toContain(t);
    // a move nobody traded changes nothing
    const idle = drawFull(scene(), info(250)).texts.map(t => t.text);
    expect(idle.filter(t => t === '0.0').length).toBe(3);
  });
  it('it shows always 0.0: a move whose prices were not recorded shows a dash for price and Δ, never 0.0', () => {
    const blank = entries.map(e => ({ ...e, prices: { forward: null, left: null, right: null } })) as unknown as LogStep[];
    const texts = drawFull(buildScene(game, [game], blank, entries.map(() => [])), info(250)).texts.map(t => t.text);
    expect(texts).not.toContain('0.0');
    expect(texts.filter(t => t === '–').length).toBeGreaterThanOrEqual(6);
  });
  it('a recorded price of zero is still a figure', () => {
    const zero = entries.map(e => ({ ...e, prices: { forward: 0, left: 3, right: 3 } }));
    const texts = drawFull(buildScene(game, [game], zero, entries.map(() => [])), info(250)).texts.map(t => t.text);
    expect(texts).toContain('0.0');
  });
  it('a Δ below zero is red and reads with a minus', () => {
    const moves: TradeRow[][] = entries.map(() => []);
    moves[19] = [trade(20, 300, 'dee', 'left', 0, true)];
    const d = drawFull(buildScene(game, [game], entries, moves), info(160));
    expect(d.texts.map(t => t.text)).toContain('−18.0');
  });

  it('the price chart reaches the move on screen and no further, and ends in a dot per option', () => {
    const d = drawFull(scene(), info(250));
    expect(d.rects.chart).not.toBeNull();
    const c = d.rects.chart!;
    expect(c.x).toBeGreaterThanOrEqual(FULL_BOX.x + FULL_BOX.px + FULL_MARGIN);
    expect(c.x + c.w).toBeLessThanOrEqual(1920);
  });

  it('the chips are the three largest trades, each inside its own lane', () => {
    const sc = scene();
    const seen = new Set<string>();
    for (let lf = 0; lf < 120; lf++) {
      const d = drawFull(sc, info(30 + lf));
      for (const c of d.rects.chips) {
        seen.add(c.text);
        const lane = d.rects.lanes![c.option as 'forward' | 'left' | 'right'];
        expect(c.y, JSON.stringify(c)).toBeGreaterThanOrEqual(lane.y - 1);
        expect(c.y + c.h, JSON.stringify(c)).toBeLessThanOrEqual(lane.y + lane.h + 1);
      }
    }
    expect([...seen].sort()).toEqual(['+400', '+900', '−300']);
  });

  it('a trade that raised its option\'s price is a gold +credits chip, one that lowered it a grey −credits chip', () => {
    const sc = scene();
    const chipAt = (lf: number) => { const d = drawFull(sc, info(30 + lf)); return { d, c: d.rects.chips[0] }; };
    const colour = (d: ReturnType<typeof drawFull>, c: { x: number; y: number; w: number; h: number }) => {
      const k = (Math.floor(c.y + c.h * 0.12) * 1920 + Math.floor(c.x + c.w / 2)) * 3;
      return [d.buffer[k], d.buffer[k + 1], d.buffer[k + 2]];
    };
    const up = chipAt(50), down = chipAt(110);
    expect(up.c.text).toBe('+400');
    expect(down.c.text).toBe('−300');
    const [ur, , ub] = colour(up.d, up.c), [dr, dg, db] = colour(down.d, down.c);
    expect(ur - ub).toBeGreaterThan(100);
    expect(Math.max(dr, dg, db) - Math.min(dr, dg, db)).toBeLessThan(30);
  });

  it('a lane\'s credits count every trade on its option, not only the chips', () => {
    // at the lock, once every trade of the move has been shown
    const texts = drawFull(scene(), info(160)).texts.map(t => t.text);
    expect(texts).toContain('950 cr');
    expect(texts).toContain('700 cr');
  });

  it('the caption never covers the snake\'s head, and the whole board stays in frame', () => {
    const sc = scene();
    for (const f of [30, 40, 50, 74]) {
      const d = drawFull(sc, info(f));
      const { board, caption, head } = d.rects;
      expect(board.x >= 0 && board.y >= 0 && board.x + board.w <= 1920 && board.y + board.h <= 1080).toBe(true);
      if (caption) expect(head.x > caption.x && head.x < caption.x + caption.w && head.y > caption.y && head.y < caption.y + caption.h, String(f)).toBe(false);
    }
  });

  it('a trade whose option cannot be named has its chip on the pot\'s line, never over the board or a lane', () => {
    const unnamed: TradeRow = { id: 'u1', at: at(19, 9), kind: 'trade', actor: { id: 'zed', handle: 'zed' }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: 700, callBefore: 70, callAfter: 77, marketId: 'm-unknown' } };
    const moves: TradeRow[][] = entries.map(() => []);
    moves[19] = [unnamed];
    const sc = buildScene(game, [game], entries, moves);
    const tl: Segment[] = [{ kind: 'beat', move: 20, chips: 1, frames: 56 }];
    const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const draw of [drawFull]) {
      const d = draw(sc, frameAt(tl, entries, 10));
      const pot = d.rects.chips.filter(c => c.option === null);
      expect(pot.length).toBe(1);
      expect(hit(pot[0], d.rects.drawnBoard)).toBe(false);
      for (const lane of Object.values(d.rects.lanes!)) expect(hit(pot[0], lane)).toBe(false);
      expect(d.texts.some(t => /^POT /.test(t.text))).toBe(true);
    }
  });

  it('the push-in never crops the board: the drawn board stays inside its margin, in both cuts, wherever the head is', () => {
    // heads in a corner, on an edge and in the middle, each mid-beat at full push-in
    for (const head of [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 3 }, { x: 3, y: 3 }]) {
      const steps: LogStep[] = [0, 1].map(i => ({ step: i, at: at(i), snake: [head], food: { x: 2, y: 1 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PRICES, length: 1, deaths: 0 }));
      const g: GameEntry = { number: 1, size, startedAt: at(0), endedAt: at(1), steps: 1, bestLength: 1, deaths: 0 };
      const sc = buildScene(g, [g], steps, [[]]);
      const tl: Segment[] = [{ kind: 'beat', move: 1, chips: 0, frames: 36 }];
      const i = frameAt(tl, steps, 12);
      expect(i.zoom).toBeGreaterThan(1.05);
      for (const [draw, margin, w] of [[drawFull, FULL_MARGIN, 1920], [drawShort, 10, 1080]] as const) {
        const d = draw(sc, i);
        const { board, drawnBoard } = d.rects;
        const tag = `${JSON.stringify(head)} ${w}`;
        expect(drawnBoard.x, tag).toBeGreaterThanOrEqual(board.x - margin - 0.01);
        expect(drawnBoard.y, tag).toBeGreaterThanOrEqual(board.y - margin - 0.01);
        expect(drawnBoard.x + drawnBoard.w, tag).toBeLessThanOrEqual(board.x + board.w + margin + 0.01);
        expect(drawnBoard.y + drawnBoard.h, tag).toBeLessThanOrEqual(board.y + board.h + margin + 0.01);
        // and it is really painted there: just inside each drawn corner is a board tone, not the frame's ground
        for (const [cx, cy] of [[drawnBoard.x + 3, drawnBoard.y + 3], [drawnBoard.x + drawnBoard.w - 4, drawnBoard.y + drawnBoard.h - 4]]) {
          const k = (Math.round(cy) * w + Math.round(cx)) * 3;
          const hex = '#' + [0, 1, 2].map(j => d.buffer[k + j].toString(16).padStart(2, '0')).join('');
          expect([GAME.boardA, GAME.boardB], tag).toContain(hex);
        }
      }
    }
  });

  it('when the head is low on the board the caption moves to the top, never over the head', () => {
    // a tiny level whose head sits on the bottom row during a captioned beat
    const low: LogStep[] = [0, 1, 2].map(i => ({ step: i, at: at(i), snake: [{ x: 1 + i, y: 5 }, { x: i, y: 5 }], food: { x: 0, y: 0 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PRICES, length: 2, deaths: 0 }));
    const g: GameEntry = { number: 1, size, startedAt: at(0), endedAt: at(2), steps: 2, bestLength: 2, deaths: 0 };
    const sc = buildScene(g, [g], low, [[], []]);
    const tl: Segment[] = [{ kind: 'beat', move: 1, chips: 0, frames: 72, slow: true, caption: 'One way out.' }, { kind: 'beat', move: 2, chips: 0, frames: 36 }];
    for (let f = 0; f < 72; f += 3) {
      const d = drawFull(sc, frameAt(tl, low, f));
      const { caption, head } = d.rects;
      expect(caption).not.toBeNull();
      expect(head.x > caption!.x && head.x < caption!.x + caption!.w && head.y > caption!.y && head.y < caption!.y + caption!.h, String(f)).toBe(false);
    }
  });

  it('at the lock the chosen lane is bright and the others are dimmed', () => {
    const d = drawFull(scene(), info(30 + 125));
    const { lanes, chosen } = d.rects;
    expect(chosen).toBe('forward');
    const brightness = (r: { x: number; y: number; h: number }) => {
      const k = (Math.floor(r.y + r.h / 2) * 1920 + Math.floor(r.x + 20)) * 3;
      return d.buffer[k] + d.buffer[k + 1] + d.buffer[k + 2];
    };
    expect(brightness(lanes!.forward)).toBeGreaterThan(brightness(lanes!.left) * 1.8);
    expect(brightness(lanes!.forward)).toBeGreaterThan(brightness(lanes!.right) * 1.8);
  });

  it('the fill says FILLED, a fast run shows its badge', () => {
    const sc = scene();
    expect(drawFull(sc, info(30 + 192 + 75 + 4 + 30)).texts.map(t => t.text)).toContain('FILLED');
    expect(drawFull(sc, info(10)).texts.map(t => t.text)).toContain('x6');
  });
});

describe('the Short frame', () => {
  it('every text sits inside 60 px at the sides, 180 px at the top and 390 px at the bottom', () => {
    const sc = scene();
    for (const f of [...gameplayFrames, creditsFrame]) {
      for (const t of drawShort(sc, info(f)).texts) {
        const where = `${t.text} at frame ${f}: ${JSON.stringify(t)}`;
        expect(t.x, where).toBeGreaterThanOrEqual(60);
        expect(t.x + t.w, where).toBeLessThanOrEqual(1080 - 60);
        expect(t.y, where).toBeGreaterThanOrEqual(180);
        expect(t.y + t.h, where).toBeLessThanOrEqual(1920 - 390);
      }
    }
  });
  it('no two texts overlap: the smaller-trades line stays clear of the counters', () => {
    const sc = scene();
    for (const f of gameplayFrames) {
      const texts = drawShort(sc, info(f)).texts;
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `frame ${f}: ${JSON.stringify(a)} over ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  it('is 1080 by 1920, sets nothing under 40 px, and puts the caption above the board', () => {
    expect(SHORT_SIZE).toEqual({ w: 1080, h: 1920 });
    const sc = scene();
    for (const f of [...gameplayFrames, creditsFrame]) {
      const d = drawShort(sc, info(f));
      expect(d.buffer.length).toBe(1080 * 1920 * 3);
      if (d.texts.length) expect(Math.min(...d.texts.map(t => t.size)), String(f)).toBeGreaterThanOrEqual(40);
      if (d.rects.caption) expect(d.rects.caption.y + d.rects.caption.h).toBeLessThanOrEqual(d.rects.board.y);
      if (d.rects.caption) expect(d.texts.map(t => t.text)).not.toContain('LENGTH');
    }
  });
});

describe('the ladder says what happened in plain words', () => {
  const texts = (f: number, sc = scene()) => drawFull(sc, info(f)).texts.map(t => t.text);
  it('the played row is tagged PLAYED once the move is locked, and never while its trades are still arriving', () => {
    expect(texts(45)).not.toContain('PLAYED');
    expect(texts(160).filter(t => t === 'PLAYED').length).toBe(1);
    expect(texts(250).filter(t => t === 'PLAYED').length).toBe(1);
  });
  it('the verdict line names the way and the lead over the next highest price', () => {
    // prices forward 20, left 12, right 5: straight leads by 8.0
    expect(texts(160)).toContain('Market says straight · 8.0 ahead');
    expect(texts(45).some(t => /^Market says/.test(t))).toBe(false);
  });
  it('a tie is called a tie, never "0.0 ahead"', () => {
    const tied = entries.map(e => ({ ...e, prices: { forward: 2, left: 2, right: 2 } }));
    const t = drawFull(buildScene(game, [game], tied, entries.map(() => [])), info(250)).texts.map(x => x.text);
    expect(t).toContain('Market is tied · straight played');
    expect(t.some(x => /0\.0 ahead/.test(x))).toBe(false);
  });
  it('with no recorded price the verdict says so', () => {
    const blank = entries.map(e => ({ ...e, prices: { forward: null, left: null, right: null } })) as unknown as LogStep[];
    expect(drawFull(buildScene(game, [game], blank, entries.map(() => [])), info(250)).texts.map(t => t.text)).toContain('Market has no price');
  });
});

describe('the narrator line', () => {
  const lineOf = (sc: ReturnType<typeof scene>, i: ReturnType<typeof info>) => drawFull(sc, i).narrator;
  const hold = (entry: number): Segment[] => [{ kind: 'hold', fx: 'hitstop', entry, frames: 4 }, { kind: 'credits', frames: 10 }];
  it('in a run faster than 16 moves a second it is the attempt and the best so far', () => {
    const sc = scene(), i = info(10), k = Math.floor(i.position);
    expect(i.badge).toBe('x6');
    expect(lineOf(sc, i)).toBe(`Attempt ${entries[k].deaths + 1} · best so far ${sc.best[k]} of 36`);
  });
  it('while a beat\'s trades are still arriving it says traders are pricing the move', () => {
    expect(lineOf(scene(), info(45))).toBe('Traders are pricing the next move');
  });
  it('a trade of at least 300 credits is named: the largest one, its credits and its way', () => {
    expect(lineOf(scene(), info(160))).toBe('vi0 put 900 on straight');
  });
  it('otherwise it is the attempt and the length', () => {
    const i = info(250), e = entries[Math.floor(i.position)];
    expect(lineOf(scene(), i)).toBe(`Attempt ${e.deaths + 1} · ${e.length} long`);
  });
  it('when the two highest prices are within 0.5 it says traders are split, and by how much', () => {
    const close = entries.map(e => ({ ...e, prices: { forward: 20, left: 19.7, right: 5 } }));
    const sc = buildScene(game, [game], close, entries.map(() => []));
    expect(drawFull(sc, frameAt(hold(8), close, 0)).narrator).toBe('Traders split: straight leads by 0.3');
  });
  it('a dead tie is not a split: nobody leads by 0.0', () => {
    const tied = entries.map(e => ({ ...e, prices: { forward: 2, left: 2, right: 2 } }));
    const sc = buildScene(game, [game], tied, entries.map(() => []));
    expect(drawFull(sc, frameAt(hold(8), tied, 0)).narrator).toBe(`Attempt 1 · ${tied[8].length} long`);
  });
  it('when only one way would not kill the snake it says which', () => {
    // head at the top-right corner heading right, body behind it: straight and left are wall, right (down) is free
    const corner: LogStep[] = [0, 1].map(i => ({ step: i, at: at(i), snake: i === 0 ? [{ x: 5, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 0 }] : [{ x: 5, y: 1 }, { x: 5, y: 0 }, { x: 4, y: 0 }], food: { x: 0, y: 5 }, heading: i === 0 ? 'right' : 'down', action: i ? 'right' : null, direction: i === 0 ? 'right' : 'down', undecided: false, prices: PRICES, length: 3, deaths: 0 }));
    const g: GameEntry = { number: 1, size, startedAt: at(0), endedAt: at(1), steps: 1, bestLength: 3, deaths: 0 };
    const sc = buildScene(g, [g], corner, [[]]);
    const tl: Segment[] = [{ kind: 'beat', move: 1, chips: 0, frames: 36 }];
    expect(drawFull(sc, frameAt(tl, corner, 5)).narrator).toBe('One way out: right');
  });
  it('sits under the board, clear of the margin the push-in may grow into, and is absent from the credits', () => {
    const d = drawFull(scene(), info(160));
    const t = d.texts.find(x => x.text === d.narrator)!;
    expect(t.y).toBeGreaterThanOrEqual(FULL_BOX.y + FULL_BOX.px + FULL_MARGIN);
    expect(t.y + t.h).toBeLessThanOrEqual(1080);
    expect(drawFull(scene(), info(creditsFrame)).narrator).toBe('');
  });
});

describe('the opening screens pop out of the game', () => {
  const tl: Segment[] = [{ kind: 'card', card: 'market', entry: 8, frames: 135 }, { kind: 'card', card: 'bets', entry: 8, frames: 240 }, { kind: 'card', card: 'move', entry: 8, frames: 120 }];
  const at = (f: number) => drawFull(scene(), frameAt(tl, entries, f));
  const joined = (d: ReturnType<typeof at>) => d.texts.map(t => t.text).join(' ').replace(/\s+/g, ' ');
  const pixel = (d: ReturnType<typeof at>, x: number, y: number) => { const k = (Math.round(y) * 1920 + Math.round(x)) * 3; return [d.buffer[k], d.buffer[k + 1], d.buffer[k + 2]]; };
  it('each screen carries its label and its lines once it is open', () => {
    expect(joined(at(90))).toContain('FUTARCHY SNAKE · LEVEL 2');
    expect(joined(at(90))).toContain('Nobody is playing this.');
    expect(joined(at(90))).toContain('A prediction market decides every move.');
    expect(joined(at(135 + 130))).toContain('HOW IT WORKS · 1');
    expect(joined(at(135 + 130))).toContain('Traders bet on each direction the snake can go.');
    expect(joined(at(135 + 130))).toContain('Each price is their forecast of how long the snake will get.');
    expect(joined(at(375 + 90))).toContain('HOW IT WORKS · 2');
    expect(joined(at(375 + 90))).toContain('The highest price is the move.');
    expect(joined(at(375 + 90))).toContain('Nobody steers.');
  });
  it('it opens from a line across the middle: on its first frame the game still shows above and below, fully open nothing of it does', () => {
    const boardPoint: [number, number] = [FULL_BOX.x + 10, FULL_BOX.y + 10];
    expect([GAME.boardA, GAME.boardB].map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)])).toContainEqual(pixel(at(0), ...boardPoint));
    expect(pixel(at(40), ...boardPoint)).toEqual([0x0b, 0x0b, 0x0e]);
    expect(at(40).rects.panels).toEqual([]);
    // and it closes back over its last frames
    expect(pixel(at(134), ...boardPoint)).not.toEqual([0x0b, 0x0b, 0x0e]);
  });
  it('the lines come in one after another and stay', () => {
    const count = (f: number) => ['Nobody is playing this.', 'A prediction market decides every move.'].filter(l => joined(at(f)).includes(l)).length;
    expect(count(9)).toBe(0);
    expect(count(18)).toBe(1);
    // the second line waits until the first can be read: 36 frames after it
    expect(count(45)).toBe(1);
    expect(count(52)).toBe(2);
    expect(count(120)).toBe(2);
  });
  it('a line rises into place: it sits lower when it first shows than once it has landed', () => {
    const yOf = (f: number) => at(f).texts.find(t => t.text.startsWith('Nobody'))!.y;
    expect(yOf(16)).toBeGreaterThan(yOf(40));
    expect(yOf(40)).toBe(yOf(90));
  });
  it('the words that carry the idea turn gold once their line has landed', () => {
    const d = at(90);
    const line = d.texts.find(t => t.text.includes('prediction market'))!;
    let gold = 0;
    for (let y = Math.floor(line.y); y < line.y + line.h; y++) for (let x = Math.floor(line.x); x < line.x + line.w; x++) { const [r, g, b] = pixel(d, x, y); if (r > 220 && g > 150 && g < 215 && b < 90) gold++; }
    expect(gold).toBeGreaterThan(300);
  });
  it('every line is left aligned on one margin, inside the frame, in large type', () => {
    for (const f of [90, 265, 465]) {
      const d = at(f);
      const big = d.texts.filter(t => t.size >= 60);
      expect(new Set(big.map(t => Math.round(t.x))).size).toBe(1);
      expect(Math.max(...big.map(t => t.size))).toBeGreaterThanOrEqual(84);
      for (const t of d.texts) { expect(t.x).toBeGreaterThanOrEqual(120); expect(t.x + t.w).toBeLessThanOrEqual(1920 - 120); }
    }
  });
});

describe('a long caption', () => {
  it('breaks into two lines at the space nearest its middle when it cannot fit the Short at 40 px, and stays above the board', () => {
    const text = 'Traders price each direction. The highest price moves.';
    const tl: Segment[] = [{ kind: 'beat', move: 20, chips: 0, frames: 72, slow: true, caption: text }];
    const d = drawShort(scene(), frameAt(tl, entries, 10));
    const lines = d.texts.filter(t => text.includes(t.text) && t.text.length > 10).map(t => t.text);
    expect(lines).toEqual(['Traders price each direction.', 'The highest price moves.']);
    expect(d.rects.caption!.y + d.rects.caption!.h).toBeLessThanOrEqual(d.rects.board.y);
    for (const t of d.texts) { expect(t.x + t.w).toBeLessThanOrEqual(1080 - 60); expect(t.y).toBeGreaterThanOrEqual(180); }
  });
  it('a caption that fits stays on one line', () => {
    const tl: Segment[] = [{ kind: 'beat', move: 20, chips: 0, frames: 72, slow: true, caption: 'One way out.' }];
    expect(drawShort(scene(), frameAt(tl, entries, 10)).texts.map(t => t.text)).toContain('One way out.');
  });
});

describe('the Short shows the market and the bets', () => {
  it('the ladder is under the board in every frame of the game, at speed too, with no best-so-far bar', () => {
    const sc = scene();
    for (const f of gameplayFrames) {
      const d = drawShort(sc, info(f));
      expect(d.rects.lanes, `frame ${f}`).not.toBeNull();
      for (const lane of Object.values(d.rects.lanes!)) expect(lane.y).toBeGreaterThanOrEqual(d.rects.board.y + d.rects.board.h);
      expect(d.texts.map(t => t.text)).not.toContain('BEST SO FAR');
    }
  });
  it('a row says the option, its price and the credits traded on it', () => {
    const t = drawShort(scene(), info(160)).texts.map(x => x.text);
    expect(t.some(x => /STRAIGHT$/.test(x))).toBe(true);
    expect(t).toContain('20.0');
    expect(t).toContain('950 cr');
  });
  it('the tape holds the two most recent trades, newest first, and never one of a move not yet shown', () => {
    const sc = scene();
    const tape = (f: number) => drawShort(sc, info(f)).tape.map(r => r.handle);
    expect(tape(10)).toEqual([]);
    expect(tape(30)).toEqual(['vi0']);
    expect(tape(70)).toEqual(['bob', 'vi0']);
    expect(tape(160)).toEqual(['dee', 'cy']);
    const t = drawShort(sc, info(160)).texts.map(x => x.text);
    expect(t).toContain('−300');
    expect(t).toContain('+20');
  });
  it('a frame looks the same if the record stopped at the move it shows', () => {
    const sc = scene();
    for (const f of [0, 29, 75, 160, 230]) {
      const i = info(f);
      const upTo = Math.max(Math.floor(i.position) + 1, i.beat?.move ?? 0);
      const cut = entries.slice(0, upTo + 1);
      const stopped = buildScene({ ...game, endedAt: cut[cut.length - 1].at, steps: cut.length - 1 }, [game], cut, byMove.slice(0, cut.length));
      expect(drawShort(stopped, i).buffer.equals(drawShort(sc, i).buffer), `frame ${f}`).toBe(true);
    }
  });
  it('a trade whose option cannot be named has no chip in the Short; it is on the tape with a dash', () => {
    const unnamed: TradeRow = { id: 'u1', at: at(19, 9), kind: 'trade', actor: { id: 'zed', handle: 'zed' }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: 700, callBefore: 70, callAfter: 77, marketId: 'm-unknown' } };
    const moves: TradeRow[][] = entries.map(() => []);
    moves[19] = [unnamed];
    const sc = buildScene(game, [game], entries, moves);
    const tl: Segment[] = [{ kind: 'beat', move: 20, chips: 1, frames: 56 }];
    const d = drawShort(sc, frameAt(tl, entries, 10));
    expect(d.rects.chips).toEqual([]);
    expect(d.tape.map(r => [r.handle, r.option])).toEqual([['zed', null]]);
    expect(d.texts.some(t => /^POT /.test(t.text))).toBe(false);
  });
});

describe('the frames of a whole timeline draw without error', () => {
  it('every tenth frame of the full cut draws', () => {
    const sc = scene();
    for (let f = 0; f < frameCountOf(TL); f += 10) expect(() => drawFull(sc, info(f))).not.toThrow();
  });
});
