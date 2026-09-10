// The stream frame, docs/snake.md "The stream": the board drawn straight into
// an RGB buffer, no browser. A 5x7 bitmap font carries the numbers and labels.
import { GRID } from './engine.js';
import { impact60 } from './decide.js';

export const WIDTH = 1280;
export const HEIGHT = 720;
type RGB = [number, number, number];

const BG: RGB = [11, 13, 16];
const BOARD: RGB = [16, 19, 24];
const GRIDLINE: RGB = [24, 28, 34];
const SNAKE: RGB = [74, 222, 128];
const HEAD: RGB = [187, 247, 208];
const FOOD: RGB = [248, 113, 113];
const FG: RGB = [232, 230, 225];
const MUTE: RGB = [139, 143, 152];
const LEAD: RGB = [250, 204, 21];
const CARD: RGB = [34, 38, 44];

const MARGIN = 24;
const BOARD_PX = HEIGHT - 2 * MARGIN; // 672
const CELL = Math.floor(BOARD_PX / GRID); // 33

export function cellRect(x: number, y: number) {
  return { x: MARGIN + x * CELL, y: MARGIN + y * CELL, w: CELL, h: CELL };
}

function fill(buf: Buffer, x: number, y: number, w: number, h: number, c: RGB) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(WIDTH, x + w), y1 = Math.min(HEIGHT, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * WIDTH + x0) * 3;
    for (let xx = x0; xx < x1; xx++) { buf[i++] = c[0]; buf[i++] = c[1]; buf[i++] = c[2]; }
  }
}

// 5x7 glyphs, rows top to bottom, bit 4 = leftmost column.
const GLYPHS: Record<string, number[]> = {
  '0': [0x0e,0x11,0x13,0x15,0x19,0x11,0x0e], '1': [0x04,0x0c,0x04,0x04,0x04,0x04,0x0e],
  '2': [0x0e,0x11,0x01,0x02,0x04,0x08,0x1f], '3': [0x1f,0x02,0x04,0x02,0x01,0x11,0x0e],
  '4': [0x02,0x06,0x0a,0x12,0x1f,0x02,0x02], '5': [0x1f,0x10,0x1e,0x01,0x01,0x11,0x0e],
  '6': [0x06,0x08,0x10,0x1e,0x11,0x11,0x0e], '7': [0x1f,0x01,0x02,0x04,0x08,0x08,0x08],
  '8': [0x0e,0x11,0x11,0x0e,0x11,0x11,0x0e], '9': [0x0e,0x11,0x11,0x0f,0x01,0x02,0x0c],
  'A': [0x0e,0x11,0x11,0x1f,0x11,0x11,0x11], 'B': [0x1e,0x11,0x11,0x1e,0x11,0x11,0x1e],
  'C': [0x0e,0x11,0x10,0x10,0x10,0x11,0x0e], 'D': [0x1c,0x12,0x11,0x11,0x11,0x12,0x1c],
  'E': [0x1f,0x10,0x10,0x1e,0x10,0x10,0x1f], 'F': [0x1f,0x10,0x10,0x1e,0x10,0x10,0x10],
  'G': [0x0e,0x11,0x10,0x17,0x11,0x11,0x0f], 'H': [0x11,0x11,0x11,0x1f,0x11,0x11,0x11],
  'I': [0x0e,0x04,0x04,0x04,0x04,0x04,0x0e], 'J': [0x07,0x02,0x02,0x02,0x02,0x12,0x0c],
  'K': [0x11,0x12,0x14,0x18,0x14,0x12,0x11], 'L': [0x10,0x10,0x10,0x10,0x10,0x10,0x1f],
  'M': [0x11,0x1b,0x15,0x15,0x11,0x11,0x11], 'N': [0x11,0x11,0x19,0x15,0x13,0x11,0x11],
  'O': [0x0e,0x11,0x11,0x11,0x11,0x11,0x0e], 'P': [0x1e,0x11,0x11,0x1e,0x10,0x10,0x10],
  'Q': [0x0e,0x11,0x11,0x11,0x15,0x12,0x0d], 'R': [0x1e,0x11,0x11,0x1e,0x14,0x12,0x11],
  'S': [0x0f,0x10,0x10,0x0e,0x01,0x01,0x1e], 'T': [0x1f,0x04,0x04,0x04,0x04,0x04,0x04],
  'U': [0x11,0x11,0x11,0x11,0x11,0x11,0x0e], 'V': [0x11,0x11,0x11,0x11,0x11,0x0a,0x04],
  'W': [0x11,0x11,0x11,0x15,0x15,0x15,0x0a], 'X': [0x11,0x11,0x0a,0x04,0x0a,0x11,0x11],
  'Y': [0x11,0x11,0x11,0x0a,0x04,0x04,0x04], 'Z': [0x1f,0x01,0x02,0x04,0x08,0x10,0x1f],
  ' ': [0,0,0,0,0,0,0], '.': [0,0,0,0,0,0x0c,0x0c], ':': [0,0x0c,0x0c,0,0x0c,0x0c,0],
  '-': [0,0,0,0x1f,0,0,0], '/': [0x01,0x02,0x02,0x04,0x08,0x08,0x10], '?': [0x0e,0x11,0x01,0x02,0x04,0,0x04],
  '#': [0x0a,0x0a,0x1f,0x0a,0x1f,0x0a,0x0a], '(': [0x02,0x04,0x08,0x08,0x08,0x04,0x02], ')': [0x08,0x04,0x02,0x02,0x02,0x04,0x08],
  '>': [0x08,0x04,0x02,0x01,0x02,0x04,0x08], '^': [0x04,0x0a,0x11,0,0,0,0], 'v': [0,0,0,0x11,0x0a,0x04,0], '<': [0x02,0x04,0x08,0x10,0x08,0x04,0x02],
};

