// The stream frame, docs/snake.md "The stream": Telarchy's floor in its dark
// theme, drawn in-process with @napi-rs/canvas, no browser. Text is set in
// Inter, Fraunces and JetBrains Mono, bundled under fonts/ (OFL) and
// registered here; the logo is bundled under assets/. Nothing is read from the
// system or the network.
import { type Canvas, createCanvas, GlobalFonts, Image, type SKRSContext2D } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRID } from './engine.js';
import { decide, priceOf, ACTIONS, type Quotes } from './decide.js';

export const WIDTH = 1280;
export const HEIGHT = 720;
/** The body face. */
export const FONT = 'Inter';
/** Every face the frame sets, by role. */
export const FONTS = { sans: 'Inter', serif: 'Fraunces', mono: 'JetBrains Mono' } as const;
type Face = keyof typeof FONTS;
const FONT_FILES = [
  ['Inter-Regular.ttf', FONTS.sans],
  ['Inter-SemiBold.ttf', FONTS.sans],
  ['Fraunces-Medium.ttf', FONTS.serif],
  ['Fraunces-Bold.ttf', FONTS.serif],
  ['JetBrainsMono-Medium.ttf', FONTS.mono],
  ['JetBrainsMono-SemiBold.ttf', FONTS.mono],
] as const;
/** Registers the bundled fonts from `dir`; a font that does not load stops the renderer,
 *  since the canvas would otherwise fall back to a system face without a word. */
export function registerFonts(dir: string): void {
  for (const [file, family] of FONT_FILES) {
    const path = `${dir.replace(/\/+$/, '')}/${file}`;
    if (!existsSync(path) || !GlobalFonts.registerFromPath(path, family)) throw new Error(`font ${file} did not load from ${dir}`);
  }
}
registerFonts(fileURLToPath(new URL('../fonts', import.meta.url)));

/** The Telarchy lockup for dark grounds, drawn small at its own aspect ratio. */
const logo = new Image();
logo.src = readFileSync(fileURLToPath(new URL('../assets/logo-lockup-dark.png', import.meta.url)));
export const logoImage = logo;
export const LOGO_NATURAL = { w: logo.naturalWidth || logo.width, h: logo.naturalHeight || logo.height };
const LOGO_H = 18;
export const LOGO_BOX = { w: (LOGO_H * LOGO_NATURAL.w) / LOGO_NATURAL.h, h: LOGO_H };

/** The one call to action (docs/snake.md, "The stream"). */
export const LINK_TEXT = 'telarchy.com/snake';
/** How long each page of the panel stays on. */
export const PANEL_MS = 15_000;

const BG = '#101013';
const BOARD = '#17171c';
const LINE = '#2a2a32';
const STRONG = '#3a3a43';
const SNAKE = '#4ade80';
const FOOD = '#f87171';
const FG = '#f2ecdc';
const FG2 = '#b5b1a3';
const MUTE = '#97938c';
const LEAD = '#f59e0b';
const BONE = '#f2ecdc';
/** The frame's colours, for the fun cuts' overlays (docs/snake.md, "The fun cuts"). */
export const PALETTE = { BG, BOARD, LINE, STRONG, SNAKE, FOOD, FG, FG2, MUTE, LEAD, BONE } as const;

const MARGIN = 24;
const BOARD_PX = HEIGHT - 2 * MARGIN; // 672
const X = MARGIN + BOARD_PX + 40; // 736: the right column
const W = WIDTH - X - MARGIN; // 520
const RIGHT = X + W; // 1256

/** Where a board is drawn: its top-left corner and its side in pixels. */
export interface Box { x: number; y: number; px: number }
/** The stream frame's board. */
export const MAIN_BOX: Box = { x: MARGIN, y: MARGIN, px: BOARD_PX };

export function cellRect(x: number, y: number, size: number = GRID, box: Box = MAIN_BOX) {
  const cell = Math.floor(box.px / size);
  return { x: box.x + x * cell, y: box.y + y * cell, w: cell, h: cell };
}

const measurer = createCanvas(1, 1).getContext('2d');
const font = (size: number, weight: number, face: Face) => `${weight} ${size}px "${FONTS[face]}"`;
/** Width in pixels of `s` set at `size` px in `face` (Inter semibold unless told otherwise). */
export function measureText(s: string, size: number, weight = 600, face: Face = 'sans'): number {
  if (s.length === 0) return 0;
  measurer.font = font(size, weight, face);
  return measurer.measureText(s).width;
}

