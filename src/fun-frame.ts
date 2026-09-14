// The fun cuts' frames, docs/snake.md "The fun cuts": the stream frame with
// the market on the board (price tags in front of the head that never collide,
// trade chips in a bet beat), the game felt (a +1 on an eat, a crash with a red
// burst on a death, confetti and FILLED on the fill), and the vertical Short frame.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  drawFrame, drawBoard, cellRect, measureText, MAIN_BOX, PALETTE, FONTS, WIDTH, HEIGHT, NEXT_LABEL, logoImage, LOGO_NATURAL,
  type Box,
} from './frame.js';
import { ACTIONS, type Action } from './decide.js';
import { BEAT_PER_TRADE, HOOK_SUBCAPTION, type Shot } from './fun.js';

export const SHORT_W = 1080;
export const SHORT_H = 1920;
export const SHORT_BOX: Box = { x: 24, y: 150, px: 1032 };
const CONFETTI = ['#f59e0b', '#60a5fa', '#f472b6', '#facc15', '#a78bfa', '#22d3ee', '#f87171'];
const ARROW: Record<string, string> = { up: '↑', right: '→', down: '↓', left: '←' };
const DELTA: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** How the two frames size the market's marks: the Short never sets under 40 px. */
export const SIZES = {
  full: { tag: 20, chip: 24, handle: 18, more: 20, plus: 30, filled: 100, counter: 18 },
  short: { tag: 44, chip: 52, handle: 42, more: 44, plus: 60, filled: 150, counter: 56 },
};
export type Sizes = typeof SIZES.full;
/** A chip is solid this many frames (half a second), then fades over CHIP_FADE. */
const CHIP_SOLID = 12;
const CHIP_FADE = 8;
const EDGE = 4;

type Face = keyof typeof FONTS;
type Write = (str: string, x: number, y: number, size: number, colour: string, weight: number, face: Face, align?: 'left' | 'right' | 'center') => void;
type Rect = { x: number; y: number; w: number; h: number };

function writer(ctx: SKRSContext2D, record: (text: string, size: number) => void): Write {
  return (str, x, y, size, colour, weight, face, align = 'left') => {
    if (!str) return;
    record(str, size);
    ctx.font = `${weight} ${size}px "${FONTS[face]}"`;
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
  };
}

const clip = (s: string, size: number, w: number, weight: number, face: Face) => {
  if (measureText(s, size, weight, face) <= w) return s;
  let t = s;
  while (t.length > 1 && measureText(`${t}…`, size, weight, face) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
};

/** The largest size from `start` down to `min` at which `s` fits `w`. */
const fit = (s: string, w: number, start: number, min: number, weight: number, face: Face) => {
  let size = start;
  while (size > min && measureText(s, size, weight, face) > w) size -= 2;
  return size;
};

/** A deterministic 0..1 value per integer, so confetti is the same on every render. */
const rand = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const one = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(1));
const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const clampInto = (r: Rect, box: Box): Rect => ({
  ...r,
  x: Math.min(Math.max(r.x, box.x + EDGE), box.x + box.px - EDGE - r.w),
  y: Math.min(Math.max(r.y, box.y + EDGE), box.y + box.px - EDGE - r.h),
});

export function shakeOffset(shot: Shot, k: number): [number, number] {
  if (shot.fx !== 'death' || k >= 8) return [0, 0];
  const amp = 10 * (1 - k / 8);
  return [Math.round(Math.sin(k * 2.7) * amp), Math.round(Math.cos(k * 3.1) * amp)];
}

