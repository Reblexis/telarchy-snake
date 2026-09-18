// `npm run thumbnail`, docs/level-video.md "Thumbnails": three 1280x720 thumbnails for the series video,
// each a real frame of a level beside four words at most, for YouTube's Test and Compare.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { gameBoard, GAME } from './draw.js';
import { FONTS } from './frame.js';
import { directionsFrom, type Action } from './decide.js';
import { survivableOptions } from './moments.js';
import type { LogStep } from './gamelog.js';
import { loadLevel } from './render.js';

export const THUMB = { w: 1280, h: 720 } as const;
/** Kept empty: YouTube draws the duration badge here. */
export const BADGE_BOX = { x: 1110, y: 640, w: 170, h: 80 } as const;
const BG = '#0b0b0e', CREAM = '#f2ecdc', GOLD = '#fbbf24';
const HUE: Record<Action, string> = { left: '#38bdf8', forward: '#a78bfa', right: '#f472b6' };
const ORDER: Action[] = ['left', 'forward', 'right'];
const DELTA: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const priced = (e: LogStep) => ORDER.every(o => typeof e.prices?.[o] === 'number');
const inner = (e: LogStep, size: number, pad = 1) => { const h = e.snake[0]; return h.x >= pad && h.y >= pad && h.x < size - pad && h.y < size - pad; };
const bends = (e: LogStep) => e.snake.slice(2).filter((c, i) => (c.x - e.snake[i + 1].x !== e.snake[i + 1].x - e.snake[i].x) || (c.y - e.snake[i + 1].y !== e.snake[i + 1].y - e.snake[i].y)).length;

/** The move a thumbnail shows: `entries[i]` is the position, `entries[i + 1]` the move the market then played. */
export function pickMove(kind: 'driving' | 'danger' | 'works', entries: LogStep[], size: number): number {
  const ok = (i: number) => i + 1 < entries.length && entries[i + 1].deaths === entries[i].deaths && priced(entries[i + 1]) && !!entries[i + 1].action;
  const idx = entries.map((_, i) => i).filter(ok);
  const lead = (i: number) => { const p = ORDER.map(o => entries[i + 1].prices[o] as number).sort((a, b) => b - a); return p[0] - p[1]; };
  let pool: number[];
  // the head in the right half of the board, so the arrow from the options to it is short and crosses nothing
  if (kind === 'driving') pool = idx.filter(i => inner(entries[i], size) && entries[i].snake[0].x >= size / 2 && entries[i].length >= 7 && entries[i].length <= size * size * 0.5 && bends(entries[i]) >= 2 && lead(i) >= 1);
  else if (kind === 'danger') pool = idx.filter(i => entries[i].length >= 5 && survivableOptions(entries[i], size) === 1);
  else pool = idx.filter(i => entries[i].length >= size * size * 0.85 && entries[i].length < size * size);
  if (pool.length === 0) pool = idx;
  // the longest snake among the candidates reads best; ties go to the clearest market
  return pool.sort((a, b) => entries[b].length - entries[a].length || lead(b) - lead(a))[0] ?? 0;
}

function arrowShape(c: SKRSContext2D, cx: number, cy: number, dir: string, r: number, fill: string) {
  const [dx, dy] = DELTA[dir];
  c.save(); c.translate(cx, cy); c.rotate(Math.atan2(dy, dx));
  c.beginPath(); c.moveTo(r, 0); c.lineTo(-r * 0.2, -r * 0.85); c.lineTo(-r * 0.2, -r * 0.32); c.lineTo(-r, -r * 0.32); c.lineTo(-r, r * 0.32); c.lineTo(-r * 0.2, r * 0.32); c.lineTo(-r * 0.2, r * 0.85); c.closePath();
  c.fillStyle = fill; c.fill(); c.restore();
}

function goldArrow(c: SKRSContext2D, x0: number, y0: number, x1: number, y1: number, width: number) {
  const ang = Math.atan2(y1 - y0, x1 - x0), head = width * 2.4;
  c.strokeStyle = GOLD; c.lineWidth = width; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1 - Math.cos(ang) * head, y1 - Math.sin(ang) * head); c.stroke();
  c.save(); c.translate(x1, y1); c.rotate(ang); c.beginPath(); c.moveTo(0, 0); c.lineTo(-head * 1.3, -head * 0.8); c.lineTo(-head * 1.3, head * 0.8); c.closePath(); c.fillStyle = GOLD; c.fill(); c.restore();
}

export interface Thumbnail { png: Buffer; words: string[]; move: number }

