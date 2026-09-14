// The fun cuts' frames, docs/snake.md "The fun cuts": the stream frame with
// the game felt on it (a +1 on an eat, a red flash and a shake on a death, the
// death counter, the x3 badge, confetti and FILLED on the fill), and the
// vertical Short frame built for a phone.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  drawFrame, drawBoard, cellRect, measureText, MAIN_BOX, PALETTE, FONTS, WIDTH, HEIGHT, NEXT_LABEL, logoImage, LOGO_NATURAL,
  type Box,
} from './frame.js';
import { ACTIONS } from './decide.js';
import type { Shot } from './fun.js';

export const SHORT_W = 1080;
export const SHORT_H = 1920;
const SHORT_BOX: Box = { x: 24, y: 150, px: 1032 };
const SHORT_MIN = 40;
const CONFETTI = ['#f59e0b', '#60a5fa', '#f472b6', '#facc15', '#a78bfa', '#22d3ee', '#f87171'];
const ARROW: Record<string, string> = { up: '↑', right: '→', down: '↓', left: '←' };

type Face = keyof typeof FONTS;
type Write = (str: string, x: number, y: number, size: number, colour: string, weight: number, face: Face, align?: 'left' | 'right' | 'center') => void;

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

/** A deterministic 0..1 value per integer, so confetti is the same on every render. */
const rand = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function shakeOffset(shot: Shot, k: number): [number, number] {
  if (shot.fx !== 'death' || k >= 8) return [0, 0];
  const amp = 10 * (1 - k / 8);
  return [Math.round(Math.sin(k * 2.7) * amp), Math.round(Math.cos(k * 3.1) * amp)];
}

/** The game felt on the board: flash, +1 and the head's pop, confetti and FILLED. */
function feel(ctx: SKRSContext2D, box: Box, s: any, shot: Shot, k: number, write: Write, big: boolean) {
  const N: number = s.grid ?? s.game?.size ?? 4;
  if (shot.fx === 'death') {
    const alpha = 0.4 * Math.max(0, 1 - k / 10);
    if (alpha > 0) {
      ctx.fillStyle = `rgba(248,113,113,${alpha})`;
      ctx.fillRect(box.x, box.y, box.px, box.px);
    }
  }
  const head = s.game?.snake?.[0];
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
    const size = Math.max(big ? SHORT_MIN * 1.5 : 30, Math.round(r.h * 0.4));
    write('+1', r.x + r.w / 2, r.y - k * 3, size, PALETTE.SNAKE, 700, 'sans', 'center');
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
    write('FILLED', cx, cy + (big ? 50 : 34), big ? 150 : 100, PALETTE.BONE, 700, 'sans', 'center');
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

function pill(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, fill: string | null, stroke: string | null, lw = 1.5) {
  ctx.beginPath();
  ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, h / 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function drawFun(s: any, now: number, shot: Shot, k: number, texts: string[]): Canvas {
  const base = drawFrame(s, now, texts);
  const [dx, dy] = shakeOffset(shot, k);
  const canvas = dx || dy ? shaken(base, WIDTH, HEIGHT, MAIN_BOX, dx, dy) : base;
  const ctx = canvas.getContext('2d');
  const box = { ...MAIN_BOX, x: MAIN_BOX.x + dx, y: MAIN_BOX.y + dy };
  const write = writer(ctx, t => texts.push(t));
  feel(ctx, box, s, shot, k, write, false);
  // the death counter, bottom left on the board
  const counter = `DEATHS ${s.game?.deaths ?? 0}`;
  const cw = measureText(counter, 18, 600, 'mono') + 28;
  pill(ctx, box.x + 12, box.y + box.px - 48, cw, 36, 'rgba(16,16,19,0.8)', PALETTE.STRONG);
  write(counter, box.x + 26, box.y + box.px - 24, 18, PALETTE.FOOD, 600, 'mono');
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

const one = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(1));

function drawShort(s: any, now: number, shot: Shot, k: number, rec: Array<{ text: string; size: number }>): Canvas {
  void now;
  const canvas = createCanvas(SHORT_W, SHORT_H);
  const ctx = canvas.getContext('2d');
  const write = writer(ctx, (text, size) => rec.push({ text, size }));
  const { BG, FG, FG2, MUTE, SNAKE, STRONG, FOOD, BONE } = PALETTE;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, SHORT_W, SHORT_H);
  const g = s.game ?? {};
  const N: number = s.grid ?? g.size ?? 4;
  const W = SHORT_W - 48;

  if (shot.card === 'end') {
    if (LOGO_NATURAL.w > 0) ctx.drawImage(logoImage, 48, 620, (80 * LOGO_NATURAL.w) / LOGO_NATURAL.h, 80);
    write('Trade the next move', 48, 860, 72, FG, 700, 'serif');
    write('Every move is a market.', 48, 940, 48, FG2, 400, 'sans');
    pill(ctx, 48, 1010, W - 48, 160, BONE, null);
    write('telarchy.com/snake', SHORT_W / 2, 1115, 84, BG, 600, 'sans', 'center');
    return canvas;
  }

  write('Snake', 48, 116, 80, FG, 700, 'serif');
  write(`LEVEL ${N}X${N}`, SHORT_W - 48, 110, 44, MUTE, 500, 'mono', 'right');

  const [dx, dy] = shakeOffset(shot, k);
  const box = { ...SHORT_BOX, x: SHORT_BOX.x + dx, y: SHORT_BOX.y + dy };
  const next = s.next && shot.card !== 'hook' ? { direction: s.next.direction, decided: true } : null;
  drawBoard(ctx, g, N, next, box);
  feel(ctx, box, s, shot, k, write, true);

  if (shot.card === 'hook') {
    ctx.fillStyle = 'rgba(16,16,19,0.6)';
    ctx.fillRect(SHORT_BOX.x, SHORT_BOX.y, SHORT_BOX.px, SHORT_BOX.px);
    write(shot.caption ?? '', 60, SHORT_BOX.y + SHORT_BOX.px / 2 + 26, 76, BONE, 700, 'sans');
  }

  // the stats: length and the death counter
  const statsY = 1290;
  const length = String(g.length ?? '-');
  write(length, 48, statsY, 110, FG, 600, 'mono');
  write('LENGTH', 48 + measureText(length, 110, 600, 'mono') + 20, statsY, 44, MUTE, 500, 'mono');
  write(`DEATHS ${g.deaths ?? 0}`, SHORT_W - 48, statsY, 56, FOOD, 600, 'mono', 'right');

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
    if (row) write(clip(`${row.handle} ${row.what}`, 44, W, 500, 'sans'), 48, 1740, 44, FG2, 500, 'sans');
    else write('No trades on this move', 48, 1740, 44, MUTE, 400, 'sans');
  }
  write('telarchy.com/snake', SHORT_W - 48, 1872, 48, BONE, 600, 'sans', 'right');
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
