// Drawing a level video frame, docs/level-video.md "The trades: race bars", "Motion and
// type" and "Structure": the board with a gliding snake, the race bars and chips during a
// beat, the best-so-far bar at speed, captions, record cards, the fill and the credits.
// It draws only what a frame's description (frames.ts) says, and reports the texts and
// layout boxes it drew so the rules can be checked.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { drawBoard, cellRect, measureText, FONTS, logoImage, LOGO_NATURAL, type Box } from './frame.js';
import type { GameEntry, LogStep } from './gamelog.js';
import { betRows, tradesByMove as _unused, type BetRow, type TradeRow } from './level.js';
import { directionsFrom, type Action } from './decide.js';
import { span } from './frame.js';
import type { FrameInfo } from './frames.js';
void _unused;

export const FULL_SIZE = { w: 1920, h: 1080 } as const;
export const SHORT_SIZE = { w: 1080, h: 1920 } as const;

const HUE: Record<Action, string> = { left: '#38bdf8', forward: '#a78bfa', right: '#f472b6' };
const GLYPH: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const DELTA: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const ORDER: Action[] = ['left', 'forward', 'right'];
const BG = '#0b0b0e', FG = '#f2ecdc', MUTE = '#8d897f', CHIP = '#fbbf24', AGAINST = '#a3a8b3', GOLD = '#facc15', RED = '#f87171';
const CONFETTI = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#facc15', '#4ade80'];

type Cell = { x: number; y: number };
type Face = 'sans' | 'mono' | 'serif';
type Rect = { x: number; y: number; w: number; h: number };
/** A drawn text and its box: from the cap height above the baseline to the descent below it. */
export interface DrawnText { text: string; size: number; x: number; y: number; w: number; h: number }
export interface ChipRect extends Rect { text: string; option: Action | null }
export interface Drawn {
  buffer: Buffer;
  texts: DrawnText[];
  rects: {
    board: Rect;
    head: { x: number; y: number };
    caption: Rect | null;
    lanes: Record<Action, Rect> | null;
    chips: ChipRect[];
    chosen: Action | null;
  };
}

/** Everything about a level a frame may draw, computed once. */
export interface Scene {
  game: GameEntry;
  entries: LogStep[];
  size: number;
  /** Per move (by the entry it lands on): its trades as bet rows, oldest first. */
  bets: BetRow[][];
  /** The best length reached up to each entry. */
  best: number[];
  stats: { moves: number; deaths: number; trades: number; traders: number; span: string };
  topTraders: Array<{ handle: string; credits: number }>;
}

export function buildScene(game: GameEntry, _games: GameEntry[], entries: LogStep[], byMove: TradeRow[][]): Scene {
  const bets: BetRow[][] = entries.map((e, i) => (i === 0 ? [] : betRows(byMove[i - 1] ?? [], e)));
  const best: number[] = [];
  let b = 0;
  for (const e of entries) { b = Math.max(b, e.length); best.push(b); }
  const all = byMove.flat();
  const totals = new Map<string, number>();
  for (const t of all) {
    const h = t.actor?.handle ?? '?';
    totals.set(h, (totals.get(h) ?? 0) + Math.abs(Number(t.detail?.cost) || 0));
  }
  return {
    game,
    entries,
    size: game.size,
    bets,
    best,
    stats: {
      moves: entries.length - 1,
      deaths: entries[entries.length - 1]?.deaths ?? 0,
      trades: all.length,
      traders: totals.size,
      span: span(Date.parse(game.endedAt ?? game.startedAt) - Date.parse(game.startedAt)),
    },
    topTraders: [...totals.entries()].map(([handle, credits]) => ({ handle, credits })).sort((x, y) => y.credits - x.credits).slice(0, 5),
  };
}

/** The snake at a fractional position: at a whole position exactly that entry; between two, the head
 *  the fraction of the way to the next entry's head and the body along the earlier entry's cells. */
export function snakeAt(scene: Scene, position: number): Cell[] {
  const last = scene.entries.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(position)));
  const t = position - i;
  if (t <= 1e-9 || i >= last) return scene.entries[i].snake;
  const a = scene.entries[i].snake[0], b = scene.entries[i + 1].snake[0];
  // a respawn is not a glide: the snake jumps to the new attempt
  if (scene.entries[i + 1].deaths > scene.entries[i].deaths) return scene.entries[i].snake;
  const head = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return [head, ...scene.entries[i].snake];
}

