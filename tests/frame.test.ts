import { describe, it, expect } from 'vitest';
import { renderFrame, WIDTH, HEIGHT, cellRect, measureText, NEXT_LABEL, FONT } from '../src/frame.js';

const state = {
  game: { snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }], heading: 'right', food: { x: 3, y: 4 }, length: 3, step: 12, deaths: 1, complete: false, size: 12, gameNumber: 1 },
  grid: 12,
  complete: false,
  open: {
    step: 13, openedAt: '', decideAt: new Date(Date.now() + 30_000).toISOString(),
    proposals: { forward: { id: '1', title: 'Continue forward', url: 'https://telarchy.com/snake/p/1' }, left: { id: '2', title: 'Turn left', url: '' }, right: { id: '3', title: 'Turn right', url: '' } },
    directions: { forward: 'right', left: 'up', right: 'down' },
    quotes: {
      forward: { m60: { approved: 3.2, declined: 3 } },
      left: { m60: { approved: 3.9, declined: 3 } },
      right: { m60: { approved: null, declined: null } },
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

  it('text is set in the bundled Inter face, not a bitmap font: a wide string measures wider, an empty one zero', () => {
    expect(FONT).toMatch(/Inter/);
    expect(measureText('Length 3', 32)).toBeGreaterThan(measureText('L', 32));
    expect(measureText('', 32)).toBe(0);
    // proportional: a capital W is wider than a lower-case i, which a 5x7 bitmap font cannot do
    expect(measureText('W', 32)).toBeGreaterThan(measureText('i', 32));
  });

  it('a frame without an open step still renders (no crash on null quotes)', () => {
    const f = renderFrame({ ...state, open: null, secondsToDecision: null } as any);
    expect(f.length).toBe(WIDTH * HEIGHT * 3);
  });

  it('the leading direction is marked: its tile differs from a non-leading one', () => {
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

describe('the stream frame: the first screen and nothing more (docs/snake.md, "The stream")', () => {
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

  it('the next-move line fits beside the clock in the right column', () => {
    // 1280 - (24 + 672 + 40) - 24 = 520 px of column; the clock "0:58" takes its share at the same size.
    for (const a of Object.keys(NEXT_LABEL)) expect(measureText(`→ ${NEXT_LABEL[a]}`, 48) + measureText('0:58', 48) + 16, a).toBeLessThanOrEqual(520);
  });

  it('draws the next move: a frame with a left leader differs from one with a right leader, tiles aside', () => {
    const a = renderFrame({ ...rich, open: null, secondsToDecision: null } as any);
    const b = renderFrame({ ...rich, open: null, secondsToDecision: null, next: { action: 'right', direction: 'down', decided: false, seconds: 30 } } as any);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('a decided move renders differently from the same move still open', () => {
    const a = renderFrame(rich as any);
    const b = renderFrame({ ...rich, next: { ...rich.next, decided: true } } as any);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('the quiet line is the newest trade, else the commentary, never both', () => {
    const withTrade = renderFrame(rich as any);
    // with a trade the commentary is not drawn: changing it changes nothing
    expect(Buffer.compare(withTrade, renderFrame({ ...rich, commentary: 'Something else entirely.' } as any))).toBe(0);
    // without a trade the commentary is drawn
    const noTrade = renderFrame({ ...rich, recentTrades: [] } as any);
    expect(Buffer.compare(noTrade, renderFrame({ ...rich, recentTrades: [], commentary: 'Something else entirely.' } as any))).not.toBe(0);
    // and the trade itself is drawn
    expect(Buffer.compare(withTrade, noTrade)).not.toBe(0);
  });

  it('draws no traders, leaderboard, decisions or counters: changing them changes nothing', () => {
    const f = renderFrame(rich as any);
    const g = renderFrame({ ...rich, traders: [], tradersThisStep: 0, tradersToday: 0, leaderboard: [], recentDecisions: [], deathsToday: 42, game: { ...rich.game, step: 999 } } as any);
    expect(Buffer.compare(f, g)).toBe(0);
  });

  it('draws the status line: length, record, game number and grid each change the frame', () => {
    const f = renderFrame(rich as any);
    expect(Buffer.compare(f, renderFrame({ ...rich, game: { ...rich.game, length: 44 } } as any))).not.toBe(0);
    expect(Buffer.compare(f, renderFrame({ ...rich, bestLength: 44 } as any))).not.toBe(0);
    expect(Buffer.compare(f, renderFrame({ ...rich, gameNumber: 7 } as any))).not.toBe(0);
  });

  it('renders with the activity fields missing (an old /state) and with long handles without crashing', () => {
    expect(renderFrame(state as any).length).toBe(WIDTH * HEIGHT * 3);
    const long = { ...rich, recentTrades: [{ ...rich.recentTrades[0], handle: 'a-very-long-handle-name-indeed-that-goes-on-and-on-and-on' }], commentary: 'x '.repeat(400) };
    expect(renderFrame(long as any).length).toBe(WIDTH * HEIGHT * 3);
  });

  it('nothing is drawn below the frame: the last row of pixels is background only', () => {
    const f = renderFrame(rich as any);
    const y = HEIGHT - 1;
    for (let x = 0; x < WIDTH; x += 7) { const [r, g, b] = px(f, x, y); expect(Math.max(r, g, b)).toBeLessThan(20); }
  });
});