/** Cut `s` with a trailing ellipsis so it fits `w` px. */
function clip(s: string, size: number, w: number, weight: number, face: Face): string {
  if (measureText(s, size, weight, face) <= w) return s;
  let t = s;
  while (t.length > 1 && measureText(`${t}…`, size, weight, face) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** One decimal, `-` only when there is no number at all (docs/snake.md, "The stream", item 4). */
const one = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(1));
/** A limit level: up to two decimals, trailing zeros dropped. */
const level = (v: number) => String(Math.round(v * 100) / 100);
const credits = (v: number) => `${Math.round(v).toLocaleString('en-US')} cr`;
const ARROW: Record<string, string> = { up: '↑', right: '→', down: '↓', left: '←' };
/** The options' words, on the pills and in the log. */
export const NEXT_LABEL: Record<string, string> = { forward: 'Continue', left: 'Turn left', right: 'Turn right' };
const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
/** The stream's one clock for how long something has run (docs/snake.md, "The stream"): mm:ss under an hour, then `3h 22m`. */
export function span(ms: number): string {
  const secs = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (secs < 3600) return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}
/** Where the column's blocks sit, so the timers never crowd the pills, the panel or the link. */
export const LAYOUT = { statsTop: 164, statsBottom: 262, statSize: 36, levelBaseline: 290, pillTop: 304, pillHeight: 46, panelLabelBaseline: 384, rowsTop: 394, rowHeight: 38, linkTop: 612, completeBaseline: 326 } as const;
const ago = (at: string, now: number) => {
  const secs = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(secs)) return '';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
};
const DELTA: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** The grid the next game is played on: two cells larger, so every grid keeps
 *  an even number of cells (docs/snake.md, "The game"). */
export function nextGridLabel(n: number): string {
  return `${n + 2}x${n + 2}`;
}

/**
 * Can this payload be drawn (docs/snake.md, "The stream")?
 *
 * The feed answers other shapes on other paths, and a read can come back as
 * an error object. A stream that renders one of those reads `game.size` off
 * undefined and the process exits, which took the Twitch stream down 22 times
 * on 2026-09-12. Everything the frame needs hangs off `game`, so that is the
 * one thing checked, and the caller holds its last good frame instead.
 */
export function isDrawableState(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const g = (s as { game?: unknown }).game;
  return !!g && typeof g === 'object';
}

/** Which page of the panel is on at `now`: Log and Top traders take turns of
 *  PANEL_MS, and a page with nothing to show gives its turn to the other. */
export function panelFor(now: number, s: any): 'log' | 'traders' {
  const hasLog = (Array.isArray(s?.restingOrders) ? s.restingOrders.length : 0) + (Array.isArray(s?.recentTrades) ? s.recentTrades.length : 0) > 0;
  const hasBoard = Array.isArray(s?.leaderboard) && s.leaderboard.length > 0;
  const page = Math.floor(now / PANEL_MS) % 2 === 0 ? 'log' : 'traders';
  if (page === 'log' && !hasLog && hasBoard) return 'traders';
  if (page === 'traders' && !hasBoard) return 'log';
  return page;
}

interface Pill { action: string; x: number; y: number; w: number; h: number; size: number; label: string; price: string; lead: boolean }
const PILL_Y = LAYOUT.pillTop;
const PILL_H = LAYOUT.pillHeight;

function pills(s: any): Pill[] {
  if (!s?.open || !s?.game) return [];
  const quotes = (s.open.quotes ?? {}) as Quotes;
  // A level video outlines the option the market chose, whatever the prices
  // say (docs/snake.md, "The level videos"); the stream outlines the leader.
  const best = s.video ? s.video.chosen : decide(quotes, s.game.heading).approved;
  const parts = ACTIONS.map(a => {
    const dir = s.open.directions?.[a];
    return { action: a, label: `${dir ? `${ARROW[dir] ?? ''} ` : ''}${NEXT_LABEL[a]}`, price: one(priceOf(quotes[a])), lead: s.video ? a === best : a === best && priceOf(quotes[a]) !== null };
  });
  const gap = 10, pad = 16, inner = 8;
  let size = 18;
  const widthAt = (sz: number) => parts.map(p => pad + measureText(p.label, sz, 500, 'sans') + inner + measureText(p.price, sz, 500, 'mono') + pad);
  while (size > 12 && widthAt(size).reduce((a, b) => a + b, 0) + gap * (parts.length - 1) > W) size -= 1;
  const widths = widthAt(size);
  let x = X;
  return parts.map((p, i) => {
    const pill = { ...p, x, y: PILL_Y, w: widths[i], h: PILL_H, size };
    x += widths[i] + gap;
    return pill;
  });
}