function pill(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, fill: string | null, stroke: string | null, lw = 1.5) {
  ctx.beginPath();
  ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, h / 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

interface Bet { handle: string; option: Action | null; credits: number; from: number; to: number }

const gridOf = (s: any): number => s.grid ?? s.game?.size ?? 4;

/**
 * Where each priced option's tag sits (docs/snake.md, "The fun cuts"): on the
 * cell the snake would enter, or against the wall inside the head's cell, then
 * moved to the nearest free spot so no two tags overlap, and kept inside the board.
 * The chosen option is placed first, so it keeps its preferred spot.
 */
export function tagRects(s: any, box: Box, z: Sizes): Array<Rect & { action: Action }> {
  const head = s.game?.snake?.[0];
  if (!head || !s.open) return [];
  const N = gridOf(s);
  const h = cellRect(head.x, head.y, N, box);
  const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
  const w = Math.max(measureText('00.0', z.tag, 700, 'mono'), 0) + z.tag * 1.1;
  const th = z.tag * 1.7;
  const chosen: Action | null = s.video?.chosen ?? null;
  const order = [...ACTIONS].sort((a, b) => (a === chosen ? -1 : b === chosen ? 1 : 0));
  const placed: Array<Rect & { action: Action }> = [];
  for (const a of order) {
    const price = s.open.quotes?.[a]?.m60?.price;
    const dir = s.open.directions?.[a];
    if (price === null || price === undefined || !Number.isFinite(price) || !dir || !DELTA[dir]) continue;
    const [dx, dy] = DELTA[dir];
    const nx = head.x + dx, ny = head.y + dy;
    const inside = nx >= 0 && ny >= 0 && nx < N && ny < N;
    const reachX = inside ? h.w : Math.max(0, h.w / 2 - w / 2 - EDGE);
    const reachY = inside ? h.h : Math.max(0, h.h / 2 - th / 2 - EDGE);
    const px = cx + dx * reachX, py = cy + dy * reachY;
    // the preferred spot, then a widening search along the wall (perpendicular to the move) and back from it
    const [ax, ay] = dx !== 0 ? [0, 1] : [1, 0];
    let best: Rect | null = null;
    for (let ring = 0; ring < 40 && !best; ring++) {
      const offsets = ring === 0 ? [[0, 0]] : [[ring, 0], [-ring, 0], [ring, -ring], [-ring, -ring], [0, -ring]];
      for (const [along, back] of offsets) {
        const stepAlong = ax ? w + 6 : th + 6;
        const stepBack = dx !== 0 ? w + 6 : th + 6;
        const r = clampInto({
          x: px + ax * along * stepAlong * 0.5 - dx * back * stepBack * 0.5 - w / 2,
          y: py + ay * along * stepAlong * 0.5 - dy * back * stepBack * 0.5 - th / 2,
          w, h: th,
        }, box);
        if (!placed.some(p => overlaps(p, r, 2))) { best = r; break; }
      }
    }
    if (best) placed.push({ ...best, action: a });
  }
  return ACTIONS.flatMap(a => placed.filter(p => p.action === a));
}

/** The price a tag shows at frame `k`: during a beat it counts through its option's trades. */
function tagPrice(s: any, a: Action, shot: Shot, k: number): number | null {
  const recorded = s.open?.quotes?.[a]?.m60?.price ?? null;
  const shown: Bet[] = (s.video?.bets ?? []).slice(0, shot.bet ?? 0);
  const mine = shown.map((b, t) => ({ b, t })).filter(x => x.b.option === a);
  if (!(shot.bet ?? 0) || mine.length === 0) return recorded;
  let value = mine[0].b.from;
  for (const { b, t } of mine) {
    const start = t * BEAT_PER_TRADE;
    if (k < start) break;
    const p = Math.min(1, Math.max(0, (k - start - 3) / 5));
    value = b.from + (b.to - b.from) * p;
  }
  return value;
}

/** The chips a beat shows at frame `k`: solid for half a second, then fading; above their option's
 *  tag (or the head, when the option is not named), below it when there is no room, always inside the board. */
export function chipRects(s: any, shot: Shot, k: number, box: Box, z: Sizes): Array<Rect & { handle: string; text: string; alpha: number; start: number }> {
  const bets: Bet[] = (s.video?.bets ?? []).slice(0, shot.bet ?? 0);
  if (bets.length === 0) return [];
  const head = s.game?.snake?.[0];
  const N = gridOf(s);
  const tags = tagRects(s, box, z);
  const out: Array<Rect & { handle: string; text: string; alpha: number; start: number }> = [];
  bets.forEach((b, t) => {
    const start = t * BEAT_PER_TRADE;
    const age = k - start;
    if (age < 0 || age > CHIP_SOLID + CHIP_FADE) return;
    const alpha = age <= CHIP_SOLID ? 1 : Math.max(0, 1 - (age - CHIP_SOLID) / CHIP_FADE);
    if (alpha <= 0) return;
    const tag = b.option ? tags.find(r => r.action === b.option) : undefined;
    let anchor: Rect;
    if (tag) anchor = tag;
    else if (head) { const c = cellRect(head.x, head.y, N, box); anchor = { x: c.x + c.w / 2 - 1, y: c.y + c.h * 0.2, w: 2, h: c.h * 0.6 }; }
    else anchor = { x: box.x + box.px / 2, y: box.y + box.px / 2, w: 0, h: 0 };
    const text = `+${Math.round(b.credits).toLocaleString('en-US')} cr`;
    const maxW = box.px - 2 * EDGE;
    const w = Math.min(maxW, Math.max(measureText(text, z.chip, 700, 'sans'), measureText(b.handle, z.handle, 600, 'sans')) + z.chip);
    const h = z.chip * 1.35 + z.handle * 1.25;
    const rise = Math.min(age, CHIP_SOLID) * (z.chip / 12);
    let y = anchor.y - 8 - h - rise;
    if (y < box.y + EDGE) y = anchor.y + anchor.h + 8 + rise;
    const r = clampInto({ x: anchor.x + anchor.w / 2 - w / 2, y, w, h }, box);
    out.push({ ...r, handle: b.handle, text, alpha, start });
  });
  return out;
}

/** Where a crash's burst is drawn and how far its spikes reach: on the cell the head runs into,
 *  or against the wall inside the head's cell, never past the board's edge. */
export function burstAt(s: any, box: Box): { x: number; y: number; r: number } | null {
  const head = s.game?.snake?.[0];
  const dir = s.next?.direction;
  if (!head || !dir || !DELTA[dir]) return null;
  const N = gridOf(s);
  const c = cellRect(head.x, head.y, N, box);
  const [dx, dy] = DELTA[dir];
  const r = c.w * 0.3;
  const nx = head.x + dx, ny = head.y + dy;
  const inside = nx >= 0 && ny >= 0 && nx < N && ny < N;
  const reach = inside ? c.w : c.w / 2 - r - EDGE;
  const x = Math.min(Math.max(c.x + c.w / 2 + dx * reach, box.x + r + EDGE), box.x + box.px - r - EDGE);
  const y = Math.min(Math.max(c.y + c.h / 2 + dy * reach, box.y + r + EDGE), box.y + box.px - r - EDGE);
  return { x, y, r };
}

/** The market on the board: the tags, a beat's chips, and `+N more`. */
function market(ctx: SKRSContext2D, box: Box, s: any, shot: Shot, k: number, write: Write, z: Sizes) {
  if (!s.open || shot.card) return;
  const chosen: Action | null = s.video?.chosen ?? null;
  const picking = (shot.bet ?? 0) > 0 && k >= (shot.bet ?? 0) * BEAT_PER_TRADE;
  const tags = tagRects(s, box, z);
  for (const r of tags) {
    const lead = r.action === chosen;
    ctx.save();
    if (lead && picking) {
      ctx.shadowColor = PALETTE.SNAKE;
      ctx.shadowBlur = z.tag * 1.2;
    }
    pill(ctx, r.x, r.y, r.w, r.h, lead ? PALETTE.SNAKE : 'rgba(16,16,19,0.92)', lead ? null : PALETTE.STRONG, lead ? 0 : 2);
    ctx.restore();
    write(one(tagPrice(s, r.action, shot, k)), r.x + r.w / 2, r.y + r.h / 2 + z.tag * 0.36, z.tag, lead ? PALETTE.BG : PALETTE.FG, 700, 'mono', 'center');
  }

  for (const c of chipRects(s, shot, k, box, z)) {
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = z.chip * 0.4;
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.w, c.h, z.chip * 0.35);
    ctx.fillStyle = PALETTE.LEAD;
    ctx.fill();
    ctx.shadowBlur = 0;
    const mid = c.x + c.w / 2;
    write(c.text, mid, c.y + z.chip * 1.08, z.chip, PALETTE.BG, 700, 'sans', 'center');
    write(clip(c.handle, z.handle, c.w - z.chip * 0.5, 600, 'sans'), mid, c.y + z.chip * 1.08 + z.handle * 1.12, z.handle, PALETTE.BG, 600, 'sans', 'center');
    ctx.restore();
  }

  if ((shot.more ?? 0) > 0 && k >= Math.max(0, ((shot.bet ?? 1) - 1) * BEAT_PER_TRADE + 4)) {
    const label = `+${shot.more} more`;
    const w = measureText(label, z.more, 700, 'sans') + z.more;
    const h = z.more * 1.6;
    const r = clampInto({ x: box.x + box.px / 2 - w / 2, y: box.y + box.px - h - z.counter * 3, w, h }, box);
    pill(ctx, r.x, r.y, r.w, r.h, 'rgba(16,16,19,0.92)', PALETTE.LEAD, 2);
    write(label, r.x + r.w / 2, r.y + r.h / 2 + z.more * 0.36, z.more, PALETTE.LEAD, 700, 'sans', 'center');
  }
}