export function measureText(s: string, scale: number): number {
  return s.length === 0 ? 0 : s.length * 6 * scale - scale;
}

export function drawText(buf: Buffer, x: number, y: number, s: string, scale: number, c: RGB) {
  let cx = x;
  for (const ch of s) {
    const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
    for (let r = 0; r < 7; r++) for (let col = 0; col < 5; col++) {
      if (g[r] & (1 << (4 - col))) fill(buf, cx + col * scale, y + r * scale, scale, scale, c);
    }
    cx += 6 * scale;
  }
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '-' : (Math.round(v * 10) / 10).toString());
const ARROW: Record<string, string> = { up: '^', right: '>', down: 'v', left: '<' };

export function renderFrame(s: any): Buffer {
  const buf = Buffer.alloc(WIDTH * HEIGHT * 3);
  fill(buf, 0, 0, WIDTH, HEIGHT, BG);
  // board
  fill(buf, MARGIN, MARGIN, CELL * GRID, CELL * GRID, BOARD);
  for (let i = 0; i <= GRID; i++) {
    fill(buf, MARGIN + i * CELL, MARGIN, 1, CELL * GRID, GRIDLINE);
    fill(buf, MARGIN, MARGIN + i * CELL, CELL * GRID, 1, GRIDLINE);
  }
  const g = s.game;
  const fr = cellRect(g.food.x, g.food.y);
  fill(buf, fr.x + 8, fr.y + 8, fr.w - 16, fr.h - 16, FOOD);
  g.snake.forEach((c: { x: number; y: number }, i: number) => {
    const r = cellRect(c.x, c.y);
    fill(buf, r.x + 2, r.y + 2, r.w - 4, r.h - 4, i === 0 ? HEAD : SNAKE);
  });

  // right column
  const X = MARGIN + CELL * GRID + 40; // 724
  let y = MARGIN + 8;
  drawText(buf, X, y, 'FUTARCHY SNAKE', 4, FG); y += 40;
  drawText(buf, X, y, 'THE MARKET PICKS EVERY MOVE', 2, MUTE); y += 36;
  drawText(buf, X, y, `LENGTH ${g.length}`, 5, FG);
  drawText(buf, X + 300, y, `DEATHS ${s.deathsToday ?? 0}`, 3, MUTE);
  drawText(buf, X + 300, y + 22, `STEP ${g.step}`, 3, MUTE); y += 56;

  if (s.open) {
    const secs = s.secondsToDecision ?? Math.max(0, Math.round((Date.parse(s.open.decideAt) - Date.now()) / 1000));
    drawText(buf, X, y, `STEP ${s.open.step}: WHICH WAY? DECIDES IN ${secs}S`, 2, FG); y += 28;
    let best: string | null = null, bp = -Infinity;
    for (const d of ['up', 'right', 'down', 'left']) {
      const p = impact60(s.open.quotes?.[d]);
      if (p !== null && p > bp) { bp = p; best = d; }
    }
    const cw = 250, chh = 96;
    (['up', 'right', 'down', 'left'] as const).forEach((d, i) => {
      const cx = X + (i % 2) * (cw + 16), cy = y + Math.floor(i / 2) * (chh + 12);
      fill(buf, cx, cy, cw, chh, CARD);
      if (d === best) { fill(buf, cx, cy, cw, 4, LEAD); fill(buf, cx, cy, 4, chh, LEAD); }
      const q = s.open.quotes?.[d] ?? {};
      const imp = impact60(q);
      drawText(buf, cx + 12, cy + 12, `${ARROW[d]} MOVE ${d.toUpperCase()}`, 2, d === best ? LEAD : FG);
      drawText(buf, cx + 12, cy + 38, imp === null ? '-' : `${imp >= 0 ? '+' : ''}${fmt(imp)}`, 5, FG);
      drawText(buf, cx + 12, cy + 78, `IN 60  1:${fmt(q.m1?.approved)}  5:${fmt(q.m5?.approved)}  60:${fmt(q.m60?.approved)}`, 1, MUTE);
    });
    y += 2 * (chh + 12) + 8;
  } else if (s.complete) {
    drawText(buf, X, y, 'COMPLETE: THE SNAKE FILLED THE GRID', 2, LEAD); y += 40;
  } else {
    drawText(buf, X, y, 'WAITING FOR THE NEXT STEP', 2, MUTE); y += 40;
  }

  drawText(buf, X, y, 'LAST MOVES   IMPACT IN 60: ^   >   v   <   LENGTH', 2, MUTE); y += 22;
  const fi = (q: any) => { const v = impact60(q); return (v === null ? '-' : fmt(v)).padStart(4); };
  for (const d of (s.recentDecisions ?? []).slice(0, 8)) {
    const row = `${String(d.step).padStart(5)} ${ARROW[d.direction]}${d.undecided ? '?' : ' '} ${fi(d.quotes.up)} ${fi(d.quotes.right)} ${fi(d.quotes.down)} ${fi(d.quotes.left)}  ${d.lengthBefore}>${d.lengthAfter ?? '..'}`;
    drawText(buf, X, y, row, 2, FG); y += 20;
    if (y > HEIGHT - 40) break;
  }
  drawText(buf, X, HEIGHT - MARGIN - 14, 'TRADE YOUR MOVE AT TELARCHY.COM/SNAKE', 2, MUTE);
  return buf;
}
