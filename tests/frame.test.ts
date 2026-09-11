import { describe, it, expect } from 'vitest';
import { renderFrame, WIDTH, HEIGHT, cellRect, drawText, measureText } from '../src/frame.js';

const state = {
  game: { snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }], heading: 'right', food: { x: 3, y: 4 }, length: 3, step: 12, deaths: 1, complete: false },
  complete: false,
  open: {
    step: 13, openedAt: '', decideAt: new Date(Date.now() + 30_000).toISOString(),
    proposals: { up: { id: '1', title: 'Move up', url: 'https://telarchy.com/snake/p/1' }, right: { id: '2', title: 'Move right', url: '' }, down: { id: '3', title: 'Move down', url: '' }, left: { id: '4', title: 'Move left', url: '' } },
    quotes: {
      up: { m1: { approved: 3, declined: 3 }, m5: { approved: 3.1, declined: 3 }, m60: { approved: 3.2, declined: 3 } },
      right: { m1: { approved: 3, declined: 3 }, m5: { approved: 3.4, declined: 3 }, m60: { approved: 3.9, declined: 3 } },
      down: { m1: { approved: null, declined: null }, m5: { approved: null, declined: null }, m60: { approved: null, declined: null } },
      left: { m1: { approved: 3, declined: 3 }, m5: { approved: 2.5, declined: 3 }, m60: { approved: 2.1, declined: 3 } },
    },
  },
  secondsToDecision: 30,
  recentDecisions: [],
  deathsToday: 1,
  stepsTotal: 12,
  now: new Date().toISOString(),
};

function px(buf: Buffer, x: number, y: number): [number, number, number] {
  const i = (y * WIDTH + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
}

describe('the stream frame (docs/snake.md, "The stream")', () => {
  it('is a 1280 by 720 RGB buffer', () => {
    const f = renderFrame(state as any);
    expect(WIDTH).toBe(1280); expect(HEIGHT).toBe(720);
    expect(f.length).toBe(WIDTH * HEIGHT * 3);
  });

  it('paints the snake green, its head lighter, the food red, and empty cells dark', () => {
    const f = renderFrame(state as any);
    const head = cellRect(10, 10), body = cellRect(9, 10), food = cellRect(3, 4), empty = cellRect(0, 11);
    const c = (r: { x: number; y: number; w: number; h: number }) => px(f, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2));
    const [hr, hg, hb] = c(head); expect(hg).toBeGreaterThan(150); expect(hr).toBeGreaterThan(100);
    const [br, bg] = c(body); expect(bg).toBeGreaterThan(150); expect(br).toBeLessThan(120);
    const [fr, fg] = c(food); expect(fr).toBeGreaterThan(150); expect(fg).toBeLessThan(140);
    const [er, eg, eb] = c(empty); expect(Math.max(er, eg, eb)).toBeLessThan(40);
  });

  it('the board is square and fits the frame height with a margin', () => {
    const r = cellRect(11, 11);
    expect(r.x + r.w).toBeLessThanOrEqual(HEIGHT);
    expect(r.y + r.h).toBeLessThanOrEqual(HEIGHT);
    expect(cellRect(0, 0).x).toBeGreaterThan(0);
  });

  it('draws text as pixels: a non-empty string changes the buffer, and measures wider than nothing', () => {
    const a = Buffer.alloc(WIDTH * HEIGHT * 3);
    drawText(a, 700, 40, 'LENGTH 3', 3, [255, 255, 255]);
    expect(a.some(b => b !== 0)).toBe(true);
    expect(measureText('LENGTH 3', 3)).toBeGreaterThan(measureText('L', 3));
    expect(measureText('', 3)).toBe(0);
  });

  it('a frame without an open step still renders (no crash on null quotes)', () => {
    const f = renderFrame({ ...state, open: null, secondsToDecision: null } as any);
    expect(f.length).toBe(WIDTH * HEIGHT * 3);
  });

  it('the leading direction is marked: its card differs from a non-leading one at the marker pixel', () => {
    const f = renderFrame(state as any);
    const g = renderFrame({ ...state, open: { ...state.open, quotes: { ...state.open.quotes, right: { ...state.open.quotes.right, m60: { approved: 1, declined: 3 } }, up: { ...state.open.quotes.up, m60: { approved: 9, declined: 3 } } } } } as any);
    expect(Buffer.compare(f, g)).not.toBe(0);
  });

  it('the plus sign has a glyph, so a positive impact never renders as a question mark', () => {
    const a = Buffer.alloc(WIDTH * HEIGHT * 3); drawText(a, 0, 0, '+', 2, [255, 255, 255]);
    const b = Buffer.alloc(WIDTH * HEIGHT * 3); drawText(b, 0, 0, '?', 2, [255, 255, 255]);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('a complete game renders without an open step and without crashing', () => {
    const f = renderFrame({ ...state, open: null, secondsToDecision: null, complete: true, game: { ...state.game, complete: true, length: 400 } } as any);
    expect(f.length).toBe(WIDTH * HEIGHT * 3);
  });
});