/** The game felt on the board: the crash, the +1 and the head's pop, confetti and FILLED. */
function feel(ctx: SKRSContext2D, box: Box, s: any, shot: Shot, k: number, write: Write, z: Sizes) {
  const N = gridOf(s);
  const head = s.game?.snake?.[0];
  if (shot.fx === 'death') {
    const alpha = 0.4 * Math.max(0, 1 - k / 10);
    if (alpha > 0) {
      ctx.fillStyle = `rgba(248,113,113,${alpha})`;
      ctx.fillRect(box.x, box.y, box.px, box.px);
    }
    const dir = s.next?.direction;
    const burst = burstAt(s, box);
    if (head && dir && DELTA[dir] && burst) {
      const [dx, dy] = DELTA[dir];
      const c = cellRect(head.x, head.y, N, box);
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      // the head lunges toward what it hits, never past the board's edge
      const lunge = c.w * 0.3 * Math.min(1, k / 3);
      const hr = c.w * 0.39;
      const lx = Math.min(Math.max(cx + dx * lunge, box.x + hr), box.x + box.px - hr);
      const ly = Math.min(Math.max(cy + dy * lunge, box.y + hr), box.y + box.px - hr);
      ctx.fillStyle = PALETTE.SNAKE;
      ctx.beginPath();
      ctx.arc(lx, ly, hr, 0, Math.PI * 2);
      ctx.fill();
      const fade = k < 14 ? 1 : Math.max(0, 1 - (k - 14) / 8);
      if (fade > 0) {
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.fillStyle = PALETTE.FOOD;
        const grow = 0.75 + 0.25 * Math.min(1, k / 4);
        ctx.beginPath();
        for (let p = 0; p < 16; p++) {
          const ang = (p / 16) * Math.PI * 2;
          const rr = (p % 2 === 0 ? burst.r : burst.r / 1.7) * grow;
          const px = burst.x + Math.cos(ang) * rr, py = burst.y + Math.sin(ang) * rr;
          if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }
  if (shot.fx === 'eat' && head) {
    const r = cellRect(head.x, head.y, N, box);
    const fade = Math.max(0, 1 - k / 14);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = PALETTE.SNAKE;
    ctx.lineWidth = Math.max(3, r.w * 0.06);
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, (r.w / 2) * (0.9 + k * 0.05), 0, Math.PI * 2);
    ctx.stroke();
    const size = Math.max(z.plus, Math.round(r.h * 0.4));
    write('+1', r.x + r.w / 2, Math.max(box.y + size, r.y - k * 3), size, PALETTE.SNAKE, 700, 'sans', 'center');
    ctx.restore();
  }
  if (shot.fx === 'fill') {
    const cx = box.x + box.px / 2, cy = box.y + box.px / 2;
    const t = k + 1;
    for (let p = 0; p < 160; p++) {
      const angle = rand(p) * Math.PI * 2;
      const speed = (0.3 + rand(p + 1000)) * (box.px / 36);
      const x = cx + Math.cos(angle) * speed * t;
      const y = cy + Math.sin(angle) * speed * t + 0.25 * t * t;
      if (x < box.x || x > box.x + box.px || y < box.y || y > box.y + box.px) continue;
      ctx.fillStyle = CONFETTI[p % CONFETTI.length];
      ctx.fillRect(x, y, box.px / 60, box.px / 38);
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 24;
    write('FILLED', cx, cy + z.filled * 0.34, z.filled, PALETTE.BONE, 700, 'sans', 'center');
    ctx.restore();
  }
}

/** A board-sized copy of `src` shifted by the shake, the rest of the frame left where it is. */
function shaken(src: Canvas, w: number, h: number, box: Box, dx: number, dy: number): Canvas {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const pad = 12;
  ctx.fillStyle = PALETTE.BG;
  ctx.fillRect(box.x - pad, box.y - pad, box.px + 2 * pad, box.px + 2 * pad);
  ctx.drawImage(src, box.x, box.y, box.px, box.px, box.x + dx, box.y + dy, box.px, box.px);
  return c;
}

const deathsShown = (s: any, shot: Shot) => (s.game?.deaths ?? 0) + (shot.fx === 'death' ? 1 : 0);

function drawFun(s: any, now: number, shot: Shot, k: number, texts: string[]): Canvas {
  // the tags replace the next-move chevron (docs/snake.md, "The fun cuts")
  const base = drawFrame({ ...s, video: { ...(s.video ?? {}), hideChevron: true } }, now, texts);
  const [dx, dy] = shakeOffset(shot, k);
  const canvas = dx || dy ? shaken(base, WIDTH, HEIGHT, MAIN_BOX, dx, dy) : base;
  const ctx = canvas.getContext('2d');
  const box = { ...MAIN_BOX, x: MAIN_BOX.x + dx, y: MAIN_BOX.y + dy };
  const write = writer(ctx, t => texts.push(t));
  const z = SIZES.full;
  if (shot.fx !== 'death') market(ctx, box, s, shot, k, write, z);
  feel(ctx, box, s, shot, k, write, z);
  // the death counter, bottom left on the board
  const counter = `DEATHS ${deathsShown(s, shot)}`;
  const cw = measureText(counter, z.counter, 600, 'mono') + 28;
  pill(ctx, box.x + 12, box.y + box.px - 48, cw, 36, 'rgba(16,16,19,0.8)', PALETTE.STRONG);
  write(counter, box.x + 26, box.y + box.px - 24, z.counter, PALETTE.FOOD, 600, 'mono');
  if (shot.badge) {
    const bw = measureText(shot.badge, 22, 700, 'mono') + 28;
    pill(ctx, box.x + box.px - 12 - bw, box.y + 12, bw, 40, PALETTE.LEAD, null);
    write(shot.badge, box.x + box.px - 12 - bw / 2, box.y + 40, 22, PALETTE.BG, 700, 'mono', 'center');
  }
  return canvas;
}

function rgb(canvas: Canvas, w: number, h: number): Buffer {
  const rgba = canvas.data();
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) { out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; }
  return out;
}

export function renderFunFrame(s: any, now: number, shot: Shot, k: number): Buffer {
  return rgb(drawFun(s, now, shot, k, []), WIDTH, HEIGHT);
}

export function funTexts(s: any, now: number, shot: Shot, k: number): string[] {
  const texts: string[] = [];
  drawFun(s, now, shot, k, texts);
  return texts;
}

const PILL_TOP = 1340, PILL_H = 96, PILL_GAP = 16;

/** The Short's three option pills, stacked full width under the stats. */
export function shortPillRects(s: any): Array<{ x: number; y: number; w: number; h: number }> {
  if (!s?.open) return [];
  return ACTIONS.map((_, i) => ({ x: 24, y: PILL_TOP + i * (PILL_H + PILL_GAP), w: SHORT_W - 48, h: PILL_H }));
}

function drawShort(s: any, now: number, shot: Shot, k: number, rec: Array<{ text: string; size: number }>): Canvas {
  void now;
  const canvas = createCanvas(SHORT_W, SHORT_H);
  const ctx = canvas.getContext('2d');
  const write = writer(ctx, (text, size) => rec.push({ text, size }));
  const { BG, FG, FG2, MUTE, SNAKE, STRONG, FOOD, BONE } = PALETTE;
  const z = SIZES.short;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SHORT_W, SHORT_H);
  const g = s.game ?? {};
  const N = gridOf(s);
  const W = SHORT_W - 48;

  if (shot.card === 'end') {
    if (LOGO_NATURAL.w > 0) ctx.drawImage(logoImage, 48, 620, (80 * LOGO_NATURAL.w) / LOGO_NATURAL.h, 80);
    write('Bet on the next move', 48, 860, fit('Bet on the next move', W, 80, 40, 700, 'serif'), FG, 700, 'serif');
    write('Every move of the snake is a market.', 48, 940, fit('Every move of the snake is a market.', W, 48, 40, 400, 'sans'), FG2, 400, 'sans');
    pill(ctx, 48, 1010, W - 48, 160, BONE, null);
    write('telarchy.com/snake', SHORT_W / 2, 1115, 84, BG, 600, 'sans', 'center');
    return canvas;
  }

  write('Snake', 48, 116, 80, FG, 700, 'serif');
  write(`LEVEL ${N}X${N}`, SHORT_W - 48, 110, 44, MUTE, 500, 'mono', 'right');

  const [dx, dy] = shakeOffset(shot, k);
  const box = { ...SHORT_BOX, x: SHORT_BOX.x + dx, y: SHORT_BOX.y + dy };
  // the tags replace the next-move chevron (docs/snake.md, "The fun cuts")
  drawBoard(ctx, g, N, null, box);
  if (shot.fx !== 'death') market(ctx, box, s, shot, k, write, z);
  feel(ctx, box, s, shot, k, write, z);

  if (shot.card === 'hook') {
    ctx.fillStyle = 'rgba(16,16,19,0.72)';
    ctx.fillRect(SHORT_BOX.x, SHORT_BOX.y, SHORT_BOX.px, SHORT_BOX.px);
    const line1 = shot.caption ?? '';
    const mid = SHORT_BOX.y + SHORT_BOX.px / 2;
    write(line1, 60, mid - 10, fit(line1, W - 36, 80, 40, 700, 'sans'), BONE, 700, 'sans');
    if (k >= 18) write(HOOK_SUBCAPTION, 60, mid + 80, fit(HOOK_SUBCAPTION, W - 36, 56, 40, 600, 'sans'), SNAKE, 600, 'sans');
  }

  // the stats: length and the death counter
  const statsY = 1290;
  const length = String(g.length ?? '-');
  write(length, 48, statsY, 110, FG, 600, 'mono');
  write('LENGTH', 48 + measureText(length, 110, 600, 'mono') + 20, statsY, 44, MUTE, 500, 'mono');
  write(`DEATHS ${deathsShown(s, shot)}`, SHORT_W - 48, statsY, z.counter, FOOD, 600, 'mono', 'right');

  if (s.open && shot.card === null) {
    const chosen = s.video?.chosen ?? null;
    shortPillRects(s).forEach((r, i) => {
      const a = ACTIONS[i];
      const lead = a === chosen;
      pill(ctx, r.x, r.y, r.w, r.h, null, lead ? SNAKE : STRONG, 3);
      const dir = s.open.directions?.[a];
      const price = one(s.open.quotes?.[a]?.m60?.price);
      write(`${dir ? `${ARROW[dir] ?? ''} ` : ''}${NEXT_LABEL[a]}`, r.x + 40, r.y + 64, 52, lead ? SNAKE : FG, 500, 'sans');
      write(price, r.x + r.w - 40, r.y + 64, 52, lead ? SNAKE : FG2, 500, 'mono', 'right');
    });
  } else if (!s.open) {
    write('The snake filled the grid.', 48, 1440, 60, FG, 600, 'sans');
    const facts = s.video?.facts ? String(s.video.facts) : '';
    write(clip(facts, 44, W, 400, 'sans'), 48, 1520, 44, FG2, 400, 'sans');
  }

  const row = Array.isArray(s.video?.rows) ? s.video.rows[0] : null;
  if (shot.card === null && s.open) {
    if (row) write(clip(`${row.handle} ${row.what}`, 44, W, 500, 'sans'), 48, 1780, 44, FG2, 500, 'sans');
    else write('No trades on this move', 48, 1780, 44, MUTE, 400, 'sans');
  }
  write('telarchy.com/snake', SHORT_W - 48, 1880, 48, BONE, 600, 'sans', 'right');
  return canvas;
}

export function renderShortFrame(s: any, now: number, shot: Shot, k: number): Buffer {
  return rgb(drawShort(s, now, shot, k, []), SHORT_W, SHORT_H);
}

export function shortTexts(s: any, now: number, shot: Shot, k: number): Array<{ text: string; size: number }> {
  const rec: Array<{ text: string; size: number }> = [];
  drawShort(s, now, shot, k, rec);
  return rec;
}
