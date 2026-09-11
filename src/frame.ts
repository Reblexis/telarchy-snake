// The stream frame, docs/snake.md "The stream": the board's first screen
// drawn in-process with @napi-rs/canvas, no browser. Text is set in Inter,
// bundled under fonts/ (OFL) and registered here, never a system font.
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { GRID } from './engine.js';
import { decide, priceOf, ACTIONS, ACTION_TITLE, type Quotes } from './decide.js';

export const WIDTH = 1280;
export const HEIGHT = 720;

/** The face every line is set in; the file ships in the repo. */
export const FONT = 'Inter';
for (const file of ['Inter-Regular.ttf', 'Inter-SemiBold.ttf']) {
  GlobalFonts.registerFromPath(fileURLToPath(new URL(`../fonts/${file}`, import.meta.url)), FONT);
}

const BG = '#0b0d10';
const BOARD = '#111419';
const GRIDLINE = '#1a1e25';
const SNAKE = '#4ade80';
const HEAD = '#bbf7d0';
const HEAD_GLOW = 'rgba(74, 222, 128, 0.35)';
const EYE = '#0b0d10';
const FOOD = '#f87171';
const FG = '#e8e6e1';
const MUTE = '#8b8f98';
const LEAD = '#facc15';
const TILE = '#15181e';
const TILE_LEAD = '#2a2612';

const MARGIN = 24;
const BOARD_PX = HEIGHT - 2 * MARGIN; // 672
const X = MARGIN + BOARD_PX + 40; // 736: the right column
const W = WIDTH - X - MARGIN; // 520

export function cellRect(x: number, y: number, size: number = GRID) {
  const cell = Math.floor(BOARD_PX / size);
  return { x: MARGIN + x * cell, y: MARGIN + y * cell, w: cell, h: cell };
}

const measurer = createCanvas(1, 1).getContext('2d');
const font = (size: number, weight: 400 | 600 = 600) => `${weight} ${size}px ${FONT}`;

/** Width in pixels of `s` set at `size` px (semibold unless `weight` says otherwise). */
export function measureText(s: string, size: number, weight: 400 | 600 = 600): number {
  if (s.length === 0) return 0;
  measurer.font = font(size, weight);
  return measurer.measureText(s).width;
}

function text(ctx: SKRSContext2D, s: string, x: number, y: number, size: number, colour: string, weight: 400 | 600 = 600, align: 'left' | 'right' | 'center' = 'left') {
  ctx.font = font(size, weight);
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

/** Cut `s` with an ellipsis so it fits `w` px at `size`. */
function clip(s: string, size: number, w: number, weight: 400 | 600 = 600): string {
  if (measureText(s, size, weight) <= w) return s;
  let t = s;
  while (t.length > 1 && measureText(t + '…', size, weight) > w) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** Word-wrap `s` to at most `lines` lines of `w` px, the last one clipped. */
function wrap(s: string, size: number, w: number, lines: number, weight: 400 | 600 = 400): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const cand = line ? `${line} ${word}` : word;
    if (line && measureText(cand, size, weight) > w) {
      out.push(line);
      line = word;
      if (out.length === lines) break;
    } else line = cand;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && out.length > 0) out[lines - 1] = clip(out[lines - 1] + (line && out[lines - 1] !== line ? ' ' + line : ''), size, w, weight);
  return out;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '-' : (Math.round(v * 10) / 10).toString());
const signed = (v: number | null) => (v === null ? '-' : `${v >= 0 ? '+' : ''}${fmt(v)}`);
const ARROW: Record<string, string> = { up: '↑', right: '→', down: '↓', left: '←' };
/** The next-move line's action words. */
export const NEXT_LABEL: Record<string, string> = { forward: 'Continue', left: 'Turn left', right: 'Turn right' };
const TILE_LABEL: Record<string, string> = { forward: 'Continue', left: 'Turn left', right: 'Turn right' };
const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

const DELTA: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** A chevron pointing along `dir`, centred on (cx, cy): two arms behind, the tip ahead. */
function chevronPath(ctx: SKRSContext2D, cx: number, cy: number, dir: string, half: number, arm: number) {
  const [dx, dy] = DELTA[dir] ?? DELTA.right;
  const [px, py] = [-dy, dx];
  ctx.beginPath();
  ctx.moveTo(cx - dx * half + px * arm, cy - dy * half + py * arm);
  ctx.lineTo(cx + dx * half, cy + dy * half);
  ctx.lineTo(cx - dx * half - px * arm, cy - dy * half - py * arm);
}

/** The next direction: a chevron in the accent from the head into the cell
 *  ahead (docs/snake.md, "The stream"), faint while the step is open and
 *  solid once decided; pressed against the head's edge, over a halo in the
 *  board's ground, when that cell is a wall. */