/** Where the three option pills are drawn: each inside the right column. */
export function pillRects(s: any): Array<{ x: number; y: number; w: number; h: number }> {
  return pills(s).map(({ x, y, w, h }) => ({ x, y, w, h }));
}

/** The chevron (or, at a wall, the bar) for the next direction, in the accent. */
function drawArrow(ctx: SKRSContext2D, head: { x: number; y: number }, N: number, next: { direction: string; decided: boolean }, box: Box = MAIN_BOX) {
  const [dx, dy] = DELTA[next.direction] ?? DELTA.right;
  const CELL = Math.floor(box.px / N);
  const ax = head.x + dx, ay = head.y + dy;
  const wall = ax < 0 || ay < 0 || ax >= N || ay >= N;
  const h = cellRect(head.x, head.y, N, box);
  const hx = h.x + h.w / 2, hy = h.y + h.h / 2;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const stroke = Math.max(2, CELL * 0.1);
  const [px, py] = [-dy, dx];
  if (wall) {
    // Flush inside the border: the band reaches 0.39 of a cell from its
    // centre, so the bar sits in the cell's outer strip, clear of the snake.
    const off = CELL * 0.5 - stroke / 2;
    const halfBar = CELL * 0.34;
    const cx = hx + dx * off, cy = hy + dy * off;
    ctx.beginPath();
    ctx.moveTo(cx + px * halfBar, cy + py * halfBar);
    ctx.lineTo(cx - px * halfBar, cy - py * halfBar);
  } else {
    const r = cellRect(ax, ay, N, box);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, half = CELL * 0.15, arm = CELL * 0.22;
    ctx.beginPath();
    ctx.moveTo(cx - dx * half + px * arm, cy - dy * half + py * arm);
    ctx.lineTo(cx + dx * half, cy + dy * half);
    ctx.lineTo(cx - dx * half - px * arm, cy - dy * half - py * arm);
  }
  ctx.globalAlpha = next.decided ? 1 : 0.7;
  ctx.strokeStyle = LEAD; ctx.lineWidth = stroke; ctx.stroke();
  ctx.restore();
}

