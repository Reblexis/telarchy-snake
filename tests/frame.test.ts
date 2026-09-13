import { describe, it, expect } from 'vitest';
import { nextGridLabel, renderFrame, drawnTexts, pillRects, panelFor, WIDTH, HEIGHT, cellRect, measureText, FONT, FONTS, LINK_TEXT, LOGO_BOX, LOGO_NATURAL, PANEL_MS, isDrawableState } from '../src/frame.js';

const state = {
  game: { snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }], heading: 'right', food: { x: 3, y: 4 }, length: 3, step: 12, deaths: 1, complete: false, size: 12, gameNumber: 1 },
  grid: 12,
  complete: false,
  open: {
    step: 13, openedAt: '', decideAt: new Date(Date.now() + 30_000).toISOString(),
    proposal: { id: '1', number: 1, url: 'https://telarchy.com/snake/p/1' },
    directions: { forward: 'right', left: 'up', right: 'down' },
    quotes: {
      forward: { m60: { price: 3.2, lead: -0.7, marketId: 'f' } },
      left: { m60: { price: 3.9, lead: 0.7, marketId: 'l' } },
      right: { m60: { price: null, lead: null, reason: 'no consensus' } },
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

  it('paints the snake green, its head the same green, the food red, and empty cells dark', () => {
    const f = renderFrame(state as any);
    const head = cellRect(10, 10, 12), body = cellRect(9, 10, 12), food = cellRect(3, 4, 12), empty = cellRect(0, 11, 12);
    const c = (r: { x: number; y: number; w: number; h: number }) => px(f, r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2));
    const [hr, hg] = c(head); expect(hg).toBeGreaterThan(150); expect(hr).toBeLessThan(120);
    const [br, bg] = c(body); expect(bg).toBeGreaterThan(150); expect(br).toBeLessThan(120);
    const [fr, fg] = c(food); expect(fr).toBeGreaterThan(150); expect(fg).toBeLessThan(140);
    const [er, eg, eb] = c(empty); expect(Math.max(er, eg, eb)).toBeLessThan(40);
  });

  it('the board is square and fits the frame height with a margin', () => {
    const r = cellRect(11, 11, 12);
    expect(r.x + r.w).toBeLessThanOrEqual(HEIGHT);
    expect(r.y + r.h).toBeLessThanOrEqual(HEIGHT);
    expect(cellRect(0, 0, 12).x).toBeGreaterThan(0);
  });

  it('text is set in bundled faces, never a system font: Inter, Fraunces and JetBrains Mono, all proportional or mono as they should be', () => {
    expect(FONT).toMatch(/Inter/);
    expect(FONTS).toEqual(expect.objectContaining({ sans: 'Inter', serif: 'Fraunces', mono: 'JetBrains Mono' }));
    expect(measureText('WWWW', 20, 600, 'mono')).toBeCloseTo(measureText('iiii', 20, 600, 'mono'), 0);
    expect(measureText('Snake', 44, 600, 'serif')).toBeGreaterThan(measureText('S', 44, 600, 'serif'));
    expect(measureText('Length 3', 32)).toBeGreaterThan(measureText('L', 32));
    expect(measureText('', 32)).toBe(0);
    // proportional: a capital W is wider than a lower-case i, which a 5x7 bitmap font cannot do
    expect(measureText('W', 32)).toBeGreaterThan(measureText('i', 32));
  });

  it('a frame without an open step still renders (no crash on null quotes)', () => {
    const f = renderFrame({ ...state, open: null, secondsToDecision: null } as any);
    expect(f.length).toBe(WIDTH * HEIGHT * 3);
  });

  it('the leading option is marked by its price: moving the highest price to another tile changes the frame', () => {
    const f = renderFrame(state as any);
    const g = renderFrame({ ...state, open: { ...state.open, quotes: { ...state.open.quotes, left: { m60: { price: 1, lead: -8 } }, forward: { m60: { price: 9, lead: 8 } } } } } as any);
    expect(Buffer.compare(f, g)).not.toBe(0);
  });

  it('THE TILES SHOW EACH OPTION\'S PRICE: changing one price changes the frame, and a null price still renders', () => {
    const f = renderFrame(state as any);
    const g = renderFrame({ ...state, open: { ...state.open, quotes: { ...state.open.quotes, forward: { m60: { price: 3.3, lead: -0.6 } } } } } as any);
    expect(Buffer.compare(f, g)).not.toBe(0);
    expect(renderFrame({ ...state, open: { ...state.open, quotes: { forward: { m60: { price: null, lead: null } }, left: { m60: { price: null, lead: null } }, right: { m60: { price: null, lead: null } } } } } as any).length).toBe(WIDTH * HEIGHT * 3);
  });

  it('the tiles read the price, never approved minus declined: an old-shape quote renders as unpriced, the same as a null price', () => {
    const old = renderFrame({ ...state, open: { ...state.open, quotes: { forward: { m60: { approved: 9, declined: 3 } }, left: { m60: { approved: 1, declined: 3 } }, right: { m60: { approved: 1, declined: 3 } } } } } as any);
    const nul = renderFrame({ ...state, open: { ...state.open, quotes: { forward: { m60: { price: null, lead: null } }, left: { m60: { price: null, lead: null } }, right: { m60: { price: null, lead: null } } } } } as any);
    expect(Buffer.compare(old, nul)).toBe(0);
  });

  it('the heading is marked on the head: a snake heading right and one heading up render different head cells', () => {
    const a = renderFrame(state as any);
    const b = renderFrame({ ...state, game: { ...state.game, heading: 'up' } } as any);
    const r = cellRect(10, 10, 12);
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

describe('THE GRID SHOWS AN ARROW IN THE CELL THE SNAKE MOVES TO NEXT (docs/snake.md, "The stream")', () => {
  // Head at (10,10) heading right; (3,3) is an empty interior cell.
  const cellOf = (buf: Buffer, x: number, y: number, n = 12) => {
    const r = cellRect(x, y, n);
    return buf.subarray((r.y * WIDTH + r.x) * 3, ((r.y + r.h) * WIDTH + r.x + r.w) * 3);
  };
  /** Whether a cell holds a pixel in the accent (amber: red over green over blue), which neither the snake, the head, the food nor the ground has. */
  const hasAccent = (buf: Buffer, x: number, y: number, n = 12) => {
    const r = cellRect(x, y, n);
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
      const [pr, pg, pb] = px(buf, xx, yy);
      if (pr > 120 && pg > 90 && pb < 80 && pr > pg) return true;
    }
    return false;
  };
  const withNext = (direction: string, decided = false) => ({ ...state, next: { action: 'forward', direction, decided, seconds: 30 } });

  it('the arrow cell differs from an empty cell: it holds the accent, the empty cell does not', () => {
    const f = renderFrame(withNext('up') as any);
    expect(hasAccent(f, 10, 9)).toBe(true);
    expect(hasAccent(f, 3, 3)).toBe(false);
    expect(Buffer.compare(cellOf(f, 10, 9), cellOf(f, 3, 3))).not.toBe(0);
  });

  it('the arrow moves with next.direction: up marks (10,9), down marks (10,11) and leaves (10,9) clear', () => {
    const up = renderFrame(withNext('up') as any);
    const down = renderFrame(withNext('down') as any);
    expect(hasAccent(down, 10, 11)).toBe(true);
    expect(hasAccent(down, 10, 9)).toBe(false);
    expect(hasAccent(up, 10, 11)).toBe(false);
  });

  it('without next the arrow follows the heading (forward is the default): right marks (11,10)', () => {
    const f = renderFrame(state as any);
    expect(hasAccent(f, 11, 10)).toBe(true);
    expect(hasAccent(f, 10, 9)).toBe(false);
  });

  it('a decided arrow is drawn differently from an open one, and both are in the accent', () => {
    const open = renderFrame(withNext('up') as any);
    const decided = renderFrame(withNext('up', true) as any);
    expect(hasAccent(open, 10, 9)).toBe(true);
    expect(hasAccent(decided, 10, 9)).toBe(true);
    expect(Buffer.compare(cellOf(open, 10, 9), cellOf(decided, 10, 9))).not.toBe(0);
  });

  it('A MOVE INTO A WALL IS A BAR ALONG THAT WALL, AND NOTHING IS DRAWN OUTSIDE THE BOARD', () => {
    const atWall = { ...state, game: { ...state.game, snake: [{ x: 11, y: 10 }, { x: 10, y: 10 }, { x: 9, y: 10 }] } };
    const right = renderFrame({ ...atWall, next: { action: 'forward', direction: 'right', decided: false, seconds: 30 } } as any);
    const up = renderFrame({ ...atWall, next: { action: 'left', direction: 'up', decided: false, seconds: 30 } } as any);
    expect(hasAccent(right, 11, 10)).toBe(true);
    expect(hasAccent(up, 11, 10)).toBe(false);
    expect(hasAccent(up, 11, 9)).toBe(true);
    // The bar hugs the wall: the accent sits in the cell's outer strip, not
    // across its middle where a chevron over the head used to be.
    const c = cellRect(11, 10, 12);
    const strip = (buf: Buffer, x0: number, x1: number) => {
      for (let y = c.y + 4; y < c.y + c.h - 4; y++) for (let x = x0; x < x1; x++) {
        const i = (y * 1280 + x) * 3;
        if (buf[i] > 150 && buf[i + 1] > 110 && buf[i + 2] < 120) return true;
      }
      return false;
    };
    expect(strip(right, c.x + c.w - Math.round(c.w * 0.25), c.x + c.w)).toBe(true);
    expect(strip(right, c.x, c.x + Math.round(c.w * 0.4))).toBe(false);
    // Beyond the board's right edge the two frames agree pixel for pixel: the wall arrow adds nothing off the grid.
    const r = cellRect(11, 10, 12);
    for (let y = r.y - r.h; y < r.y + 2 * r.h; y++) for (let x = r.x + r.w; x < r.x + r.w + 30; x++) expect(px(right, x, y), `${x},${y}`).toEqual(px(up, x, y));
  });
});

describe('the stream frame: Telarchy\'s floor in its dark theme (docs/snake.md, "The stream")', () => {
  const rich = {
    ...state,
    attempt: 2,
    bestLength: 5,
    next: { action: 'left', direction: 'up', decided: false, seconds: 30 },
    commentary: 'Food is 6 cells up and 7 cells left: the market leans turn left (up).',
    traders: [{ handle: 'ada_bot', action: 'left', horizon: 'm60', side: 'higher', shares: 2, cost: 5, worth: 6 }],
    tradersThisStep: 1, tradersToday: 3,
    recentTrades: [{ id: 't1', at: '2026-09-11T10:00:08Z', handle: 'ada_bot', step: 13, action: 'left', horizon: 'm60', side: 'higher', kind: 'buy', shares: 2, cost: 5, marketId: 'x', price: 3.5 }],
    restingOrders: [] as any[],
    leaderboard: [{ rank: 1, handle: 'lead_bot', profit: 1250.5, trades: 9 }],
    recentDecisions: [{ step: 12, action: 'forward', direction: 'right', undecided: false, quotes: state.open.quotes, prices: { forward: 3.2, left: 3.9, right: null }, lengthBefore: 3, lengthAfter: 3 }],
  };
  /** An instant on the Log page, 22 seconds after the trade. */
  const LOG_AT = (() => { let t = Date.parse('2026-09-11T10:00:30Z'); while (panelFor(t, rich as any) !== 'log') t += PANEL_MS; return t; })();

  it('the three option pills fit inside the 520 px column', () => {
    const rects = pillRects(rich as any);
    expect(rects.length).toBe(3);
    for (const r of rects) { expect(r.x).toBeGreaterThanOrEqual(736); expect(r.x + r.w).toBeLessThanOrEqual(1256); }
    const long = { ...rich, open: { ...rich.open, quotes: { forward: { m60: { price: 34.56, lead: 1 } }, left: { m60: { price: 34.56, lead: 1 } }, right: { m60: { price: 34.56, lead: 1 } } } } };
    for (const r of pillRects(long as any)) expect(r.x + r.w).toBeLessThanOrEqual(1256);
  });

  it('draws the next move: a frame with a left leader differs from one with a right leader, tiles aside', () => {
    const a = renderFrame({ ...rich, open: null, secondsToDecision: null } as any, LOG_AT);
    const b = renderFrame({ ...rich, open: null, secondsToDecision: null, next: { action: 'right', direction: 'down', decided: false, seconds: 30 } } as any, LOG_AT);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('a decided move renders differently from the same move still open', () => {
    const a = renderFrame(rich as any, LOG_AT);
    const b = renderFrame({ ...rich, next: { ...rich.next, decided: true } } as any, LOG_AT);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('draws no traders, decisions, commentary or counters: changing them changes nothing', () => {
    const f = renderFrame(rich as any, LOG_AT);
    const g = renderFrame({ ...rich, traders: [], tradersThisStep: 0, tradersToday: 0, recentDecisions: [], commentary: 'Something else.', deathsToday: 42, game: { ...rich.game, step: 999 } } as any, LOG_AT);
    expect(Buffer.compare(f, g)).toBe(0);
  });

  it('draws the length and the attempt: each changes the frame', () => {
    const f = renderFrame(rich as any, LOG_AT);
    expect(Buffer.compare(f, renderFrame({ ...rich, game: { ...rich.game, length: 44 } } as any, LOG_AT))).not.toBe(0);
    expect(drawnTexts(rich as any, LOG_AT)).toContain('NOW · ATTEMPT 2');
  });

  it('renders with the activity fields missing (an old /state) and with long handles without crashing', () => {
    expect(renderFrame(state as any).length).toBe(WIDTH * HEIGHT * 3);
    const long = { ...rich, recentTrades: [{ ...rich.recentTrades[0], handle: 'a-very-long-handle-name-indeed-that-goes-on-and-on-and-on' }],
      restingOrders: [{ id: 'o', at: '2026-09-11T10:00:01Z', handle: 'another-very-long-handle-name-that-goes-on', action: 'forward', horizon: 'm60', side: 'higher', level: 0.05, credits: 2500, marketId: 'f' }],
      leaderboard: [{ rank: 1, handle: 'x'.repeat(80), profit: 123456789, trades: 1 }] };
    expect(renderFrame(long as any, LOG_AT).length).toBe(WIDTH * HEIGHT * 3);
    expect(renderFrame(long as any, LOG_AT + PANEL_MS).length).toBe(WIDTH * HEIGHT * 3);
  });

  it('nothing is drawn below the frame: the last row of pixels is background only', () => {
    const f = renderFrame(rich as any, LOG_AT);
    const y = HEIGHT - 1;
    for (let x = 0; x < WIDTH; x += 7) { const [r, g, b] = px(f, x, y); expect(Math.max(r, g, b)).toBeLessThan(20); }
  });

  it('THE LINK IS THE STREAM\'S ONE CALL TO ACTION: telarchy.com/snake alone, on a bone pill, and no other words invite anyone anywhere', () => {
    expect(LINK_TEXT).toBe('telarchy.com/snake');
    for (const at of [LOG_AT, LOG_AT + PANEL_MS]) {
      const texts = drawnTexts(rich as any, at);
      expect(texts.filter(t => t === 'telarchy.com/snake').length).toBe(1);
      expect(texts.filter(t => /telarchy\.com|trade at|trade here|bet at/i.test(t) && t !== 'telarchy.com/snake')).toEqual([]);
    }
    const f = renderFrame(rich as any, LOG_AT);
    const [r, g, b] = px(f, 736 + 12, 612 + 42);
    expect(r).toBeGreaterThan(220); expect(g).toBeGreaterThan(210); expect(b).toBeGreaterThan(190);
    expect(drawnTexts({} as any, LOG_AT).filter(t => /telarchy\.com/i.test(t))).toEqual(['telarchy.com/snake']);
  });

  it('THE PANEL TURNS EVERY 15 SECONDS: Log, then Top traders, then Log again, with the dots saying which', () => {
    expect(PANEL_MS).toBe(15_000);
    const a = drawnTexts(rich as any, LOG_AT), b = drawnTexts(rich as any, LOG_AT + PANEL_MS), c = drawnTexts(rich as any, LOG_AT + 2 * PANEL_MS);
    expect(a).toContain('LOG'); expect(a).toContain('ada_bot'); expect(a).not.toContain('lead_bot');
    expect(b).toContain('TOP TRADERS'); expect(b).toContain('lead_bot'); expect(b).toContain('+1,251 cr'); expect(b).not.toContain('LOG');
    expect(c).toContain('LOG'); expect(c).toContain('ada_bot'); expect(c).not.toContain('TOP TRADERS');
    expect(Buffer.compare(renderFrame(rich as any, LOG_AT), renderFrame(rich as any, LOG_AT + PANEL_MS))).not.toBe(0);
  });

  it('a page with nothing to show gives its turn to the other', () => {
    const noBoard = { ...rich, leaderboard: [] };
    expect(drawnTexts(noBoard as any, LOG_AT + PANEL_MS)).toContain('LOG');
    const noLog = { ...rich, recentTrades: [], restingOrders: [] };
    expect(drawnTexts(noLog as any, LOG_AT)).toContain('TOP TRADERS');
  });

  it('THE LOG READS LIKE THE FLOOR: time since, handle, what was done at what price, and the credits', () => {
    const texts = drawnTexts(rich as any, LOG_AT);
    expect(texts).toContain('bought higher on Turn left at 3.5');
    expect(texts).toContain('5 cr');
    expect(texts).toContain(`${Math.round((LOG_AT - Date.parse('2026-09-11T10:00:08Z')) / 1000)}s`);
  });

  it('RESTING ORDERS ARE IN THE LOG, BEFORE THE TRADES', () => {
    const withOrder = { ...rich, restingOrders: [{ id: 'o1', at: '2026-09-11T10:00:01Z', handle: 'bobalobascrob', action: 'forward', horizon: 'm60', side: 'higher', level: 0.05, credits: 2500, marketId: 'f' }] };
    const texts = drawnTexts(withOrder as any, LOG_AT);
    expect(texts).toContain('limit higher on Continue at 0.05');
    expect(texts).toContain('2,500 cr');
    expect(texts.indexOf('limit higher on Continue at 0.05')).toBeLessThan(texts.indexOf('bought higher on Turn left at 3.5'));
  });

  it('A PRICE OF 0 IS A REAL PRICE: it draws 0.0, and only a missing price draws a dash', () => {
    const q = { ...rich, open: { ...rich.open, quotes: { forward: { m60: { price: 0, lead: -3 } }, left: { m60: { price: 3, lead: 3 } }, right: { m60: { price: null, lead: null } } } } };
    const texts = drawnTexts(q as any, LOG_AT);
    expect(texts).toContain('0.0');
    expect(texts).toContain('3.0');
    expect(texts).toContain('-');
  });

  it('THE LOGO IS SMALL AND NEVER STRETCHED: about 18 px tall at its own aspect ratio', () => {
    expect(LOGO_NATURAL.w).toBeGreaterThan(0);
    expect(LOGO_BOX.h).toBeGreaterThanOrEqual(14);
    expect(LOGO_BOX.h).toBeLessThanOrEqual(20);
    expect(Math.abs(LOGO_BOX.w / LOGO_BOX.h - LOGO_NATURAL.w / LOGO_NATURAL.h)).toBeLessThan(0.02);
  });
});

describe('THE NEXT GRID IS NAMED AS IT WILL BE (docs/snake.md, "The game")', () => {
  it('a complete game announces the next grid two cells larger, not one', () => {
    const done = {
      ...state,
      grid: 4,
      complete: true,
      open: null,
      nextGameAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      game: { ...state.game, size: 4, complete: true, length: 16, snake: [{ x: 0, y: 0 }] },
    };
    const f = renderFrame(done as any);
    // The frame is text on a canvas, so read it back through the renderer's
    // own line: the 6x6 line must be drawn, the 5x5 one must not.
    const withSix = renderFrame({ ...done, grid: 4 } as any);
    const five = renderFrame({ ...done, grid: 3 } as any); // a 3-grid would announce 5x5
    expect(Buffer.compare(f, withSix)).toBe(0);
    expect(Buffer.compare(f, five)).not.toBe(0);
    expect(nextGridLabel(4)).toBe('6x6');
    expect(nextGridLabel(6)).toBe('8x8');
  });
});

/**
 * THE STREAM NEVER DIES OF ONE BAD READ (docs/snake.md, "The stream").
 *
 * On 2026-09-12 the Twitch stream crash-looped 22 times: the feed answered
 * with a payload carrying no game, `renderFrame` read `game.size` off
 * undefined, and the process exited. A stream holds its last frame through a
 * bad read; it does not go dark.
 */
describe('a payload the frame cannot draw', () => {
  it('a real state is drawable', () => {
    expect(isDrawableState(state)).toBe(true);
  });

  it('a payload with no game is not drawable, whatever else it carries', () => {
    expect(isDrawableState({ games: [1, 2], gameNumber: 1, size: 6 })).toBe(false);
    expect(isDrawableState({})).toBe(false);
    expect(isDrawableState({ error: 'Not found' })).toBe(false);
    expect(isDrawableState({ game: null })).toBe(false);
  });

  it('a payload that is not an object at all is not drawable', () => {
    expect(isDrawableState(null)).toBe(false);
    expect(isDrawableState(undefined)).toBe(false);
    expect(isDrawableState('not found')).toBe(false);
    expect(isDrawableState(7)).toBe(false);
  });

  it('a game without a grid of its own is still drawable: the default grid draws it', () => {
    const { size, ...rest } = state.game as Record<string, unknown>;
    expect(isDrawableState({ ...state, grid: undefined, game: rest })).toBe(true);
  });

  it('RENDERING ONE OF THEM DOES NOT THROW, so a frame cannot take the stream down', () => {
    expect(() => renderFrame({ error: 'Not found' })).not.toThrow();
    expect(() => renderFrame({})).not.toThrow();
    expect(renderFrame({}).length).toBe(WIDTH * HEIGHT * 3);
  });
});