/** The way the head faces at a fractional position: gliding from entry i to entry i + 1 the eyes
 *  already have entry i + 1's heading; a respawn is not a glide, so entry i's holds until the jump. */
export function headingAt(scene: Scene, position: number): LogStep['heading'] {
  const last = scene.entries.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(position)));
  const t = position - i;
  if (t <= 1e-9 || i >= last) return scene.entries[i].heading;
  if (scene.entries[i + 1].deaths > scene.entries[i].deaths) return scene.entries[i].heading;
  return scene.entries[i + 1].heading;
}

// ---------------------------------------------------------------------------------------------
// primitives

class Painter {
  readonly texts: DrawnText[] = [];
  constructor(readonly ctx: SKRSContext2D, readonly minSize = 0) {}
  text(s: string, x: number, y: number, size: number, color: string, weight = 700, face: Face = 'sans', align: CanvasTextAlign = 'left') {
    if (!s) return;
    const px = Math.max(this.minSize, size);
    const w = measureText(s, px, weight, face);
    const left = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
    this.texts.push({ text: s, size: px, x: left, y: y - px * 0.8, w, h: px });
    const c = this.ctx;
    c.font = `${weight} ${px}px "${FONTS[face]}"`;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillText(s, x, y);
  }
  round(x: number, y: number, w: number, h: number, r: number, fill: string) {
    const c = this.ctx;
    c.beginPath();
    c.roundRect(x, y, Math.max(0, w), h, Math.max(0, Math.min(r, h / 2, w / 2)));
    c.fillStyle = fill;
    c.fill();
  }
}
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const canvases = new Map<string, Canvas>();
function reusable(name: string, w: number, h: number): Canvas {
  let c = canvases.get(name);
  if (!c) { c = createCanvas(w, h); canvases.set(name, c); }
  return c;
}
function rgb(canvas: Canvas, w: number, h: number): Buffer {
  const rgba = canvas.data();
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) { out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; }
  return out;
}

// ---------------------------------------------------------------------------------------------
// the board

/** The board with the gliding snake, arrows during a beat, the crash burst and the fill's confetti.
 *  Returns the head's centre on screen. The push-in never lets the board leave its box. */
function board(p: Painter, scene: Scene, info: FrameInfo, box: Box): { x: number; y: number } {
  const c = p.ctx;
  const N = scene.size;
  const pos = info.position;
  const i = Math.max(0, Math.min(scene.entries.length - 1, Math.floor(pos)));
  const e = scene.entries[i];
  const snake = snakeAt(scene, pos);
  const headCell = snake[0];
  const hc = cellRect(Math.floor(headCell.x), Math.floor(headCell.y), N, box);
  const cell = hc.w;
  const head = { x: box.x + headCell.x * cell + cell / 2, y: box.y + headCell.y * cell + cell / 2 };
  c.save();
  c.beginPath();
  c.rect(box.x, box.y, box.px, box.px);
  c.clip();
  if (info.zoom > 1) {
    // scale about the head, but no further than keeps every edge within 2 percent of the box
    const worst = Math.max(head.x - box.x, box.x + box.px - head.x, head.y - box.y, box.y + box.px - head.y);
    const z = Math.min(info.zoom, 1 + (box.px * 0.02) / Math.max(1, worst));
    c.translate(head.x, head.y);
    c.scale(z, z);
    c.translate(-head.x, -head.y);
  }
  drawBoard(c, { snake: snake.map(s => ({ x: s.x, y: s.y })), heading: headingAt(scene, pos), food: e.food }, N, null, box);
  if (info.beat) {
    const decided = scene.entries[info.beat.move];
    const before = scene.entries[info.beat.move - 1];
    const dirs = directionsFrom(before.heading);
    const locked = info.beat.phase !== 'chips';
    const chosen = decided && !decided.undecided ? decided.action : null;
    const bh = before.snake[0];
    const h = cellRect(bh.x, bh.y, N, box);
    for (const opt of ORDER) {
      const [dx, dy] = DELTA[dirs[opt]];
      const nx = bh.x + dx, ny = bh.y + dy;
      const inside = nx >= 0 && ny >= 0 && nx < N && ny < N;
      const cx = h.x + h.w / 2 + dx * h.w * (inside ? 0.78 : 0.42), cy = h.y + h.h / 2 + dy * h.h * (inside ? 0.78 : 0.42);
      const a = locked ? (opt === chosen ? 1 : 0.22) : 0.95;
      const r = h.w * (inside ? 0.26 : 0.14);
      c.save();
      c.translate(cx, cy);
      c.rotate(Math.atan2(dy, dx));
      c.beginPath();
      c.moveTo(r, 0); c.lineTo(-r * 0.55, -r * 0.8); c.lineTo(-r * 0.2, 0); c.lineTo(-r * 0.55, r * 0.8); c.closePath();
      c.lineJoin = 'round';
      c.lineWidth = h.w * 0.05;
      c.strokeStyle = rgba(BG, 0.9 * a);
      c.stroke();
      c.fillStyle = rgba(HUE[opt], a);
      c.fill();
      c.restore();
    }
    // a crash lands in red at the end of its move
    if (decided && decided.deaths > before.deaths && info.beat.phase === 'move') {
      c.fillStyle = rgba(RED, 0.35 * (1 - info.beat.progress));
      c.fillRect(box.x, box.y, box.px, box.px);
    }
  }
  if (info.hold?.fx === 'filled') {
    const t = info.hold.progress * 90;
    for (let k = 0; k < 140; k++) {
      const ang = ((k * 137.5) % 360) * (Math.PI / 180);
      const sp = (0.3 + ((k * 7919) % 97) / 97) * (box.px / 40);
      const x = box.x + box.px / 2 + Math.cos(ang) * sp * t;
      const y = box.y + box.px / 2 + Math.sin(ang) * sp * t + 0.12 * t * t;
      if (x < box.x || y < box.y || x > box.x + box.px || y > box.y + box.px) continue;
      c.fillStyle = CONFETTI[k % CONFETTI.length];
      c.fillRect(x, y, box.px / 70, box.px / 44);
    }
  }
  c.restore();
  return head;
}