function drawArrow(ctx: SKRSContext2D, head: { x: number; y: number }, N: number, next: { direction: string; decided: boolean }) {
  const [dx, dy] = DELTA[next.direction] ?? DELTA.right;
  const CELL = Math.floor(BOARD_PX / N);
  const ax = head.x + dx, ay = head.y + dy;
  const wall = ax < 0 || ay < 0 || ax >= N || ay >= N;
  const h = cellRect(head.x, head.y, N);
  const hx = h.x + h.w / 2, hy = h.y + h.h / 2;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const stroke = Math.max(2, CELL * 0.1);
  if (wall) {
    // A wall has no cell to draw a chevron in, so the mark is a bar along
    // that wall, a stroke in from the border (docs/snake.md, "The board"):
    // it reads as the wall it is and nothing is painted off the grid.
    const [px, py] = [-dy, dx];
    // Flush inside the border: the snake's band reaches 0.36 of a cell from
    // its centre, so a bar any further in would sit on the snake.
    const off = CELL * 0.5 - stroke / 2;
    const halfBar = CELL * 0.34;
    const cx = hx + dx * off, cy = hy + dy * off;
    ctx.beginPath();
    ctx.moveTo(cx + px * halfBar, cy + py * halfBar);
    ctx.lineTo(cx - px * halfBar, cy - py * halfBar);
  } else {
    const r = cellRect(ax, ay, N);
    chevronPath(ctx, r.x + r.w / 2, r.y + r.h / 2, next.direction, CELL * 0.15, CELL * 0.22);
  }
  ctx.globalAlpha = next.decided ? 1 : 0.55;
  ctx.strokeStyle = LEAD; ctx.lineWidth = stroke; ctx.stroke();
  ctx.restore();
}