export function drawThumbnail(kind: 'driving' | 'danger' | 'works', entries: LogStep[], size: number): Thumbnail {
  const canvas = createCanvas(THUMB.w, THUMB.h), c = canvas.getContext('2d');
  c.fillStyle = BG; c.fillRect(0, 0, THUMB.w, THUMB.h);
  const i = pickMove(kind, entries, size), e = entries[i], next = entries[i + 1] ?? e;
  const px = kind === 'danger' ? 640 : 600, bx = 40, by = (THUMB.h - px) / 2, cell = Math.floor(px / size);
  gameBoard(c, e.snake, e.heading, e.food, 0, size, { x: bx, y: by, px });
  const head = e.snake[0], hx = bx + head.x * cell + cell / 2, hy = by + head.y * cell + cell / 2;
  // the one focal point: the head, outlined in cream with a green glow
  if (kind !== 'works') {
    c.save(); c.shadowColor = GAME.bodyA; c.shadowBlur = 24; c.strokeStyle = CREAM; c.lineWidth = 6;
    c.beginPath(); c.roundRect(bx + head.x * cell + cell * 0.06, by + head.y * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.12); c.stroke(); c.restore();
  }
  // a soft vignette on the board's edges
  const g = c.createRadialGradient(bx + px / 2, by + px / 2, px * 0.45, bx + px / 2, by + px / 2, px * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
  c.fillStyle = g; c.fillRect(bx, by, cell * size, cell * size);

  const dirs = directionsFrom(e.heading), played = next.action as Action | null;
  const words = kind === 'driving' ? ['WHO’S', 'DRIVING?'] : kind === 'danger' ? ['DON’T', 'TURN.'] : ['THIS', 'ACTUALLY', 'WORKS?'];
  const fs = kind === 'driving' ? 104 : kind === 'danger' ? 116 : 92, tx = kind === 'danger' ? 735 : 690;
  c.font = `800 ${fs}px "${FONTS.sans}"`; c.fillStyle = CREAM; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  words.forEach((wd, k) => c.fillText(wd, tx, (kind === 'danger' ? 180 : kind === 'driving' ? 160 : 150) + k * (fs + (kind === 'danger' ? 4 : 6))));

  if (kind === 'driving') {
    ORDER.forEach((o, k) => {
      const y = 330 + k * 108, win = o === played;
      c.fillStyle = '#15151b'; c.fillRect(710, y, 490, 90);
      c.fillStyle = HUE[o]; c.fillRect(710, y, 8, 90);
      arrowShape(c, 775, y + 45, dirs[o], 29, HUE[o]);
      c.font = `600 64px "${FONTS.mono}"`; c.fillStyle = win ? CREAM : 'rgba(242,236,220,0.55)'; c.textAlign = 'right';
      c.fillText((next.prices[o] as number).toFixed(1), 1180, y + 68); c.textAlign = 'left';
      if (win) { c.strokeStyle = GOLD; c.lineWidth = 8; c.strokeRect(710, y, 490, 90); goldArrow(c, 706, y + 45, hx + cell * 0.62, hy, 16); }
    });
  } else if (kind === 'danger' && played) {
    c.fillStyle = '#15151b'; c.fillRect(760, 405, 440, 140);
    c.strokeStyle = GOLD; c.lineWidth = 8; c.strokeRect(760, 405, 440, 140);
    arrowShape(c, 850, 475, dirs[played], 48, HUE[played]);
    c.font = `600 76px "${FONTS.mono}"`; c.fillStyle = CREAM; c.textAlign = 'right'; c.fillText((next.prices[played] as number).toFixed(1), 1175, 503); c.textAlign = 'left';
    // the ways that would have killed it, outlined in red
    for (const o of ORDER) { if (o === played) continue; const [dx, dy] = DELTA[dirs[o]]; const nx = head.x + dx, ny = head.y + dy; if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      c.save(); c.shadowColor = '#ef4444'; c.shadowBlur = 20; c.strokeStyle = '#ef4444'; c.lineWidth = 10; c.strokeRect(bx + nx * cell + 8, by + ny * cell + 8, cell - 16, cell - 16); c.restore(); }
    const [pdx, pdy] = DELTA[dirs[played]];
    goldArrow(c, 756, 475, hx + pdx * cell * 0.95 + cell * 0.3, hy + pdy * cell * 0.95, 18);
  } else if (kind === 'works') {
    ORDER.forEach((o, k) => {
      const x = 730 + k * 165, win = o === played;
      c.fillStyle = '#15151b'; c.fillRect(x, 480, 145, 130);
      arrowShape(c, x + 72, 545, dirs[o], 38, HUE[o]);
      if (win) { c.strokeStyle = GOLD; c.lineWidth = 8; c.strokeRect(x, 480, 145, 130); goldArrow(c, 726, 545, bx + cell * size + 14, 545, 16); }
    });
  }
  // the duration badge's corner stays empty
  c.fillStyle = BG; c.fillRect(BADGE_BOX.x, BADGE_BOX.y, BADGE_BOX.w, BADGE_BOX.h);
  return { png: canvas.toBuffer('image/png'), words, move: i + 1 };
}

if (process.argv[1]?.endsWith('thumbnail.ts') || process.argv[1]?.endsWith('thumbnail.js')) {
  mkdirSync('videos', { recursive: true });
  for (const [kind, level] of [['driving', 2], ['danger', 1], ['works', 3]] as const) {
    const { game, entries } = await loadLevel(level);
    const t = drawThumbnail(kind, entries, game.size);
    writeFileSync(`videos/thumbnail-${kind}.png`, t.png);
    console.error(`wrote videos/thumbnail-${kind}.png (level ${level}, move ${t.move})`);
  }
}