// ---------------------------------------------------------------------------------------------
// the race bars

function raceBars(p: Painter, scene: Scene, info: FrameInfo, x0: number, cy: number, w: number, lane: number, big: number): { lanes: Record<Action, Rect>; chips: ChipRect[]; chosen: Action | null } {
  const beat = info.beat!;
  const decided = scene.entries[beat.move];
  const before = scene.entries[beat.move - 1];
  const prices = decided.prices;
  const bets = scene.bets[beat.move].filter(b => b.credits >= 1);
  const chosen = !decided.undecided ? decided.action : null;
  const locked = beat.phase !== 'chips';
  const dirs = directionsFrom(before.heading);
  const cells = scene.size * scene.size;
  // the three largest trades, in the order they were made
  const largest = bets.map((b, i) => ({ ...b, i })).sort((a, b) => b.credits - a.credits || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i);
  const counting = locked ? 1 : Math.min(1, (beat.chip + beat.progress) / Math.max(1, largest.length));
  const credits: Record<Action, number> = { left: 0, forward: 0, right: 0 };
  let pot = 0;
  for (const b of bets) { if (b.option) credits[b.option] += b.credits; else pot += b.credits; }
  const creditSize = Math.max(p.minSize, big * 0.32);
  const creditText = (opt: Action) => (credits[opt] > 0 ? `${Math.round(credits[opt]).toLocaleString('en-US')} cr` : '');
  const glyphW = big * 1.1;
  const gap = lane * 0.55, top = cy - (3 * lane + 2 * gap) / 2;
  const numberW = measureText('88.8', big, 800, 'sans');
  const creditW = Math.max(...ORDER.map(o => measureText(creditText(o), creditSize, 700, 'mono')));
  // the credits line goes under the price when a lane is tall enough for both, beside it otherwise
  const stacked = lane + gap >= big * 1.2 + creditSize * 1.05;
  const priceW = big * 0.35 + (stacked ? Math.max(numberW, creditW) : numberW + big * 0.3 + creditW);
  const barX = x0 + glyphW, barW = w - glyphW - priceW;
  const lead = ORDER.reduce((a, b) => ((prices[b] ?? 0) > (prices[a] ?? 0) ? b : a), 'left' as Action);
  const lanes = {} as Record<Action, Rect>;
  const tips = {} as Record<Action, number>;
  ORDER.forEach((opt, k) => {
    const ly = top + k * (lane + gap);
    lanes[opt] = { x: barX, y: ly, w: barW, h: lane };
    const price = (prices[opt] ?? 0) * (0.35 + 0.65 * counting);
    const a = locked ? (opt === chosen ? 1 : 0.28) : opt === lead ? 1 : 0.6;
    p.text(GLYPH[dirs[opt]], x0, ly + lane * 0.76, big, rgba(HUE[opt], a), 800);
    p.round(barX, ly, barW, lane, lane / 2, 'rgba(255,255,255,0.045)');
    const len = price < 1 ? 6 : Math.max(lane, (price / cells) * barW);
    tips[opt] = barX + Math.min(len, barW);
    if (locked && opt === chosen) {
      p.ctx.save();
      p.ctx.shadowColor = HUE[opt];
      p.ctx.shadowBlur = lane * 0.8;
      p.round(barX, ly, Math.min(len, barW), lane, lane / 2, HUE[opt]);
      p.ctx.restore();
    } else {
      p.round(barX, ly, Math.min(len, barW), lane, lane / 2, rgba(HUE[opt], a));
    }
    const priceBase = ly + lane * 0.62;
    p.text((prices[opt] ?? 0) === null ? '-' : price.toFixed(1), x0 + w, priceBase, big, rgba(FG, locked && opt !== chosen ? 0.35 : 1), 800, 'sans', 'right');
    // stacked, the credits line's cap height clears the price's descent; beside, it shares the price's baseline
    if (stacked) p.text(creditText(opt), x0 + w, priceBase + big * 0.2 + creditSize * 0.85, creditSize, rgba(CHIP, a), 700, 'mono', 'right');
    else p.text(creditText(opt), x0 + w - numberW - big * 0.3, priceBase, creditSize, rgba(CHIP, a), 700, 'mono', 'right');
  });
  const lineY = top - big * 0.45;
  const smaller = bets.length - largest.length;
  if (pot > 0) p.text(`POT ${Math.round(pot).toLocaleString('en-US')} cr`, x0, lineY, big * 0.36, MUTE, 700, 'mono');
  if (smaller > 0) p.text(`+${smaller} smaller trade${smaller === 1 ? '' : 's'}`, x0 + w, lineY, big * 0.36, CHIP, 700, 'sans', 'right');

  const chips: ChipRect[] = [];
  if (!locked && beat.chip < largest.length) {
    const b = largest[beat.chip];
    // a trade that lowered its option's price is a bet against it
    const against = Number.isFinite(b.from) && Number.isFinite(b.to) && b.to < b.from;
    const label = `${against ? '−' : '+'}${Math.round(b.credits).toLocaleString('en-US')}`;
    const fill = against ? AGAINST : CHIP;
    const h = lane * 0.86;
    const size = Math.max(p.minSize, h * 0.46);
    const handleSize = Math.max(p.minSize, size * 0.62);
    const cw = measureText(label, size, 800, 'sans') + measureText(b.handle, handleSize, 700, 'mono') + h * 0.9;
    if (b.option) {
      const ly = lanes[b.option].y;
      // the chip travels inside its lane, from the lane's start to the bar's tip
      const eased = 1 - (1 - beat.progress) ** 3;
      const cx = Math.min(barX + (tips[b.option] - barX) * eased, barX + barW - cw);
      const cy2 = ly + (lane - h) / 2;
      p.ctx.save();
      p.ctx.shadowColor = 'rgba(0,0,0,0.6)';
      p.ctx.shadowBlur = 14;
      p.round(cx, cy2, cw, h, h / 2, fill);
      p.ctx.restore();
      p.text(label, cx + h * 0.4, cy2 + h * 0.66, size, BG, 800);
      p.text(b.handle, cx + h * 0.5 + measureText(label, size, 800, 'sans'), cy2 + h * 0.63, handleSize, rgba(BG, 0.8), 700, 'mono');
      chips.push({ text: label, option: b.option, x: cx, y: cy2, w: cw, h });
    } else {
      const cy2 = lineY - h - big * 0.2;
      p.round(x0 + w * 0.3, cy2, cw, h, h / 2, fill);
      p.text(label, x0 + w * 0.3 + h * 0.4, cy2 + h * 0.66, size, BG, 800);
    }
  }
  return { lanes, chips, chosen };
}

