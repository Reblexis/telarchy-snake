import { describe, it, expect } from 'vitest';
import { buildScene, snakeAt, headingAt, drawFull, drawShort, FULL_SIZE, SHORT_SIZE, GAME } from '../src/draw.js';
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
  { kind: 'beat', move: 20, chips: 3, frames: 192, slow: true, caption: 'Traders bet. The highest price moves.' },
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
  // a hold shows one entry exactly, with no push-in: the full cut's board is 960 px at (60, 60), a cell 160 px
  const still = (entry: number) => drawFull(scene(), frameAt([{ kind: 'hold', fx: 'hitstop', entry, frames: 4 }, { kind: 'credits', frames: 10 }], entries, 0));
  const CELL = 160;
  const px = (d: { buffer: Buffer }, x: number, y: number) => { const k = (Math.round(y) * 1920 + Math.round(x)) * 3; return '#' + [0, 1, 2].map(j => d.buffer[k + j].toString(16).padStart(2, '0')).join(''); };
  const centre = (c: Cell) => [60 + c.x * CELL + CELL / 2, 60 + c.y * CELL + CELL / 2] as const;
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
    expect([GAME.boardA, GAME.boardB]).toContain(px(d, 60 + CELL, 60 + 4 * CELL + CELL / 2));
    expect([GAME.boardA, GAME.boardB]).toContain(px(d, 60 + CELL / 2, 60 + 5 * CELL));
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

  it('the dashboard: every panel is labelled in every frame of the game, and none shows in the credits', () => {
    const sc = scene();
    const labels = ['SNAKE · LEVEL 2 · 6×6', 'LENGTH', 'BEST', 'DEATHS', 'ATTEMPT', 'LENGTH · WHOLE LEVEL', 'MARKET · NEXT MOVE', 'TRADES'];
    for (const f of gameplayFrames) {
      const texts = drawFull(sc, info(f)).texts.map(t => t.text);
      for (const l of labels) expect(texts, `frame ${f}`).toContain(l);
      expect(texts.some(t => /^T\+/.test(t)), `frame ${f}`).toBe(true);
    }
    const credits = drawFull(sc, info(creditsFrame)).texts.map(t => t.text);
    // the credits' own stats card has DEATHS and TRADES figures; the panels' labels are what must be gone
    for (const l of labels.filter(l => l !== 'DEATHS' && l !== 'TRADES')) expect(credits).not.toContain(l);
    expect(drawFull(sc, info(creditsFrame)).rects.panels).toEqual([]);
  });

  it('the stat cells read the move on screen: length, best of the grid, deaths, attempt', () => {
    const sc = scene();
    // frame 250 is in the run after the beat, past the death at move 12
    const i = info(250), e = entries[Math.floor(i.position)];
    const texts = drawFull(sc, i).texts.map(t => t.text);
    expect(texts).toContain(String(e.length));
    expect(texts).toContain(`${sc.best[Math.floor(i.position)]} / 36`);
    expect(texts).toContain(String(e.deaths + 1));
  });

  it('the panels stay clear of the board and of the margin its push-in may grow into, and inside the frame', () => {
    const sc = scene();
    for (const f of gameplayFrames) {
      const d = drawFull(sc, info(f));
      expect(d.rects.panels.length, `frame ${f}`).toBe(5);
      for (const r of d.rects.panels) {
        expect(r.x, JSON.stringify(r)).toBeGreaterThanOrEqual(60 + 960 + 50);
        expect(r.x + r.w).toBeLessThanOrEqual(1920 - 40);
        expect(r.y).toBeGreaterThanOrEqual(40);
        expect(r.y + r.h).toBeLessThanOrEqual(1080 - 40);
      }
      // the panels stack: none overlaps another
      const ps = d.rects.panels;
      for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) expect(ps[a].y + ps[a].h <= ps[b].y || ps[b].y + ps[b].h <= ps[a].y, `frame ${f} panels ${a},${b}`).toBe(true);
    }
  });

  it('no two texts overlap anywhere on the dashboard', () => {
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
    const sc = buildScene(game, [game], entries, moves);
    const tape = (f: number) => drawFull(sc, info(f)).tape.map(r => r.handle);
    expect(tape(0)).toEqual([]);
    // the run reaches move 5 somewhere before the beat; by its last frame both early trades are on the tape, newest first
    expect(tape(29)).toEqual(['fay', 'eve']);
    // the beat on move 20: a chip's trade enters when its chip starts (chips at frames 30, 70, 110)
    expect(tape(30)).toEqual(['vi0', 'fay', 'eve']);
    expect(tape(69)).toEqual(['vi0', 'fay', 'eve']);
    expect(tape(70)).toEqual(['bob', 'vi0', 'fay', 'eve']);
    expect(tape(115)).toEqual(['dee', 'bob', 'vi0', 'fay', 'eve']);
    // at the lock the move's smaller trades enter; the tape holds the five most recent, newest first
    expect(tape(150)).toEqual(['dee', 'cy', 'bob', 'vi0', 'ann']);
    expect(tape(250)).toEqual(['dee', 'cy', 'bob', 'vi0', 'ann']);
  });

  it('a tape row says who, which way, how much and the price it moved; a bet against is a minus', () => {
    const d = drawFull(scene(), info(160));
    const dee = d.tape.find(r => r.handle === 'dee')!;
    expect(dee).toMatchObject({ option: 'left', against: true });
    const texts = d.texts.map(t => t.text);
    expect(texts).toContain('−300');
    expect(texts).toContain('+900');
    expect(texts).toContain('30.0 → 12.0');
  });

  it('the playhead marks the move on screen: it starts at the chart\'s left, only moves right, and ends at its right', () => {
    const sc = scene();
    const gameplay = frameCountOf(TL) - 540;
    let last = -Infinity;
    for (let f = 0; f < gameplay; f += 5) {
      const i = info(f), d = drawFull(sc, i), c = d.rects.chart!;
      expect(d.rects.playhead!).toBeCloseTo(c.x + c.w * (i.position / (entries.length - 1)), 3);
      expect(d.rects.playhead!).toBeGreaterThanOrEqual(last);
      last = d.rects.playhead!;
    }
    const c = drawFull(sc, info(0)).rects.chart!;
    expect(drawFull(sc, info(0)).rects.playhead).toBeCloseTo(c.x, 3);
    expect(last).toBeCloseTo(c.x + c.w, 0);
  }, 60_000);

  it('the chart is bright where the level has played and dimmed where it has not', () => {
    const sc = scene();
    const d = drawFull(sc, info(250)), c = d.rects.chart!, ph = d.rects.playhead!;
    const lum = (x0: number, x1: number) => { let s = 0, n = 0; for (let y = Math.round(c.y); y < c.y + c.h; y++) for (let x = Math.round(x0); x < x1; x++) { const k = (y * 1920 + x) * 3; s += d.buffer[k] + d.buffer[k + 1] + d.buffer[k + 2]; n++; } return s / n; };
    expect(ph - c.x).toBeGreaterThan(40);
    expect(c.x + c.w - ph).toBeGreaterThan(40);
    // the line sits at the same heights either side only roughly, so compare the brightest pixel instead of the mean
    const peak = (x0: number, x1: number) => { let m = 0; for (let y = Math.round(c.y); y < c.y + c.h; y++) for (let x = Math.round(x0); x < x1; x++) { const k = (y * 1920 + x) * 3; m = Math.max(m, d.buffer[k] + d.buffer[k + 1] + d.buffer[k + 2]); } return m; };
    void lum;
    expect(peak(c.x, ph - 4)).toBeGreaterThan(peak(ph + 4, c.x + c.w) * 1.5);
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
    const texts = drawFull(scene(), info(30 + 40)).texts.map(t => t.text);
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

  it('a trade whose option cannot be named has its chip on the pot\'s line, never over the board or a lane, in both cuts', () => {
    const unnamed: TradeRow = { id: 'u1', at: at(19, 9), kind: 'trade', actor: { id: 'zed', handle: 'zed' }, detail: { side: 'buy', direction: 'higher', shares: 1, cost: 700, callBefore: 70, callAfter: 77, marketId: 'm-unknown' } };
    const moves: TradeRow[][] = entries.map(() => []);
    moves[19] = [unnamed];
    const sc = buildScene(game, [game], entries, moves);
    const tl: Segment[] = [{ kind: 'beat', move: 20, chips: 1, frames: 56 }];
    const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const draw of [drawFull, drawShort]) {
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
      for (const [draw, margin, w] of [[drawFull, 50, 1920], [drawShort, 10, 1080]] as const) {
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
    const tl: Segment[] = [{ kind: 'beat', move: 1, chips: 0, frames: 72, slow: true, caption: 'A market picks every move.' }, { kind: 'beat', move: 2, chips: 0, frames: 36 }];
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

describe('the frames of a whole timeline draw without error', () => {
  it('every tenth frame of the full cut draws', () => {
    const sc = scene();
    for (let f = 0; f < frameCountOf(TL); f += 10) expect(() => drawFull(sc, info(f))).not.toThrow();
  });
});
