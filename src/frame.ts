// The stream frame, docs/snake.md "The stream": the board drawn straight into
// an RGB buffer, no browser. A 5x7 bitmap font carries the numbers and labels.
import { GRID } from './engine.js';
import { impact60, ACTIONS, ACTION_TITLE } from './decide.js';

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

export function cellRect(x: number, y: number, size: number = GRID) {
  const cell = Math.floor(BOARD_PX / size);
  return { x: MARGIN + x * cell, y: MARGIN + y * cell, w: cell, h: cell };
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
  '-': [0,0,0,0x1f,0,0,0], '+': [0,0x04,0x04,0x1f,0x04,0x04,0], '/': [0x01,0x02,0x02,0x04,0x08,0x08,0x10], '?': [0x0e,0x11,0x01,0x02,0x04,0,0x04],
  '#': [0x0a,0x0a,0x1f,0x0a,0x1f,0x0a,0x0a], '(': [0x02,0x04,0x08,0x08,0x08,0x04,0x02], ')': [0x08,0x04,0x02,0x02,0x02,0x04,0x08],
  '>': [0x08,0x04,0x02,0x01,0x02,0x04,0x08], '^': [0x04,0x0a,0x11,0,0,0,0], 'v': [0,0,0,0x11,0x0a,0x04,0], '<': [0x02,0x04,0x08,0x10,0x08,0x04,0x02],
  '_': [0,0,0,0,0,0,0x1f], ',': [0,0,0,0,0x0c,0x04,0x08], '!': [0x04,0x04,0x04,0x04,0x04,0,0x04], '=': [0,0,0x1f,0,0x1f,0,0],
  '*': [0,0x0a,0x04,0x1f,0x04,0x0a,0], "'": [0x04,0x04,0,0,0,0,0], '%': [0x18,0x19,0x02,0x04,0x08,0x13,0x03],
  '@': [0x0e,0x11,0x17,0x15,0x17,0x10,0x0e],
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
/** The next-move line's action words: short enough to fit beside the countdown at scale 3. */
export const NEXT_LABEL: Record<string, string> = { forward: 'FORWARD', left: 'TURN LEFT', right: 'TURN RIGHT' };

export function renderFrame(s: any): Buffer {
  const buf = Buffer.alloc(WIDTH * HEIGHT * 3);
  fill(buf, 0, 0, WIDTH, HEIGHT, BG);
  const g = s.game;
  const N: number = s.grid ?? g.size ?? GRID;
  const CELL = Math.floor(BOARD_PX / N);
  // board
  fill(buf, MARGIN, MARGIN, CELL * N, CELL * N, BOARD);
  for (let i = 0; i <= N; i++) {
    fill(buf, MARGIN + i * CELL, MARGIN, 1, CELL * N, GRIDLINE);
    fill(buf, MARGIN, MARGIN + i * CELL, CELL * N, 1, GRIDLINE);
  }
  const fr = cellRect(g.food.x, g.food.y, N);
  fill(buf, fr.x + 8, fr.y + 8, fr.w - 16, fr.h - 16, FOOD);
  g.snake.forEach((c: { x: number; y: number }, i: number) => {
    const r = cellRect(c.x, c.y, N);
    fill(buf, r.x + 2, r.y + 2, r.w - 4, r.h - 4, i === 0 ? HEAD : SNAKE);
  });
  // The heading, marked on the head: a bar on the edge the snake is moving towards.
  {
    const h = cellRect(g.snake[0].x, g.snake[0].y, N);
    const t = Math.max(3, Math.floor(h.w / 6));
    if (g.heading === 'up') fill(buf, h.x + 4, h.y + 2, h.w - 8, t, LEAD);
    if (g.heading === 'down') fill(buf, h.x + 4, h.y + h.h - 2 - t, h.w - 8, t, LEAD);
    if (g.heading === 'left') fill(buf, h.x + 2, h.y + 4, t, h.h - 8, LEAD);
    if (g.heading === 'right') fill(buf, h.x + h.w - 2 - t, h.y + 4, t, h.h - 8, LEAD);
  }

  // right column: 556 px wide from X, every line at scale 2 or larger so it reads at 720p.
  const X = MARGIN + CELL * GRID + 40; // 724
  const W = WIDTH - X - MARGIN; // 532
  const clip = (t: string, scale: number, w: number = W) => {
    const max = Math.floor((w + scale) / (6 * scale));
    return t.length > max ? t.slice(0, Math.max(0, max - 1)) + '.' : t;
  };
  /** Word-wrap to at most `lines` lines of the column's width. */
  const wrap = (t: string, scale: number, lines: number): string[] => {
    const max = Math.floor((W + scale) / (6 * scale));
    const out: string[] = [];
    let line = '';
    for (const w of t.split(' ')) {
      if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
      if (out.length === lines) break;
    }
    if (out.length < lines && line) out.push(line);
    return out.map(l => clip(l, scale));
  };
  const gameNo = s.gameNumber ?? g.gameNumber ?? 1;
  let y = MARGIN;
  drawText(buf, X, y, 'FUTARCHY SNAKE', 4, FG); y += 34;
  drawText(buf, X, y, clip(`GAME ${gameNo}  ${N}X${N}  THE MARKET PICKS EVERY MOVE`, 2), 2, MUTE); y += 22;
  drawText(buf, X, y, `LENGTH ${g.length}`, 4, FG);
  drawText(buf, X + 250, y + 4, `HEADING ${ARROW[g.heading]} ${String(g.heading).toUpperCase()}`, 3, LEAD); y += 30;
  drawText(buf, X, y, clip(`BEST ${s.bestLength ?? g.length}  DEATHS ${s.deathsToday ?? 0}  STEP ${g.step}  TRADERS TODAY ${s.tradersToday ?? 0}`, 2), 2, MUTE); y += 22;

  // the next move, large and yellow (docs/snake.md, "The board")
  const next = s.next ?? null;
  if (next) {
    const dir = String(next.direction).toUpperCase();
    drawText(buf, X, y, clip(`NEXT: ${NEXT_LABEL[next.action] ?? '?'} ${ARROW[next.direction] ?? ''} ${dir}`, 3, W - 130), 3, LEAD);
    const secs = next.decided ? 'DECIDED' : `IN ${s.secondsToDecision ?? next.seconds}S`;
    drawText(buf, X + W - measureText(secs, 3), y, secs, 3, next.decided ? LEAD : FG);
    y += 26;
  } else if (s.complete) {
    drawText(buf, X, y, 'COMPLETE: THE SNAKE FILLED THE GRID', 3, LEAD); y += 26;
  } else {
    drawText(buf, X, y, 'WAITING FOR THE NEXT STEP', 3, MUTE); y += 26;
  }
  for (const line of wrap(String(s.commentary ?? '').toUpperCase(), 2, 2)) { drawText(buf, X, y, line, 2, FG); y += 20; }
  if (!s.commentary) y += 20;
  y += 2;

  if (s.open) {
    let best: string | null = null, bp = -Infinity;
    for (const a of ACTIONS) {
      const p = impact60(s.open.quotes?.[a]);
      if (p !== null && p > bp) { bp = p; best = a; }
    }
    const cw = W, chh = 50;
    ACTIONS.forEach((a, i) => {
      const cx = X, cy = y + i * (chh + 6);
      fill(buf, cx, cy, cw, chh, CARD);
      if (a === best) { fill(buf, cx, cy, 4, chh, LEAD); }
      const q = s.open.quotes?.[a] ?? {};
      const imp = impact60(q);
      const dir = s.open.directions?.[a];
      drawText(buf, cx + 14, cy + 8, `${ACTION_TITLE[a].toUpperCase()}${dir ? `  ${ARROW[dir]} ${String(dir).toUpperCase()}` : ''}`, 2, a === best ? LEAD : FG);
      drawText(buf, cx + 14, cy + 30, clip(`+1 ${fmt(q.m1?.approved)}  +5 ${fmt(q.m5?.approved)}  +60 ${fmt(q.m60?.approved)}/${fmt(q.m60?.declined)}`, 2, cw - 125), 2, MUTE);
      const it = imp === null ? '-' : `${imp >= 0 ? '+' : ''}${fmt(imp)}`;
      drawText(buf, cx + cw - 14 - measureText(it, 4), cy + 11, it, 4, a === best ? LEAD : FG);
    });
    y += 3 * (chh + 6) + 6;
  } else if (s.complete) {
    if (s.nextGameAt) { const m = Math.max(0, Math.round((Date.parse(s.nextGameAt) - Date.now()) / 60_000)); drawText(buf, X, y, `NEXT GAME ON A ${N + 1}X${N + 1} GRID IN ${m} MIN`, 2, MUTE); }
    y += 24;
  }

  const hm = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '--:--' : d.toISOString().slice(11, 16); };
  const ACT: Record<string, string> = { forward: 'FWD', left: 'LEFT', right: 'RIGHT' };
  const HZ: Record<string, string> = { m1: '1', m5: '5', m60: '60' };
  const BR: Record<string, string> = { approved: 'A', declined: 'D' };
  const SD: Record<string, string> = { higher: 'HIGHER', lower: 'LOWER' };
  const SD2: Record<string, string> = { higher: 'HI', lower: 'LO' };
  const handle = (h: unknown, n: number) => String(h).toUpperCase().slice(0, n).padEnd(n);

  // current traders: up to three rows
  const traders: any[] = Array.isArray(s.traders) ? s.traders : [];
  const tn = s.tradersThisStep ?? new Set(traders.map(t => t.handle)).size;
  drawText(buf, X, y, clip(`TRADERS THIS STEP: ${tn}`, 2), 2, MUTE); y += 20;
  if (traders.length === 0) { drawText(buf, X, y, 'NO POSITIONS YET. YOURS COULD BE FIRST.', 2, FG); y += 20; }
  for (const t of traders.slice(0, 3)) {
    drawText(buf, X, y, clip(`${handle(t.handle, 12)} ${SD[t.side] ?? '?'} ${ACT[t.action] ?? '?'} ${HZ[t.horizon] ?? '?'} ${BR[t.branch] ?? '?'} ${fmt(t.cost)} CR${t.worth === null || t.worth === undefined ? '' : ` WORTH ${fmt(t.worth)}`}`, 2), 2, FG); y += 20;
  }
  y += 6;

  // last trades: up to five rows, newest first
  const trades: any[] = Array.isArray(s.recentTrades) ? s.recentTrades : [];
  drawText(buf, X, y, clip('LAST TRADES  (A/D = APPROVED/DECLINED BOOK)', 2), 2, MUTE); y += 20;
  if (trades.length === 0) { drawText(buf, X, y, 'NO TRADES YET', 2, FG); y += 20; }
  for (const t of trades.slice(0, 5)) {
    drawText(buf, X, y, clip(`${hm(t.at)} ${handle(t.handle, 9)} ${t.kind === 'sell' ? 'SELL' : 'BUY '} ${SD2[t.side] ?? '?'} ${ACT[t.action] ?? '?'} ${HZ[t.horizon] ?? '?'} ${BR[t.branch] ?? '?'} ${fmt(t.cost)}${t.price === null || t.price === undefined ? '' : ` @${fmt(t.price)}`}`, 2), 2, FG); y += 20;
  }
  y += 6;

  // leaderboard, top three, and the last decisions side by side
  const leaders: any[] = Array.isArray(s.leaderboard) ? s.leaderboard : [];
  const half = Math.floor(W / 2) - 8;
  drawText(buf, X, y, 'TOP TRADERS', 2, MUTE);
  drawText(buf, X + half + 16, y, 'LAST MOVES', 2, MUTE); y += 20;
  const fi = (q: any) => { const v = impact60(q); return v === null ? '-' : `${v >= 0 ? '+' : ''}${fmt(v)}`; };
  const decisions: any[] = (s.recentDecisions ?? []).slice(0, 3);
  for (let i = 0; i < 3; i++) {
    if (y > HEIGHT - MARGIN - 40) break;
    const l = leaders[i];
    if (l) drawText(buf, X, y, clip(`${l.rank}. ${String(l.handle).toUpperCase().padEnd(12).slice(0, 12)} ${l.profit >= 0 ? '+' : ''}${fmt(l.profit)}`, 2, half), 2, FG);
    else if (i === 0) drawText(buf, X, y, 'NOBODY YET', 2, FG);
    const d = decisions[i];
    if (d) drawText(buf, X + half + 16, y, clip(`${d.step} ${ACT[d.action] ?? '?'} ${ARROW[d.direction] ?? ''}${d.undecided ? '?' : ''} ${fi(d.quotes?.[d.action])} ${d.lengthBefore}>${d.lengthAfter ?? '..'}`, 2, half), 2, FG);
    y += 20;
  }
  drawText(buf, X, HEIGHT - MARGIN - 14, 'TRADE YOUR MOVE AT TELARCHY.COM/SNAKE', 2, MUTE);
  return buf;
}