function counters(p: Painter, scene: Scene, info: FrameInfo, x: number, y: number, size: number) {
  const e = scene.entries[Math.max(0, Math.min(scene.entries.length - 1, Math.floor(info.position)))];
  const length = String(e.length), deaths = String(e.deaths);
  p.text(length, x, y, size, FG, 800);
  const lw = measureText(length, size, 800, 'sans');
  p.text('LENGTH', x + lw + size * 0.18, y - size * 0.1, size * 0.26, MUTE, 700, 'mono');
  const dx = x + lw + size * 2.3;
  p.text(deaths, dx, y, size, RED, 800);
  const dw = measureText(deaths, size, 800, 'sans');
  p.text('DEATHS', dx + dw + size * 0.18, y - size * 0.1, size * 0.26, MUTE, 700, 'mono');
}

function caption(p: Painter, text: string, x: number, y: number, want: number, w: number): Rect {
  // the caption shrinks to fit its band, never under the frame's smallest size
  let size = want;
  while (size > p.minSize && measureText(text, size, 800, 'sans') > w - size * 1.2) size -= 1;
  const h = want * 1.9;
  p.round(x, y, w, h, size * 0.35, 'rgba(24,24,28,0.95)');
  p.ctx.fillStyle = CHIP;
  p.ctx.fillRect(x, y + h * 0.2, size * 0.14, h * 0.6);
  p.text(text, x + size * 0.6, y + h * 0.5 + size * 0.36, size, FG, 800);
  return { x, y, w, h };
}

