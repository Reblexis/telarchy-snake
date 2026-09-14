import { describe, it, expect } from 'vitest';
import { buildScene, snakeAt, drawFull, drawShort, FULL_SIZE, SHORT_SIZE } from '../src/draw.js';
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
const trade = (move: number, credits: number, handle: string, option: 'forward' | 'left' | 'right', k: number): TradeRow => ({
  id: `t${move}-${k}`, at: at(move - 1, 5 + k), kind: 'trade', actor: { id: handle, handle },
  detail: { side: 'buy', direction: 'higher', shares: 1, cost: credits, callBefore: 1, callAfter: PRICES[option], marketId: `m-${option}` },
});
const byMove: TradeRow[][] = entries.map(() => []);
// move 20 (entries 19 -> 20): five trades, the three largest 900, 400, 300, and all of forward's credits 900 + 50 = 950
byMove[19] = [trade(20, 50, 'ann', 'forward', 0), trade(20, 900, 'vi0', 'forward', 1), trade(20, 400, 'bob', 'left', 2), trade(20, 20, 'cy', 'right', 3), trade(20, 300, 'dee', 'left', 4)];
const game: GameEntry = { number: 2, size, startedAt: at(0), endedAt: at(30), steps: 30, bestLength: len, deaths: 1 };
const scene = () => buildScene(game, [game], entries, byMove);

const TL: Segment[] = [
  { kind: 'run', from: 0, to: 19, speed: 24, frames: 30, easeIn: false, easeOut: true },
  { kind: 'beat', move: 20, chips: 3, frames: 45, caption: 'Traders bet. The highest price moves.' },
  { kind: 'run', from: 20, to: 30, speed: 4, frames: 75, easeIn: true, easeOut: false },
  { kind: 'hold', fx: 'hitstop', entry: 30, frames: 4 },
  { kind: 'hold', fx: 'filled', entry: 30, frames: 90 },
  { kind: 'credits', frames: 540 },
];
const info = (f: number) => frameAt(TL, entries, f);
const gameplayFrames = [0, 10, 29, 30, 45, 62, 74, 80, 120, 160, 200];
const creditsFrame = 30 + 45 + 75 + 4 + 90 + 100;

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

  it('the race bars show on every beat frame and on no other; at speed the best-so-far bar takes their place', () => {
    const sc = scene();
    const gameplay = frameCountOf(TL) - 540;
    for (let f = 0; f < gameplay; f += 3) {
      const i = info(f);
      const d = drawFull(sc, i);
      if (i.beat) expect(d.rects.lanes, `beat frame ${f}`).not.toBeNull();
      else expect(d.rects.lanes, `${i.kind} frame ${f}`).toBeNull();
    }
    expect(drawFull(sc, info(10)).texts.some(t => t.text === 'BEST SO FAR')).toBe(true);
  });

  it('the chips are the three largest trades, each inside its own lane', () => {
    const sc = scene();
    const seen = new Set<string>();
    for (let lf = 0; lf < 30; lf++) {
      const d = drawFull(sc, info(30 + lf));
      for (const c of d.rects.chips) {
        seen.add(c.text);
        const lane = d.rects.lanes![c.option as 'forward' | 'left' | 'right'];
        expect(c.y, JSON.stringify(c)).toBeGreaterThanOrEqual(lane.y - 1);
        expect(c.y + c.h, JSON.stringify(c)).toBeLessThanOrEqual(lane.y + lane.h + 1);
      }
    }
    expect([...seen].sort()).toEqual(['+300', '+400', '+900']);
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

  it('when the head is low on the board the caption moves to the top, never over the head', () => {
    // a tiny level whose head sits on the bottom row during a captioned beat
    const low: LogStep[] = [0, 1, 2].map(i => ({ step: i, at: at(i), snake: [{ x: 1 + i, y: 5 }, { x: i, y: 5 }], food: { x: 0, y: 0 }, heading: 'right', action: i ? 'forward' : null, direction: 'right', undecided: false, prices: PRICES, length: 2, deaths: 0 }));
    const g: GameEntry = { number: 1, size, startedAt: at(0), endedAt: at(2), steps: 2, bestLength: 2, deaths: 0 };
    const sc = buildScene(g, [g], low, [[], []]);
    const tl: Segment[] = [{ kind: 'beat', move: 1, chips: 0, frames: 15, caption: 'A market picks every move.' }, { kind: 'beat', move: 2, chips: 0, frames: 15 }];
    for (let f = 0; f < 15; f++) {
      const d = drawFull(sc, frameAt(tl, low, f));
      const { caption, head } = d.rects;
      expect(caption).not.toBeNull();
      expect(head.x > caption!.x && head.x < caption!.x + caption!.w && head.y > caption!.y && head.y < caption!.y + caption!.h, String(f)).toBe(false);
    }
  });

  it('at the lock the chosen lane is bright and the others are dimmed', () => {
    const d = drawFull(scene(), info(30 + 31));
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
    expect(drawFull(sc, info(30 + 45 + 75 + 4 + 30)).texts.map(t => t.text)).toContain('FILLED');
    expect(drawFull(sc, info(10)).texts.map(t => t.text)).toContain('x6');
  });
});

describe('the Short frame', () => {
  it('is 1080 by 1920, sets nothing under 40 px, and puts the caption above the board', () => {
    expect(SHORT_SIZE).toEqual({ w: 1080, h: 1920 });
    const sc = scene();
    for (const f of [...gameplayFrames, creditsFrame]) {
      const d = drawShort(sc, info(f));
      expect(d.buffer.length).toBe(1080 * 1920 * 3);
      if (d.texts.length) expect(Math.min(...d.texts.map(t => t.size)), String(f)).toBeGreaterThanOrEqual(40);
      if (d.rects.caption) expect(d.rects.caption.y + d.rects.caption.h).toBeLessThanOrEqual(d.rects.board.y);
    }
  });
});

describe('the frames of a whole timeline draw without error', () => {
  it('every tenth frame of the full cut draws', () => {
    const sc = scene();
    for (let f = 0; f < frameCountOf(TL); f += 10) expect(() => drawFull(sc, info(f))).not.toThrow();
  });
});
