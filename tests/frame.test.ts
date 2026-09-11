import { describe, it, expect } from 'vitest';
import { renderFrame, WIDTH, HEIGHT, cellRect, drawText, measureText, NEXT_LABEL } from '../src/frame.js';

const state = {
  game: { snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }], heading: 'right', food: { x: 3, y: 4 }, length: 3, step: 12, deaths: 1, complete: false, size: 12, gameNumber: 1 },
  grid: 12,
  complete: false,
  open: {
    step: 13, openedAt: '', decideAt: new Date(Date.now() + 30_000).toISOString(),
    proposals: { forward: { id: '1', title: 'Continue forward', url: 'https://telarchy.com/snake/p/1' }, left: { id: '2', title: 'Turn left', url: '' }, right: { id: '3', title: 'Turn right', url: '' } },
    directions: { forward: 'right', left: 'up', right: 'down' },
    quotes: {
      forward: { m1: { approved: 3, declined: 3 }, m5: { approved: 3.1, declined: 3 }, m60: { approved: 3.2, declined: 3 } },
      left: { m1: { approved: 3, declined: 3 }, m5: { approved: 3.4, declined: 3 }, m60: { approved: 3.9, declined: 3 } },
      right: { m1: { approved: null, declined: null }, m5: { approved: null, declined: null }, m60: { approved: null, declined: null } },
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
    const g = renderFrame({ ...state, open: { ...state.open, quotes: { ...state.open.quotes, left: { ...state.open.quotes.left, m60: { approved: 1, declined: 3 } }, forward: { ...state.open.quotes.forward, m60: { approved: 9, declined: 3 } } } } } as any);
    expect(Buffer.compare(f, g)).not.toBe(0);
  });

  it('the heading is marked on the head: a snake heading right and one heading up render different head cells', () => {
    const a = renderFrame(state as any);
    const b = renderFrame({ ...state, game: { ...state.game, heading: 'up' } } as any);
    const r = cellRect(10, 10);
    const slice = (buf: Buffer) => buf.subarray((r.y * WIDTH + r.x) * 3, ((r.y + r.h) * WIDTH + r.x + r.w) * 3);
    expect(Buffer.compare(slice(a), slice(b))).not.toBe(0);
  });

  it('the plus sign has a glyph, so a positive impact never renders as a question mark', () => {
    const a = Buffer.alloc(WIDTH * HEIGHT * 3); drawText(a, 0, 0, '+', 2, [255, 255, 255]);
    const b = Buffer.alloc(WIDTH * HEIGHT * 3); drawText(b, 0, 0, '?', 2, [255, 255, 255]);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('draws the grid at the state\'s size: on a 13-grid the last cell is inside the board', () => {
    const f = renderFrame({ ...state, grid: 13, game: { ...state.game, size: 13, snake: [{ x: 12, y: 12 }] } } as any);
    const r = cellRect(12, 12, 13);
    const [, g] = px(f, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2));
    expect(g).toBeGreaterThan(150);
    expect(r.x + r.w).toBeLessThanOrEqual(HEIGHT);
  });

  it('a complete game renders without an open step and without crashing', () => {
    const f = renderFrame({ ...state, open: null, secondsToDecision: null, complete: true, game: { ...state.game, complete: true, length: 400 } } as any);
    expect(f.length).toBe(WIDTH * HEIGHT * 3);
  });
});

describe('the stream frame: activity (docs/snake.md, "The stream")', () => {
  const rich = {
    ...state,
    bestLength: 5,
    next: { action: 'left', direction: 'up', decided: false, seconds: 30 },
    commentary: 'Food is 6 cells up and 7 cells left: the market leans turn left (up).',
    traders: [{ handle: 'ada_bot', action: 'left', horizon: 'm60', branch: 'approved', side: 'higher', shares: 2, cost: 5, worth: 6 }],
    tradersThisStep: 1, tradersToday: 3,
    recentTrades: [{ id: 't1', at: '2026-09-11T10:00:08Z', handle: 'ada_bot', step: 13, action: 'left', horizon: 'm60', branch: 'approved', side: 'higher', kind: 'buy', shares: 2, cost: 5, marketId: 'x', price: 3.5 }],
    leaderboard: [{ rank: 1, handle: 'ada_bot', profit: 12.5, trades: 9 }],
    recentDecisions: [{ step: 12, action: 'forward', direction: 'right', undecided: false, quotes: state.open.quotes, lengthBefore: 3, lengthAfter: 3 }],
  };

  it('every text line stays inside the frame: the title fits the right column at its scale', () => {
    // 1280 - 724 = 556 px of column; the widest title is a two-digit game on a two-digit grid.
    expect(measureText('FUTARCHY SNAKE', 4)).toBeLessThanOrEqual(556);
    expect(measureText('GAME 12  15X15  THE MARKET PICKS EVERY MOVE', 2)).toBeLessThanOrEqual(556);
    // The next-move line shares its row with the countdown ("IN 58S" at scale 3, about 130 px).
    for (const a of Object.keys(NEXT_LABEL)) expect(measureText(`NEXT: ${NEXT_LABEL[a]} > RIGHT`, 3), a).toBeLessThanOrEqual(532 - 130);
  });

  it('draws the next move: a frame with a left leader differs from one with a right leader, cards aside', () => {
    const a = renderFrame({ ...rich, open: null, secondsToDecision: null } as any);
    const b = renderFrame({ ...rich, open: null, secondsToDecision: null, next: { action: 'right', direction: 'down', decided: false, seconds: 30 } } as any);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('draws the commentary, the traders, the trades and the leaderboard: each changes the frame', () => {
    const f = renderFrame(rich as any);
    for (const [k, v] of [['commentary', ''], ['traders', []], ['recentTrades', []], ['leaderboard', []]] as const) {
      const g = renderFrame({ ...rich, [k]: v } as any);
      expect(Buffer.compare(f, g), k).not.toBe(0);
    }
  });

  it('renders with the activity fields missing (an old /state) and with long handles without crashing', () => {
    expect(renderFrame(state as any).length).toBe(WIDTH * HEIGHT * 3);
    const long = { ...rich, traders: Array.from({ length: 40 }, (_, i) => ({ ...rich.traders[0], handle: 'a-very-long-handle-name-indeed-' + i })), recentTrades: Array.from({ length: 30 }, (_, i) => ({ ...rich.recentTrades[0], id: 't' + i, handle: 'another_quite_long_handle_' + i })) };
    expect(renderFrame(long as any).length).toBe(WIDTH * HEIGHT * 3);
  });

  it('underscore and comma have glyphs, so a handle never renders as question marks', () => {
    for (const ch of ['_', ',', '!']) {
      const a = Buffer.alloc(WIDTH * HEIGHT * 3); drawText(a, 0, 0, ch, 2, [255, 255, 255]);
      const b = Buffer.alloc(WIDTH * HEIGHT * 3); drawText(b, 0, 0, '?', 2, [255, 255, 255]);
      expect(Buffer.compare(a, b), ch).not.toBe(0);
    }
  });

  it('nothing is drawn below the frame: the last row of pixels is background only', () => {
    const f = renderFrame(rich as any);
    const y = HEIGHT - 1;
    for (let x = 0; x < WIDTH; x += 7) { const [r, g, b] = px(f, x, y); expect(Math.max(r, g, b)).toBeLessThan(20); }
  });
});