function drawBoard(ctx: SKRSContext2D, g: any, N: number, next: { direction: string; decided: boolean } | null) {
  const CELL = Math.floor(BOARD_PX / N);
  const size = CELL * N;
  ctx.fillStyle = BOARD;
  roundRect(ctx, MARGIN, MARGIN, size, size, 12);
  ctx.fill();
  ctx.strokeStyle = GRIDLINE;
  ctx.lineWidth = 1;
  for (let i = 1; i < N; i++) {
    ctx.beginPath(); ctx.moveTo(MARGIN + i * CELL + 0.5, MARGIN); ctx.lineTo(MARGIN + i * CELL + 0.5, MARGIN + size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(MARGIN, MARGIN + i * CELL + 0.5); ctx.lineTo(MARGIN + size, MARGIN + i * CELL + 0.5); ctx.stroke();
  }
  // food: a rounded red dot
  const fr = cellRect(g.food.x, g.food.y, N);
  ctx.fillStyle = FOOD;
  ctx.beginPath(); ctx.arc(fr.x + fr.w / 2, fr.y + fr.h / 2, fr.w * 0.3, 0, Math.PI * 2); ctx.fill();
  // snake: one rounded band through the cell centres, the head lighter with a glow
  const pad = Math.max(2, Math.round(CELL * 0.08));
  const radius = Math.max(3, Math.round(CELL * 0.22));
  const snake: { x: number; y: number }[] = g.snake ?? [];
  const centre = (c: { x: number; y: number }) => { const r = cellRect(c.x, c.y, N); return [r.x + r.w / 2, r.y + r.h / 2] as const; };
  if (snake.length > 1) {
    ctx.strokeStyle = SNAKE;
    ctx.lineWidth = CELL - 2 * pad;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    snake.forEach((c, i) => { const [x, y] = centre(c); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
  } else if (snake.length === 1) {
    const r = cellRect(snake[0].x, snake[0].y, N);
    ctx.fillStyle = SNAKE;
    roundRect(ctx, r.x + pad, r.y + pad, r.w - 2 * pad, r.h - 2 * pad, radius); ctx.fill();
  }
  if (snake[0]) {
    const r = cellRect(snake[0].x, snake[0].y, N);
    ctx.save();
    ctx.shadowColor = HEAD_GLOW; ctx.shadowBlur = CELL * 0.6;
    ctx.fillStyle = HEAD;
    roundRect(ctx, r.x + pad, r.y + pad, r.w - 2 * pad, r.h - 2 * pad, radius); ctx.fill();
    ctx.restore();
  }
  // the heading: two eyes on the side of the head the snake moves towards
  if (snake[0]) {
    const h = cellRect(snake[0].x, snake[0].y, N);
    const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    const off = h.w * 0.22, side = h.w * 0.16, er = Math.max(1.5, h.w * 0.07);
    const eyes: [number, number][] = g.heading === 'up' ? [[cx - side, cy - off], [cx + side, cy - off]]
      : g.heading === 'down' ? [[cx - side, cy + off], [cx + side, cy + off]]
      : g.heading === 'left' ? [[cx - off, cy - side], [cx - off, cy + side]]
      : [[cx + off, cy - side], [cx + off, cy + side]];
    ctx.fillStyle = EYE;
    for (const [ex, ey] of eyes) { ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill(); }
  }
  if (snake[0] && next) drawArrow(ctx, snake[0], N, next);
}

export function renderFrame(s: any): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const g = s.game;
  const N: number = s.grid ?? g.size ?? GRID;
  const dirs = ['up', 'down', 'left', 'right'];
  const nextDir = s.next && dirs.includes(s.next.direction) ? s.next.direction : g.heading;
  drawBoard(ctx, g, N, dirs.includes(nextDir) ? { direction: nextDir, decided: s.next?.decided === true } : null);

  // 2. the next move, one big line with the clock
  let y = MARGIN + 24;
  text(ctx, 'Next move', X, y, 18, MUTE, 400);
  y += 62;
  const next = s.next ?? null;
  if (next) {
    const label = `${ARROW[next.direction] ?? ''} ${NEXT_LABEL[next.action] ?? '?'}`;
    const secs: number | null = next.decided ? null : (s.secondsToDecision ?? next.seconds ?? null);
    const right = secs === null ? 'decided' : clock(Math.max(0, secs));
    const rightSize = secs === null ? 20 : 48;
    const rw = measureText(right, rightSize, secs === null ? 400 : 600);
    text(ctx, clip(label, 48, W - rw - 16), X, y, 48, next.decided ? SNAKE : LEAD);
    text(ctx, right, X + W, y, rightSize, secs === null ? SNAKE : FG, secs === null ? 400 : 600, 'right');
  } else if (s.complete) {
    text(ctx, 'Complete', X, y, 48, LEAD);
  } else {
    text(ctx, 'Waiting', X, y, 48, MUTE);
  }

  // 3. three choice tiles: arrow, name, price; the leader in the accent with its lead
  y += 40;
  const gap = 12, tw = Math.floor((W - 2 * gap) / 3), th = 150;
  if (s.open) {
    const quotes = (s.open.quotes ?? {}) as Quotes;
    // The leader is the option the rule would choose now (docs/snake.md, "The step").
    const best = decide(quotes, g.heading).approved;
    ACTIONS.forEach((a, i) => {
      const tx = X + i * (tw + gap);
      const lead = a === best;
      ctx.fillStyle = lead ? TILE_LEAD : TILE;
      roundRect(ctx, tx, y, tw, th, 14); ctx.fill();
      if (lead) { ctx.strokeStyle = LEAD; ctx.lineWidth = 2; roundRect(ctx, tx + 1, y + 1, tw - 2, th - 2, 13); ctx.stroke(); }
      const dir = s.open.directions?.[a];
      text(ctx, dir ? ARROW[dir] ?? '' : '', tx + 18, y + 48, 34, lead ? LEAD : FG);
      text(ctx, TILE_LABEL[a], tx + 18, y + 80, 18, lead ? LEAD : MUTE, 400);
      text(ctx, fmt(priceOf(quotes[a])), tx + 18, y + 128, 40, lead ? LEAD : FG);
      // the leader alone shows its lead over the best other option, as Telarchy reports it
      const by = quotes[a]?.m60?.lead;
      if (lead && typeof by === 'number' && Number.isFinite(by)) text(ctx, signed(by), tx + tw - 16, y + 48, 22, LEAD, 600, 'right');
    });
  } else if (s.complete) {
    const lines = ['The snake filled the grid.'];
    if (s.nextGameAt) { const m = Math.max(0, Math.round((Date.parse(s.nextGameAt) - Date.now()) / 60_000)); lines.push(`Next game on ${N + 1}x${N + 1} in ${m} min.`); }
    lines.forEach((l, i) => text(ctx, l, X, y + 40 + i * 30, 22, FG, 400));
  }
  y += th + 48;

  // 4. the status line: four facts
  const gameNo = s.gameNumber ?? g.gameNumber ?? 1;
  const record = typeof s.bestLength === 'number' ? s.bestLength : g.length;
  text(ctx, `Length ${g.length} · Record ${record} · Game ${gameNo} · ${N}x${N}`, X, y, 24, FG, 400);
  y += 44;

  // 5. the quiet line, above the trade line at the foot of the column: the newest trade, else the commentary
  const trades: any[] = Array.isArray(s.recentTrades) ? s.recentTrades : [];
  const t = trades[0];
  const quiet = t
    ? `${t.handle} bet ${fmt(t.cost)} on ${ACTION_TITLE[t.action as keyof typeof ACTION_TITLE] ?? t.action}`
    : String(s.commentary ?? '');
  const lines = wrap(quiet, 20, W, 2);
  const footY = HEIGHT - MARGIN - 6;
  lines.forEach((l, i) => text(ctx, l, X, footY - 44 - (lines.length - 1 - i) * 28, 20, MUTE, 400));
  void y;

  text(ctx, 'Trade at telarchy.com/snake', X, footY, 18, MUTE, 400);

  // RGBA canvas bytes to the RGB the stream pipes into ffmpeg
  const rgba = canvas.data();
  const out = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) { out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; }
  return out;
}