function bestSoFar(p: Painter, scene: Scene, info: FrameInfo, x: number, y: number, w: number, big: number) {
  const i = Math.max(0, Math.min(scene.entries.length - 1, Math.floor(info.position)));
  const best = scene.best[i], cells = scene.size * scene.size;
  p.text('BEST SO FAR', x, y, big * 0.5, MUTE, 700, 'mono');
  p.round(x, y + big * 0.5, w, big * 0.66, big * 0.33, 'rgba(255,255,255,0.06)');
  p.round(x, y + big * 0.5, Math.max(big * 0.66, (best / cells) * w), big * 0.66, big * 0.33, GOLD);
  p.text(`${best} of ${cells}`, x, y + big * 2.3, big * 0.93, FG, 800);
  p.text(`attempt ${scene.entries[i].deaths + 1}`, x, y + big * 3.4, big * 0.56, MUTE, 700, 'mono');
}

function lowerThird(p: Painter, text: string, x: number, y: number, size: number) {
  const w = measureText(text, size, 800, 'sans') + size * 1.4, h = size * 1.9;
  p.round(x, y, w, h, size * 0.35, 'rgba(24,24,28,0.95)');
  p.ctx.fillStyle = GOLD;
  p.ctx.fillRect(x, y + h * 0.2, size * 0.14, h * 0.6);
  p.text(text, x + size * 0.6, y + h * 0.64, size, GOLD, 800);
}

function credits(p: Painter, scene: Scene, x: number, y: number, w: number, big: number, vertical: boolean) {
  const s = scene.stats;
  const title = 'The market filled the grid.';
  let titleSize = big * 1.2;
  while (titleSize > p.minSize && measureText(title, titleSize, 800, 'sans') > w) titleSize -= 1;
  p.text(title, x, y, titleSize, FG, 800);
  const stats: Array<[string, string]> = [
    [s.moves.toLocaleString('en-US'), 'MOVES'], [s.deaths.toLocaleString('en-US'), 'DEATHS'],
    [s.trades.toLocaleString('en-US'), 'TRADES'], [String(s.traders), 'TRADERS'], [s.span, 'REAL TIME'],
  ];
  stats.forEach(([v, l], k) => {
    const sx = vertical ? x + (k % 2) * (w / 2) : x + k * (w / 5);
    const sy = vertical ? y + big * 2.4 + Math.floor(k / 2) * big * 2.2 : y + big * 2.6;
    p.text(v, sx, sy, big, FG, 800);
    p.text(l, sx, sy + big * 0.7, big * 0.36, MUTE, 700, 'mono');
  });
  const ty = vertical ? y + big * 8.6 : y + big * 5;
  p.text('TOP TRADERS', x, ty, big * 0.4, MUTE, 700, 'mono');
  scene.topTraders.forEach((t, k) => {
    p.text(t.handle, x, ty + big * (0.9 + k * 0.85), big * 0.56, FG, 700, 'mono');
    p.text(`${Math.round(t.credits).toLocaleString('en-US')} cr`, x + w * (vertical ? 0.62 : 0.4), ty + big * (0.9 + k * 0.85), big * 0.56, CHIP, 800);
  });
  const ly = vertical ? ty + big * 5.2 : ty;
  const lx = vertical ? x : x + w * 0.62;
  if (LOGO_NATURAL.w > 0) p.ctx.drawImage(logoImage, lx, ly - big * 0.2, (big * LOGO_NATURAL.w) / LOGO_NATURAL.h, big);
  p.text('Bet on the next move', lx, ly + big * 1.9, big * 0.8, FG, 800);
  p.text('telarchy.com/snake', lx, ly + big * 2.9, big * 0.8, CHIP, 800);
}