export function drawBoard(ctx: SKRSContext2D, g: any, N: number, next: { direction: string; decided: boolean } | null, box: Box = MAIN_BOX) {
  const CELL = Math.floor(box.px / N);
  const size = CELL * N;
  ctx.fillStyle = BOARD;
  roundRect(ctx, box.x, box.y, size, size, 6);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  for (let i = 1; i < N; i++) {
    ctx.beginPath(); ctx.moveTo(box.x + i * CELL + 0.5, box.y); ctx.lineTo(box.x + i * CELL + 0.5, box.y + size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(box.x, box.y + i * CELL + 0.5); ctx.lineTo(box.x + size, box.y + i * CELL + 0.5); ctx.stroke();
  }
  roundRect(ctx, box.x + 0.5, box.y + 0.5, size - 1, size - 1, 6);
  ctx.stroke();
  const centre = (c: { x: number; y: number }) => { const r = cellRect(c.x, c.y, N, box); return [r.x + r.w / 2, r.y + r.h / 2] as const; };
  if (g.food) {
    const [fx, fy] = centre(g.food);
    ctx.fillStyle = FOOD;
    ctx.beginPath(); ctx.arc(fx, fy, CELL * 0.28, 0, Math.PI * 2); ctx.fill();
  }
  const snake: { x: number; y: number }[] = Array.isArray(g.snake) ? g.snake : [];
  const band = CELL * 0.78;
  if (snake.length > 1) {
    ctx.strokeStyle = SNAKE;
    ctx.lineWidth = band;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    snake.forEach((c, i) => { const [x, y] = centre(c); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
  }
  if (snake[0]) {
    const [cx, cy] = centre(snake[0]);
    ctx.fillStyle = SNAKE;
    ctx.beginPath(); ctx.arc(cx, cy, band / 2, 0, Math.PI * 2); ctx.fill();
    // the heading: two eyes in the board's ground on the side the snake moves towards
    const off = CELL * 0.17, side = CELL * 0.15, er = Math.max(1.5, CELL * 0.07);
    const eyes: [number, number][] = g.heading === 'up' ? [[cx - side, cy - off], [cx + side, cy - off]]
      : g.heading === 'down' ? [[cx - side, cy + off], [cx + side, cy + off]]
      : g.heading === 'left' ? [[cx - off, cy - side], [cx - off, cy + side]]
      : [[cx + off, cy - side], [cx + off, cy + side]];
    ctx.fillStyle = BOARD;
    for (const [ex, ey] of eyes) { ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill(); }
    if (next) drawArrow(ctx, snake[0], N, next, box);
  }
}

/** Draws the frame; every string it sets is pushed onto `texts` in order. */
/** One canvas for every frame: a fresh native canvas per frame piles up memory the
 *  garbage collector never sees, and a level video render was killed for it
 *  (2026-09-14). Every draw paints the whole frame, so nothing carries over. */
let frameCanvas: Canvas | null = null;
function draw(s: any, now: number, texts: string[]): Canvas {
  const canvas = (frameCanvas ??= createCanvas(WIDTH, HEIGHT));
  const ctx = canvas.getContext('2d');
  const text = (str: string, x: number, y: number, size: number, colour: string, weight: number, face: Face, align: 'left' | 'right' | 'center' = 'left', spacing = '0px') => {
    if (!str) return;
    texts.push(str);
    ctx.font = font(size, weight, face);
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = spacing;
    ctx.fillText(str, x, y);
    ctx.letterSpacing = '0px';
  };
  const hairline = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.strokeStyle = LINE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0 + 0.5); ctx.lineTo(x1 + 0.5, y1 + 0.5); ctx.stroke();
  };
  const label = (str: string, x: number, y: number, maxW: number) =>
    text(clip(str.toUpperCase(), 13, maxW, 500, 'mono'), x, y, 13, MUTE, 500, 'mono', 'left', '1px');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // the link, the frame's one call to action, first so it is there whatever else fails to draw
  const drawLink = () => {
    ctx.fillStyle = BONE;
    roundRect(ctx, X, LAYOUT.linkTop, W, 84, 42); ctx.fill();
    text(LINK_TEXT, X + W / 2, 668, 40, BG, 600, 'sans', 'center');
  };

  if (!isDrawableState(s)) {
    text('Waiting for the feed', X, 120, 34, MUTE, 600, 'sans');
    drawLink();
    return canvas;
  }

  const g = s.game;
  const N: number = s.grid ?? g.size ?? GRID;
  const dirs = ['up', 'down', 'left', 'right'];
  const next = s.next ?? null;
  const nextDir = next && dirs.includes(next.direction) ? next.direction : g.heading;
  // A level video's last frame has no next move, so it draws no chevron (docs/snake.md, "The level videos").
  const noNext = s.video && (!next || s.video.hideChevron === true);
  drawBoard(ctx, g, N, !noNext && dirs.includes(nextDir) ? { direction: nextDir, decided: next?.decided === true } : null);

  // 1. the lockup, small and at its own aspect ratio
  if (LOGO_NATURAL.w > 0) ctx.drawImage(logo, X, 28, LOGO_BOX.w, LOGO_BOX.h);

  // 2. the name and the question
  text('Snake', X, 108, 44, FG, 700, 'serif');
  // a level video says what is playing (docs/snake.md, "The fun cuts")
  text(s.video ? 'Traders bet on every move. The highest price wins.' : 'What length will I reach on this attempt?', X, 140, s.video ? 20 : 22, FG2, 500, 'serif');

  // 3. three cells between hairlines: length, this attempt's time, the next move
  const third = W / 3;
  const cellX = (i: number) => X + i * third + (i === 0 ? 0 : 16);
  hairline(X, LAYOUT.statsTop, RIGHT, LAYOUT.statsTop);
  hairline(X, LAYOUT.statsBottom, RIGHT, LAYOUT.statsBottom);
  hairline(X + third, LAYOUT.statsTop, X + third, LAYOUT.statsBottom);
  hairline(X + 2 * third, LAYOUT.statsTop, X + 2 * third, LAYOUT.statsBottom);
  const valueY = 240;
  const attempt = Number.isFinite(s.attempt) ? s.attempt : (Number.isFinite(g.deaths) ? g.deaths + 1 : null);
  label(attempt === null ? 'Now' : `Now · attempt ${attempt}`, cellX(0), 190, third - 16);
  text(Number.isFinite(g.length) ? Number(g.length).toFixed(1) : '-', cellX(0), valueY, LAYOUT.statSize, FG, 600, 'mono');
  label('This attempt', cellX(1), 190, third - 20);
  const attemptAt = typeof s.attemptStartedAt === 'string' ? Date.parse(s.attemptStartedAt) : NaN;
  text(Number.isFinite(attemptAt) ? span(now - attemptAt) : '-', cellX(1), valueY, LAYOUT.statSize, FG, 600, 'mono');
  label(next && ARROW[next.direction] ? `Next move ${ARROW[next.direction]}` : 'Next move', cellX(2), 190, third - 20);
  const secs: number | null = s.secondsToDecision ?? next?.seconds ?? null;
  if (s.video?.undecided) text('undecided', cellX(2), valueY - 4, 26, MUTE, 600, 'mono');
  else if (next?.decided) text('decided', cellX(2), valueY - 4, 26, SNAKE, 600, 'mono');
  else if (secs !== null && Number.isFinite(secs)) text(clock(Math.max(0, Math.round(secs))), cellX(2), valueY, LAYOUT.statSize, LEAD, 600, 'mono');
  else text('-', cellX(2), valueY, LAYOUT.statSize, MUTE, 600, 'mono');

  // the levels: the current game's time, then each earlier game and how long it took
  const levels: any[] = Array.isArray(s.levels) ? s.levels : [];
  const gameNo = s.gameNumber ?? g.gameNumber ?? 1;
  const current = levels.find(l => l && l.number === gameNo);
  const took = (l: any) => {
    const a = Date.parse(l?.startedAt), b = l?.endedAt ? Date.parse(l.endedAt) : now;
    return Number.isFinite(a) && Number.isFinite(b) ? span(b - a) : '-';
  };
  const size = current?.size ?? N;
  let lx = X;
  const levelLabel = `Level ${size}x${size}`.toUpperCase();
  text(levelLabel, lx, LAYOUT.levelBaseline, 13, MUTE, 500, 'mono', 'left', '1px');
  lx += measureText(levelLabel, 13, 500, 'mono') + levelLabel.length + 10;
  const currentTook = current ? took(current) : '-';
  text(currentTook, lx, LAYOUT.levelBaseline, 14, FG, 600, 'mono');
  lx += measureText(currentTook, 14, 600, 'mono') + 22;
  const earlier = levels.filter(l => l && l.number !== gameNo && l.endedAt).sort((a, b) => b.number - a.number);
  for (const l of earlier) {
    const seg = `${l.size}x${l.size} ${took(l)}`;
    const w = measureText(seg, 14, 500, 'mono');
    if (lx + w > RIGHT) break;
    text(seg, lx, LAYOUT.levelBaseline, 14, FG2, 500, 'mono');
    lx += w + 22;
  }

  // 4. the options as pills, or the complete game's two lines
  if (s.open) {
    for (const p of pills(s)) {
      ctx.strokeStyle = p.lead ? SNAKE : STRONG;
      ctx.lineWidth = 1.5;
      roundRect(ctx, p.x + 0.75, p.y + 0.75, p.w - 1.5, p.h - 1.5, p.h / 2);
      ctx.stroke();
      const base = p.y + p.h / 2 + p.size * 0.36;
      text(p.label, p.x + 16, base, p.size, p.lead ? SNAKE : FG, 500, 'sans');
      text(p.price, p.x + p.w - 16, base, p.size, p.lead ? SNAKE : FG2, 500, 'mono', 'right');
    }
  } else if (s.complete) {
    text('The snake filled the grid.', X, LAYOUT.completeBaseline, 20, FG, 500, 'sans');
    if (s.video?.facts) text(s.video.facts, X, LAYOUT.completeBaseline + 28, 20, FG2, 400, 'sans');
    else if (s.nextGameAt) {
      const m = Math.max(0, Math.round((Date.parse(s.nextGameAt) - Date.now()) / 60_000));
      text(`Next game on ${nextGridLabel(N)} in ${m} min.`, X, LAYOUT.completeBaseline + 28, 20, FG2, 400, 'sans');
    }
  }

  // 5. the panel: Log or Top traders, with the dots saying which
  // A level video's panel is one page, this move's trades, with no dots; its
  // last frame has no following move and so no panel.
  const page = s.video ? 'log' : panelFor(now, s);
  if (!(s.video && !s.open)) {
  label(s.video ? 'Trades on this move' : page === 'log' ? 'Log' : 'Top traders', X, LAYOUT.panelLabelBaseline, W - 40);
  if (!s.video) [0, 1].forEach(i => {
    ctx.fillStyle = (page === 'log' ? 0 : 1) === i ? FG : STRONG;
    ctx.beginPath(); ctx.arc(RIGHT - 19 + i * 15, LAYOUT.panelLabelBaseline - 5, 4, 0, Math.PI * 2); ctx.fill();
  });
  const rowTop = (i: number) => LAYOUT.rowsTop + i * LAYOUT.rowHeight;
  if (page === 'log') {
    const orders: any[] = Array.isArray(s.restingOrders) ? s.restingOrders : [];
    const trades: any[] = Array.isArray(s.recentTrades) ? s.recentTrades : [];
    const rows: Array<{ at?: string; age?: string; handle: string; what: string; cr: string; colour: string }> = s.video
      ? (Array.isArray(s.video.rows) ? s.video.rows : []).slice(0, 5).map((r: any) => ({ ...r, colour: FG }))
      : [
      ...orders.map(o => ({ at: String(o.at), handle: String(o.handle ?? '?'), what: `limit ${o.side === 'lower' ? 'lower' : 'higher'} on ${NEXT_LABEL[o.action] ?? o.action} at ${level(Number(o.level))}`, cr: credits(Number(o.credits) || 0), colour: LEAD })),
      ...trades.map(t => ({ at: String(t.at), handle: String(t.handle ?? '?'), what: `${t.kind === 'sell' ? 'sold' : 'bought'} ${t.side === 'lower' ? 'lower' : 'higher'} on ${NEXT_LABEL[t.action] ?? t.action} at ${one(t.price)}`, cr: credits(Math.abs(Number(t.cost) || 0)), colour: FG })),
    ].slice(0, 5);
    if (s.video && rows.length === 0) text('No trades on this move', X, rowTop(0) + 26, 15, MUTE, 400, 'sans');
    rows.forEach((r, i) => {
      const top = rowTop(i), base = top + 26;
      hairline(X, top, RIGHT, top);
      text(r.age ?? ago(String(r.at), now), X, base, 14, MUTE, 500, 'mono');
      const crW = measureText(r.cr, 16, 500, 'mono');
      text(r.cr, RIGHT, base, 16, r.colour, 500, 'mono', 'right');
      const handle = clip(r.handle, 17, 124, 600, 'sans');
      text(handle, X + 36, base, 17, FG, 600, 'sans');
      const whatX = X + 36 + measureText(handle, 17, 600, 'sans') + 8;
      text(clip(r.what, 15, Math.max(20, RIGHT - crW - 10 - whatX), 400, 'sans'), whatX, base, 15, FG2, 400, 'sans');
    });
  } else {
    const board: any[] = Array.isArray(s.leaderboard) ? s.leaderboard.slice(0, 5) : [];
    board.forEach((r, i) => {
      const top = rowTop(i), base = top + 26;
      hairline(X, top, RIGHT, top);
      text(String(r.rank ?? i + 1), X, base, 15, MUTE, 500, 'mono');
      const profit = Number(r.profit) || 0;
      const amount = `${profit >= 0 ? '+' : '-'}${credits(Math.abs(profit))}`;
      const amountW = measureText(amount, 18, 500, 'mono');
      text(amount, RIGHT, base, 18, profit >= 0 ? SNAKE : FOOD, 500, 'mono', 'right');
      text(clip(String(r.handle ?? '?'), 19, RIGHT - amountW - 16 - (X + 34), 500, 'sans'), X + 34, base, 19, FG, 500, 'sans');
    });
  }

  }

  // 6. the link
  drawLink();
  return canvas;
}

/** The stream frame as a canvas, for the fun cuts to draw on (docs/snake.md, "The fun cuts"). */
export const drawFrame = draw;

/** The RGB bytes ffmpeg takes, out of the canvas. */
function toRgb(canvas: Canvas): Buffer {
  const rgba = canvas.data();
  const out = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) { out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; }
  return out;
}

/** The frame at `now`, as the raw RGB bytes the stream pipes to ffmpeg. */
export function renderFrame(s: any, now: number = Date.now()): Buffer {
  return toRgb(draw(s, now, []));
}

/** Every string the frame at `now` sets, in the order it sets them (for the tests' scans). */
export function drawnTexts(s: any, now: number = Date.now()): string[] {
  const texts: string[] = [];
  draw(s, now, texts);
  return texts;
}
