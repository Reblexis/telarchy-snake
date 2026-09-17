// Drawing a level video frame, docs/level-video.md "The trades: race bars", "Motion and
// type" and "Structure": the board with a gliding snake, the race bars and chips during a
// beat, the best-so-far bar at speed, captions, record cards, the fill and the credits.
// It draws only what a frame's description (frames.ts) says, and reports the texts and
// layout boxes it drew so the rules can be checked.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { cellRect, measureText, FONTS, logoImage, LOGO_NATURAL, type Box } from './frame.js';
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
export interface TapeRow { handle: string; option: Action | null; credits: number; against: boolean; from: number; to: number; move: number; at: string }
export interface Drawn {
  buffer: Buffer;
  texts: DrawnText[];
  /** The trades on the tape, newest first (the full cut's dashboard). */
  tape: TapeRow[];
  rects: {
    board: Rect;
    /** Where the board was really painted, after the push-in. */
    drawnBoard: Rect;
    head: { x: number; y: number };
    caption: Rect | null;
    lanes: Record<Action, Rect> | null;
    chips: ChipRect[];
    chosen: Action | null;
    /** The dashboard's panels, top to bottom; the chart's plot and its playhead's x. */
    panels: Rect[];
    chart: Rect | null;
    playhead: number | null;
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

/** The game's own colours, docs/level-video.md "The game looks like a game". */
export const GAME = {
  boardA: '#1b2030', boardB: '#232a3d',
  bodyA: '#4ade80', bodyB: '#34c46c', link: '#2aa35a', head: '#16a34a',
  eye: '#ffffff', pupil: '#0f1117',
  apple: '#ef4444', shine: '#fca5a5', stem: '#8b5a2b', leaf: '#84cc16',
} as const;

/** An ordinary snake game inside the box: a checkerboard, a body of blocks, a head with eyes, an apple.
 *  `snake` is snakeAt's (a fractional head first while it glides); `slide` is how far the tail has
 *  slid into the segment before it, from 0 to 1. */
function gameBoard(c: SKRSContext2D, snake: Cell[], heading: string, food: Cell | null, slide: number, N: number, box: Box) {
  const cell = Math.floor(box.px / N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    c.fillStyle = (x + y) % 2 === 0 ? GAME.boardA : GAME.boardB;
    c.fillRect(box.x + x * cell, box.y + y * cell, cell, cell);
  }
  const inset = cell * 0.06, side = cell - 2 * inset, r = cell * 0.12;
  const block = (at: Cell, fill: string) => {
    c.beginPath();
    c.roundRect(box.x + at.x * cell + inset, box.y + at.y * cell + inset, side, side, r);
    c.fillStyle = fill;
    c.fill();
  };
  if (food) {
    const fx = box.x + food.x * cell + cell / 2, fy = box.y + food.y * cell + cell / 2 + cell * 0.05;
    const ar = cell * 0.3;
    c.strokeStyle = GAME.stem;
    c.lineWidth = Math.max(3, cell * 0.05);
    c.lineCap = 'butt';
    c.beginPath(); c.moveTo(fx, fy - ar * 0.8); c.lineTo(fx, fy - ar - cell * 0.1); c.stroke();
    c.fillStyle = GAME.leaf;
    c.beginPath(); c.ellipse(fx + cell * 0.1, fy - ar - cell * 0.03, cell * 0.1, cell * 0.05, -0.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = GAME.apple;
    c.beginPath(); c.arc(fx, fy, ar, 0, Math.PI * 2); c.fill();
    c.fillStyle = GAME.shine;
    c.beginPath(); c.ellipse(fx - ar * 0.4, fy - ar * 0.45, ar * 0.2, ar * 0.13, -0.6, 0, Math.PI * 2); c.fill();
  }
  // the links under the blocks, so the path reads when the grid is nearly full
  const tailAt = (k: number): Cell => {
    if (k !== snake.length - 1 || k < 2 || slide <= 0) return snake[k];
    const b = snake[k - 1];
    return { x: snake[k].x + (b.x - snake[k].x) * slide, y: snake[k].y + (b.y - snake[k].y) * slide };
  };
  const lw = side * 0.5;
  c.fillStyle = GAME.link;
  for (let k = 1; k < snake.length; k++) {
    const a = snake[k - 1], b = tailAt(k);
    const ax = box.x + a.x * cell + cell / 2, ay = box.y + a.y * cell + cell / 2;
    const bx = box.x + b.x * cell + cell / 2, by = box.y + b.y * cell + cell / 2;
    c.fillRect(Math.min(ax, bx) - (ay === by ? 0 : lw / 2), Math.min(ay, by) - (ax === bx ? 0 : lw / 2), Math.abs(bx - ax) + (ay === by ? 0 : lw), Math.abs(by - ay) + (ax === bx ? 0 : lw));
  }
  // tail first, so it slides under the segment before it; the head last, over its neck
  for (let k = snake.length - 1; k >= 1; k--) {
    block(tailAt(k), k % 2 === 1 ? GAME.bodyA : GAME.bodyB);
  }
  if (!snake[0]) return;
  block(snake[0], GAME.head);
  const cx = box.x + snake[0].x * cell + cell / 2, cy = box.y + snake[0].y * cell + cell / 2;
  const [dx, dy] = DELTA[heading] ?? DELTA.right;
  const off = cell * 0.14, apart = cell * 0.19, er = cell * 0.11, pr = cell * 0.06;
  for (const sgn of [-1, 1]) {
    const ex = cx + dx * off - dy * apart * sgn, ey = cy + dy * off + dx * apart * sgn;
    c.fillStyle = GAME.eye;
    c.beginPath(); c.arc(ex, ey, er, 0, Math.PI * 2); c.fill();
    c.fillStyle = GAME.pupil;
    c.beginPath(); c.arc(ex + dx * cell * 0.04, ey + dy * cell * 0.04, pr, 0, Math.PI * 2); c.fill();
  }
}

/** The board with the gliding snake, arrows during a beat, the crash burst and the fill's confetti.
 *  Returns the head's centre on screen. The push-in never lets the board leave its box. */
function board(p: Painter, scene: Scene, info: FrameInfo, box: Box, margin: number): { head: { x: number; y: number }; drawn: Rect } {
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
  const px = cell * N;
  let drawn: Rect = { x: box.x, y: box.y, w: px, h: px };
  c.save();
  c.beginPath();
  c.rect(box.x - margin, box.y - margin, px + 2 * margin, px + 2 * margin);
  c.clip();
  if (info.zoom > 1) {
    // scale about the head, cut short where the board would outgrow the margin around its box
    const worst = Math.max(head.x - box.x, box.x + px - head.x, head.y - box.y, box.y + px - head.y);
    const z = Math.min(info.zoom, 1 + margin / Math.max(1, worst));
    c.translate(head.x, head.y);
    c.scale(z, z);
    c.translate(-head.x, -head.y);
    drawn = { x: head.x + (box.x - head.x) * z, y: head.y + (box.y - head.y) * z, w: px * z, h: px * z };
  }
  // the tail leaves as the head arrives, unless the move eats
  const gliding = snake.length > e.snake.length;
  const next = scene.entries[i + 1];
  const slide = gliding && next && next.length <= e.length ? pos - i : 0;
  gameBoard(c, snake, headingAt(scene, pos), e.food, slide, N, box);
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
  return { head, drawn };
}

// ---------------------------------------------------------------------------------------------
// the race bars

/** The trades of a move worth showing, and its three largest in the order they were made. */
function shownBets(scene: Scene, move: number) {
  const bets = (scene.bets[move] ?? []).filter(b => b.credits >= 1);
  const largest = bets.map((b, i) => ({ ...b, i })).sort((a, b) => b.credits - a.credits || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i);
  return { bets, largest };
}

/** The race bars. In a beat they follow its phases; outside one (`info.beat` null) they show the settled
 *  prices of the move on screen, with no chips. */
function raceBars(p: Painter, scene: Scene, info: FrameInfo, x0: number, cy: number, w: number, lane: number, big: number): { lanes: Record<Action, Rect>; chips: ChipRect[]; chosen: Action | null } {
  const last = scene.entries.length - 1;
  const idle = !info.beat;
  const move = info.beat ? info.beat.move : Math.max(Math.min(1, last), Math.min(last, Math.floor(info.position)));
  const beat = info.beat ?? { move, phase: 'lock' as const, chip: 0, progress: 1 };
  const decided = scene.entries[move];
  const before = scene.entries[Math.max(0, move - 1)];
  const prices: Partial<Record<Action, number | null>> = decided.prices ?? {};
  const { bets, largest } = shownBets(scene, move);
  const chosen = !decided.undecided ? decided.action : null;
  const locked = beat.phase !== 'chips';
  const dirs = directionsFrom(before.heading);
  const cells = scene.size * scene.size;
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
    if (locked && !idle && opt === chosen) {
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
      // on the pot's line, beside its total
      const ph = Math.max(p.minSize * 1.2, big * 0.62);
      const ps = Math.max(p.minSize, ph * 0.6);
      const potText = `POT ${Math.round(pot).toLocaleString('en-US')} cr`;
      const px0 = x0 + measureText(potText, Math.max(p.minSize, big * 0.36), 700, 'mono') + big * 0.4;
      const pw = measureText(label, ps, 800, 'sans') + ph * 0.8;
      const py = lineY - ph * 0.8;
      p.round(px0, py, pw, ph, ph / 2, fill);
      p.text(label, px0 + ph * 0.4, py + ph * 0.5 + ps * 0.36, ps, BG, 800);
      chips.push({ text: label, option: null, x: px0, y: py, w: pw, h: ph });
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
// the terminal (full cut), docs/level-video.md "The terminal"

export const FULL_BOX: Box = { x: 64, y: 120, px: 912 };
const FULL_MARGIN = 44;
const EDGE = '#2a2a32', GRIDLINE = '#1c1c22', UP = '#4ade80';
const NAME: Record<Action, string> = { left: 'LEFT', forward: 'STRAIGHT', right: 'RIGHT' };

function label(p: Painter, text: string, x: number, y: number, size = 14, align: CanvasTextAlign = 'left', colour = MUTE) {
  p.ctx.letterSpacing = '1.5px';
  p.text(text, x, y, size, colour, 500, 'mono', align);
  p.ctx.letterSpacing = '0px';
}
const signed = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}`;

/** The trades on the tape at this frame, newest first: never a trade of a move not yet shown. */
function tapeAt(scene: Scene, info: FrameInfo, rows = 9): TapeRow[] {
  const out: TapeRow[] = [];
  const push = (b: BetRow, move: number) => out.push({ handle: b.handle, option: b.option, credits: b.credits, against: Number.isFinite(b.from) && Number.isFinite(b.to) && b.to < b.from, from: b.from, to: b.to, move, at: b.at });
  let settled = Math.max(0, Math.min(scene.entries.length - 1, Math.floor(info.position)));
  if (info.beat) {
    const m = info.beat.move;
    settled = m - 1;
    const { bets, largest } = shownBets(scene, m);
    // a chip's trade enters when its chip starts; the move's smaller trades at the lock
    const revealed = info.beat.phase === 'chips' ? largest.slice(0, info.beat.chip + 1) : bets;
    for (let k = revealed.length - 1; k >= 0 && out.length < rows; k--) push(revealed[k], m);
  }
  for (let m = settled; m >= 1 && out.length < rows; m--) {
    const { bets } = shownBets(scene, m);
    for (let k = bets.length - 1; k >= 0 && out.length < rows; k--) push(bets[k], m);
  }
  return out;
}

/** The price ladder: the full cut's race bars. Returns the rows as lanes, the flying chip, and the prices shown. */
function ladder(p: Painter, scene: Scene, info: FrameInfo, x0: number, y0: number, w: number): { lanes: Record<Action, Rect>; chips: ChipRect[]; chosen: Action | null; move: number; shown: Record<Action, number>; locked: boolean } {
  const c = p.ctx;
  const last = scene.entries.length - 1;
  const idle = !info.beat;
  const move = info.beat ? info.beat.move : Math.max(Math.min(1, last), Math.min(last, Math.floor(info.position)));
  const beat = info.beat ?? { move, phase: 'lock' as const, chip: 0, progress: 1 };
  const decided = scene.entries[move];
  const before = scene.entries[Math.max(0, move - 1)];
  const prices: Partial<Record<Action, number | null>> = decided.prices ?? {};
  const { bets, largest } = shownBets(scene, move);
  const chosen = !decided.undecided ? decided.action : null;
  const locked = beat.phase !== 'chips';
  const dirs = directionsFrom(before.heading);
  const cells = scene.size * scene.size;
  const counting = locked ? 1 : Math.min(1, (beat.chip + beat.progress) / Math.max(1, largest.length));
  // what the viewer has seen of this move's trades so far: all of them once locked, the started chips before
  const seen = locked ? bets : largest.slice(0, beat.chip + 1);
  const stat: Record<Action, { credits: number; trades: number; first: number; lastTo: number }> = { left: { credits: 0, trades: 0, first: NaN, lastTo: NaN }, forward: { credits: 0, trades: 0, first: NaN, lastTo: NaN }, right: { credits: 0, trades: 0, first: NaN, lastTo: NaN } };
  let pot = 0;
  for (const b of seen) {
    if (!b.option) { pot += b.credits; continue; }
    const st = stat[b.option];
    st.credits += b.credits; st.trades++;
    if (Number.isNaN(st.first) && Number.isFinite(b.from)) st.first = b.from;
    if (Number.isFinite(b.to)) st.lastTo = b.to;
  }
  label(p, 'NEXT MOVE · PRICE LADDER', x0, y0 + 34);
  const smaller = bets.length - largest.length;
  let rx = x0 + w;
  if (smaller > 0) { const t = `+${smaller} smaller trade${smaller === 1 ? '' : 's'}`; p.text(t, rx, y0 + 34, 15, CHIP, 500, 'mono', 'right'); rx -= measureText(t, 15, 500, 'mono') + 28; }
  const potText = pot > 0 ? `POT ${Math.round(pot).toLocaleString('en-US')} cr` : '';
  if (potText) p.text(potText, rx, y0 + 34, 15, MUTE, 500, 'mono', 'right');
  const col = { price: x0 + 470, delta: x0 + 590, credits: x0 + 740, trades: x0 + w - 14 };
  const hy = y0 + 72;
  label(p, 'OPTION', x0 + 30, hy, 13);
  label(p, 'PRICE', col.price, hy, 13, 'right');
  label(p, 'Δ', col.delta, hy, 13, 'right');
  label(p, 'CREDITS', col.credits, hy, 13, 'right');
  label(p, 'TRADES', col.trades, hy, 13, 'right');
  const rowH = 68, top = y0 + 88;
  const lead = ORDER.reduce((a, b) => ((prices[b] ?? 0) > (prices[a] ?? 0) ? b : a), 'left' as Action);
  const lanes = {} as Record<Action, Rect>;
  const tips = {} as Record<Action, number>;
  const shown = {} as Record<Action, number>;
  ORDER.forEach((opt, k) => {
    const ly = top + k * rowH;
    lanes[opt] = { x: x0, y: ly + 4, w, h: rowH - 8 };
    c.fillStyle = EDGE;
    c.fillRect(x0, ly, w, 1);
    const recorded = typeof prices[opt] === 'number';
    const price = (prices[opt] ?? 0) * (0.35 + 0.65 * counting);
    shown[opt] = price;
    const a = locked ? (opt === chosen ? 1 : idle ? 0.55 : 0.3) : opt === lead ? 1 : 0.7;
    const len = recorded ? Math.max(3, Math.min(w, (price / cells) * w)) : 0;
    tips[opt] = x0 + len;
    c.fillStyle = rgba(HUE[opt], locked ? (opt === chosen ? (idle ? 0.3 : 0.55) : 0.08) : 0.16);
    c.fillRect(x0, ly + 4, len, rowH - 8);
    c.fillStyle = rgba(HUE[opt], a);
    if (recorded) c.fillRect(x0 + len - 2, ly + 4, 2, rowH - 8);
    const base = ly + rowH / 2 + 9;
    p.text(`${GLYPH[dirs[opt]]} ${NAME[opt]}`, x0 + 30, base, 22, rgba(HUE[opt], a), 600, 'mono');
    p.text(recorded ? price.toFixed(1) : '–', col.price, base + 5, 40, rgba(recorded ? FG : MUTE, a), 800, 'sans', 'right');
    const st = stat[opt];
    const delta = st.trades && Number.isFinite(st.first) && Number.isFinite(st.lastTo) ? st.lastTo - st.first : 0;
    p.text(!recorded ? '–' : Math.abs(delta) < 0.05 ? '0.0' : signed(delta), col.delta, base, 20, rgba(Math.abs(delta) < 0.05 ? MUTE : delta > 0 ? UP : RED, a), 600, 'mono', 'right');
    p.text(st.credits > 0 ? `${Math.round(st.credits).toLocaleString('en-US')} cr` : '-', col.credits, base, 20, rgba(st.credits > 0 ? CHIP : MUTE, a), 600, 'mono', 'right');
    p.text(String(st.trades), col.trades, base, 20, rgba(FG, a * 0.8), 600, 'mono', 'right');
  });
  c.fillStyle = EDGE;
  c.fillRect(x0, top + 3 * rowH, w, 1);

  const chips: ChipRect[] = [];
  if (!locked && beat.chip < largest.length) {
    const b = largest[beat.chip];
    const against = Number.isFinite(b.from) && Number.isFinite(b.to) && b.to < b.from;
    const text = `${against ? '−' : '+'}${Math.round(b.credits).toLocaleString('en-US')}`;
    const fill = against ? AGAINST : CHIP;
    const h = 40, size = 22, handleSize = 15;
    const cw = measureText(text, size, 800, 'sans') + measureText(b.handle, handleSize, 600, 'mono') + 34;
    const eased = 1 - (1 - beat.progress) ** 3;
    if (b.option) {
      const lane = lanes[b.option];
      // along its row, from the row's start to the depth bar's tip, never over the name or the figures
      const from = x0 + 200, to = Math.max(from, Math.min(tips[b.option], col.price - 110 - cw));
      const cx = from + (to - from) * eased, cy2 = lane.y + (lane.h - h) / 2;
      c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 12;
      p.round(cx, cy2, cw, h, 6, fill);
      c.restore();
      p.text(text, cx + 12, cy2 + 28, size, BG, 800);
      p.text(b.handle, cx + 20 + measureText(text, size, 800, 'sans'), cy2 + 26, handleSize, rgba(BG, 0.8), 600, 'mono');
      chips.push({ text, option: b.option, x: cx, y: cy2, w: cw, h });
    } else {
      // an unnamed trade's chip sits on the pot's line, beside its total
      const ph = 26, pw = measureText(text, 15, 800, 'sans') + 20;
      const px0 = rx - (potText ? measureText(potText, 15, 500, 'mono') : 0) - 14 - pw, py = y0 + 34 - 19;
      p.round(px0, py, pw, ph, 5, fill);
      p.text(text, px0 + 10, py + 19, 15, BG, 800);
      chips.push({ text, option: null, x: px0, y: py, w: pw, h: ph });
    }
  }
  return { lanes, chips, chosen, move, shown, locked };
}

/** The three options' prices over the forty moves up to `upTo`. */
function priceChart(p: Painter, scene: Scene, upTo: number, x0: number, y0: number, w: number, h: number): Rect {
  const c = p.ctx;
  label(p, 'PRICES · LAST 40 MOVES', x0, y0 + 34);
  const plot: Rect = { x: x0, y: y0 + 54, w: w - 52, h: h - 54 - 22 };
  // while a move's trades are still arriving the lines stop at the move before it
  const move = Math.max(1, upTo);
  const from = Math.max(1, move - 39);
  const series: Record<Action, number[]> = { left: [], forward: [], right: [] };
  for (let m = from; m <= move; m++) for (const o of ORDER) series[o].push(Number(scene.entries[m]?.prices?.[o] ?? NaN));
  const all = ORDER.flatMap(o => series[o]).filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (!all.length) { lo = 0; hi = 1; }
  const padv = Math.max(0.5, (hi - lo) * 0.12);
  lo = Math.max(0, lo - padv); hi += padv;
  const X = (k: number) => plot.x + (k / 39) * plot.w, Y = (v: number) => plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h;
  for (let g = 0; g <= 4; g++) {
    const v = lo + ((hi - lo) * g) / 4, y = Math.round(Y(v)) + 0.5;
    c.strokeStyle = GRIDLINE; c.lineWidth = 1;
    c.beginPath(); c.moveTo(plot.x, y); c.lineTo(plot.x + plot.w, y); c.stroke();
    if (all.length) p.text(v.toFixed(v >= 100 ? 0 : 1), x0 + w, y + 5, 14, MUTE, 500, 'mono', 'right');
  }
  for (const o of ORDER) {
    const pts = series[o];
    c.strokeStyle = HUE[o]; c.lineWidth = 2.5; c.lineJoin = 'round';
    c.beginPath();
    let pen = false;
    pts.forEach((v, k) => { if (!Number.isFinite(v)) { pen = false; return; } if (pen) c.lineTo(X(k), Y(v)); else c.moveTo(X(k), Y(v)); pen = true; });
    c.stroke();
    // a gold diamond where a move put at least 300 credits on the option
    pts.forEach((v, k) => {
      const m = from + k;
      if (!Number.isFinite(v)) return;
      let cr = 0;
      for (const b of scene.bets[m] ?? []) if (b.option === o) cr += b.credits;
      if (cr < 300) return;
      c.save(); c.translate(X(k), Y(v)); c.rotate(Math.PI / 4); c.fillStyle = CHIP; c.fillRect(-4.5, -4.5, 9, 9); c.restore();
    });
    const lastV = pts[pts.length - 1];
    if (Number.isFinite(lastV)) { c.fillStyle = HUE[o]; c.beginPath(); c.arc(X(pts.length - 1), Y(lastV), 5, 0, Math.PI * 2); c.fill(); }
  }
  return plot;
}

function terminal(p: Painter, scene: Scene, info: FrameInfo, rects: Drawn['rects']): TapeRow[] {
  const c = p.ctx;
  const i = Math.max(0, Math.min(scene.entries.length - 1, Math.floor(info.position)));
  const e = scene.entries[i];
  const cells = scene.size * scene.size;
  const TOP = 72, SPLIT = 1040, X = SPLIT + 28, W = 1920 - X - 28;
  const topBar: Rect = { x: 0, y: 0, w: 1920, h: TOP }, ladderCell: Rect = { x: SPLIT, y: TOP, w: 1920 - SPLIT, h: 308 };
  const chartCell: Rect = { x: SPLIT, y: TOP + 308, w: 1920 - SPLIT, h: 290 }, tapeCell: Rect = { x: SPLIT, y: TOP + 598, w: 1920 - SPLIT, h: 1080 - TOP - 598 };
  rects.panels = [topBar, ladderCell, chartCell, tapeCell];
  c.fillStyle = EDGE;
  c.fillRect(0, TOP, 1920, 1);
  c.fillRect(SPLIT, TOP, 1, 1080 - TOP);
  c.fillRect(SPLIT, chartCell.y, 1920 - SPLIT, 1);
  c.fillRect(SPLIT, tapeCell.y, 1920 - SPLIT, 1);

  // 1. the ticker
  c.letterSpacing = '2px';
  p.text(`SNAKE/L${scene.game.number}`, 32, 46, 22, FG, 600, 'mono');
  c.letterSpacing = '0px';
  const since = Math.max(0, Date.parse(e.at) - Date.parse(scene.game.startedAt));
  label(p, `${scene.size}×${scene.size} · T+${span(since)}`, 32 + measureText(`SNAKE/L${scene.game.number}`, 22, 600, 'mono') + 9 * 2 + 28, 45, 17);
  let rx = 1920 - 32;
  if (info.badge) {
    const bw = measureText(info.badge, 20, 600, 'mono') + 28;
    c.strokeStyle = CHIP; c.lineWidth = 1;
    c.strokeRect(rx - bw + 0.5, 19.5, bw, 34);
    p.text(info.badge, rx - bw / 2, 44, 20, CHIP, 600, 'mono', 'center');
    rx -= bw + 36;
  }
  const figures: Array<[string, string, string, string]> = [['MOVE', i.toLocaleString('en-US'), '', FG], ['ATTEMPT', String(e.deaths + 1), '', FG], ['DEATHS', String(e.deaths), '', RED], ['BEST', String(scene.best[i]), `/${cells}`, FG], ['LEN', String(e.length), '', FG]];
  for (const [name, value, tail, colour] of figures) {
    if (tail) { p.text(tail, rx, 50, 26, MUTE, 600, 'sans', 'right'); rx -= measureText(tail, 26, 600, 'sans') + 2; }
    p.text(value, rx, 50, 36, colour, 800, 'sans', 'right');
    rx -= measureText(value, 36, 800, 'sans') + 12;
    label(p, name, rx, 48, 14, 'right');
    rx -= measureText(name, 14, 500, 'mono') + name.length * 1.5 + 40;
  }

  // 2. the price ladder, 3. the price chart
  const l = ladder(p, scene, info, X, ladderCell.y, W);
  rects.lanes = l.lanes;
  rects.chips = l.chips;
  rects.chosen = l.chosen;
  rects.chart = priceChart(p, scene, l.locked ? l.move : l.move - 1, X, chartCell.y, W, chartCell.h);

  // 4. the tape
  label(p, 'TAPE', X, tapeCell.y + 34);
  const tape = tapeAt(scene, info);
  tape.forEach((t, k) => {
    const y = tapeCell.y + 76 + k * 36, a = k === 0 ? 1 : 0.7;
    const clock = Number.isFinite(Date.parse(t.at)) ? new Date(t.at).toISOString().slice(11, 19) : '';
    p.text(clock, X, y, 19, rgba(MUTE, a), 500, 'mono');
    let handle = t.handle;
    while (handle.length > 3 && measureText(handle, 19, 500, 'mono') > 240) handle = `${handle.slice(0, -2)}…`;
    p.text(handle, X + 150, y, 19, rgba(FG, a), 500, 'mono');
    const heading = scene.entries[Math.max(0, t.move - 1)].heading;
    if (t.option) p.text(GLYPH[directionsFrom(heading)[t.option]], X + 420, y + 1, 22, rgba(HUE[t.option], a), 800);
    else p.text('-', X + 424, y, 19, rgba(MUTE, a), 500, 'mono');
    p.text(`${t.against ? '−' : '+'}${Math.round(t.credits).toLocaleString('en-US')}`, X + 580, y, 19, rgba(t.against ? AGAINST : CHIP, a), 600, 'mono', 'right');
    if (Number.isFinite(t.from) && Number.isFinite(t.to)) p.text(`${t.from.toFixed(1)} → ${t.to.toFixed(1)}`, X + W, y, 19, rgba(MUTE, a), 500, 'mono', 'right');
  });
  return tape;
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
  const box = FULL_BOX;
  const rects: Drawn['rects'] = { board: { x: box.x, y: box.y, w: box.px, h: box.px }, drawnBoard: { x: box.x, y: box.y, w: box.px, h: box.px }, head: { x: 0, y: 0 }, caption: null, lanes: null, chips: [], chosen: null, panels: [], chart: null, playhead: null };
  let tape: TapeRow[] = [];
  if (info.credits !== null) {
    credits(p, scene, 160, 240, 1600, 72, false);
    return { buffer: rgb(canvas, w, h), texts: p.texts, tape, rects };
  }
  tape = terminal(p, scene, info, rects);
  { const b = board(p, scene, info, box, FULL_MARGIN); rects.head = b.head; rects.drawnBoard = b.drawn; }
  if (info.hold?.fx === 'filled') {
    p.ctx.save();
    p.ctx.shadowColor = 'rgba(0,0,0,0.6)';
    p.ctx.shadowBlur = 24;
    p.text('FILLED', box.x + box.px / 2, box.y + box.px / 2 + 40, 120, FG, 800, 'sans', 'center');
    p.ctx.restore();
  }
  // the caption never covers the head: at the board's bottom unless the head is low, then at its top
  const low = rects.head.y > box.y + box.px * 0.6;
  if (info.caption) {
    const y = low ? box.y + 24 : box.y + box.px - 24 - 50 * 1.9;
    rects.caption = caption(p, info.caption, box.x + 24, y, 50, box.px - 48);
  }
  // the record card: on the board, at the end away from the head and from a caption
  if (info.lowerThird) {
    const top = info.caption ? !low : low;
    lowerThird(p, info.lowerThird.text, box.x + 24, top ? box.y + 24 : box.y + box.px - 24 - 50 * 1.9, 50);
  }
  return { buffer: rgb(canvas, w, h), texts: p.texts, tape, rects };
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
  const tape: TapeRow[] = [];
  const rects: Drawn['rects'] = { board: { x: box.x, y: box.y, w: box.px, h: box.px }, drawnBoard: { x: box.x, y: box.y, w: box.px, h: box.px }, head: { x: 0, y: 0 }, caption: null, lanes: null, chips: [], chosen: null, panels: [], chart: null, playhead: null };
  if (info.credits !== null) {
    credits(p, scene, 60, 260, 960, 72, true);
    return { buffer: rgb(canvas, w, h), texts: p.texts, tape, rects };
  }
  { const b = board(p, scene, info, box, 10); rects.head = b.head; rects.drawnBoard = b.drawn; }
  // the counters sit above the board; the hook's caption takes their place
  if (info.caption) rects.caption = caption(p, info.caption, 60, 200, 52, 960);
  else counters(p, scene, info, 60, 290, 96);
  if (info.beat) {
    const r = raceBars(p, scene, info, 60, 1398, 960, 56, 60);
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
  return { buffer: rgb(canvas, w, h), texts: p.texts, tape, rects };
}