// ---------------------------------------------------------------------------------------------
// the two frames

export function drawFull(scene: Scene, info: FrameInfo): Drawn {
  const { w, h } = FULL_SIZE;
  const canvas = reusable('full', w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const p = new Painter(ctx);
  const box: Box = { x: 60, y: 60, px: 960 };
  const rects: Drawn['rects'] = { board: { x: box.x, y: box.y, w: box.px, h: box.px }, head: { x: 0, y: 0 }, caption: null, lanes: null, chips: [], chosen: null };
  if (info.credits !== null) {
    credits(p, scene, 160, 240, 1600, 72, false);
    return { buffer: rgb(canvas, w, h), texts: p.texts, rects };
  }
  rects.head = board(p, scene, info, box);
  counters(p, scene, info, 1110, 180, 76);
  if (info.beat) {
    const r = raceBars(p, scene, info, 1110, 620, 760, 84, 60);
    rects.lanes = r.lanes;
    rects.chips = r.chips;
    rects.chosen = r.chosen;
  } else if (info.hold?.fx === 'filled') {
    p.ctx.save();
    p.ctx.shadowColor = 'rgba(0,0,0,0.6)';
    p.ctx.shadowBlur = 24;
    p.text('FILLED', box.x + box.px / 2, box.y + box.px / 2 + 40, 120, FG, 800, 'sans', 'center');
    p.ctx.restore();
  } else {
    bestSoFar(p, scene, info, 1110, 560, 760, 60);
  }
  if (info.badge) {
    p.round(1110, 240, 150, 64, 32, 'rgba(255,255,255,0.08)');
    p.text(info.badge, 1185, 285, 38, FG, 800, 'sans', 'center');
  }
  if (info.caption) {
    // the caption never covers the head: at the board's bottom unless the head is low, then at its top
    const low = rects.head.y > box.y + box.px * 0.6;
    const y = low ? box.y + 24 : box.y + box.px - 24 - 50 * 1.9;
    rects.caption = caption(p, info.caption, box.x + 24, y, 50, box.px - 48);
  }
  if (info.lowerThird) lowerThird(p, info.lowerThird.text, 1110, 900, 50);
  return { buffer: rgb(canvas, w, h), texts: p.texts, rects };
}

export function drawShort(scene: Scene, info: FrameInfo): Drawn {
  const { w, h } = SHORT_SIZE;
  const canvas = reusable('short', w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const p = new Painter(ctx, 40);
  // text stays inside 60 px at the sides, 180 at the top and 390 at the bottom, where YouTube draws over a Short
  const box: Box = { x: 95, y: 310, px: 890 };
  const rects: Drawn['rects'] = { board: { x: box.x, y: box.y, w: box.px, h: box.px }, head: { x: 0, y: 0 }, caption: null, lanes: null, chips: [], chosen: null };
  if (info.credits !== null) {
    credits(p, scene, 60, 260, 960, 72, true);
    return { buffer: rgb(canvas, w, h), texts: p.texts, rects };
  }
  rects.head = board(p, scene, info, box);
  // the counters sit above the board; the hook's caption takes their place
  if (info.caption) rects.caption = caption(p, info.caption, 60, 200, 52, 960);
  else counters(p, scene, info, 60, 290, 96);
  if (info.beat) {
    const r = raceBars(p, scene, info, 60, 1383, 960, 56, 60);
    rects.lanes = r.lanes;
    rects.chips = r.chips;
    rects.chosen = r.chosen;
  } else if (info.hold?.fx === 'filled') {
    p.text('FILLED', box.x + box.px / 2, box.y + box.px / 2 + 50, 150, FG, 800, 'sans', 'center');
  } else {
    bestSoFar(p, scene, info, 60, 1290, 960, 64);
  }
  if (info.badge) {
    p.round(w - 60 - 170, 222, 170, 76, 38, 'rgba(255,255,255,0.08)');
    p.text(info.badge, w - 60 - 85, 275, 44, FG, 800, 'sans', 'center');
  }
  if (info.lowerThird) lowerThird(p, info.lowerThird.text, 60, box.y + box.px - 24 - 56 * 1.9, 56);
  return { buffer: rgb(canvas, w, h), texts: p.texts, rects };
}
