import { describe, it, expect } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { drawThumbnail, pickMove, THUMB, BADGE_BOX } from '../src/thumbnail.js';
import { survivableOptions } from '../src/moments.js';
import type { LogStep } from '../src/gamelog.js';

// docs/level-video.md, "Thumbnails".

const at = (i: number) => new Date(Date.parse('2026-09-11T20:00:00Z') + i * 60_000).toISOString();
type Cell = { x: number; y: number };
/** A level walking a serpentine, growing every other move; prices recorded, forward leading by 3. */
function level(size: number, moves: number): LogStep[] {
  const path: Cell[] = [];
  for (let y = 0; y < size; y++) for (let k = 0; k < size; k++) path.push({ x: y % 2 ? size - 1 - k : k, y });
  const out: LogStep[] = [];
  let length = 2;
  for (let i = 0; i <= moves; i++) {
    if (i > 0 && i % 2 === 0 && length < size * size - 1) length++;
    const headAt = Math.min(path.length - 1, length - 1 + Math.floor(i / 2) % 3);
    const snake = path.slice(Math.max(0, headAt - length + 1), headAt + 1).reverse();
    const heading = snake.length > 1 ? (snake[0].x > snake[1].x ? 'right' : snake[0].x < snake[1].x ? 'left' : 'down') : 'right';
    out.push({ step: i, at: at(i), snake, food: path[Math.min(path.length - 1, headAt + 2)], heading, action: i ? 'forward' : null, direction: heading, undecided: false, prices: { forward: 12 + i / 10, left: 9, right: 8 }, length: snake.length, deaths: 0 } as LogStep);
  }
  return out;
}
const pixels = async (png: Buffer) => { const img = await loadImage(png); const c = createCanvas(img.width, img.height), ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data }; };

describe('thumbnails', () => {
  const kinds = ['driving', 'danger', 'works'] as const;
  it('each is 1280 by 720', async () => {
    expect(THUMB).toEqual({ w: 1280, h: 720 });
    for (const k of kinds) { const p = await pixels(drawThumbnail(k, level(6, 60), 6).png); expect([p.w, p.h]).toEqual([1280, 720]); }
  });
  it('carries at most four words, and none of them repeats the title', () => {
    const title = 'a prediction market plays snake (39,720 bets)';
    for (const k of kinds) {
      const { words } = drawThumbnail(k, level(6, 60), 6);
      expect(words.join(' ').split(/\s+/).length).toBeLessThanOrEqual(4);
      for (const w of words) expect(title).not.toContain(w.toLowerCase().replace(/[^a-z]/g, ''));
    }
  });
  it('the bottom right corner is left empty for the duration badge', async () => {
    for (const k of kinds) {
      const p = await pixels(drawThumbnail(k, level(6, 60), 6).png);
      for (let y = BADGE_BOX.y; y < BADGE_BOX.y + BADGE_BOX.h; y += 7) for (let x = BADGE_BOX.x; x < BADGE_BOX.x + BADGE_BOX.w; x += 7) {
        const o = (y * p.w + x) * 4;
        expect([p.data[o], p.data[o + 1], p.data[o + 2]], `${k} ${x},${y}`).toEqual([0x0b, 0x0b, 0x0e]);
      }
    }
  });
  it('shows a real position: a move of the level where the snake did not die and the prices were recorded', () => {
    const entries = level(6, 60);
    for (const k of kinds) {
      const i = pickMove(k, entries, 6);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i + 1).toBeLessThan(entries.length);
      expect(entries[i + 1].deaths).toBe(entries[i].deaths);
    }
  });
  it('WHO\'S DRIVING? puts the head in the right half of the board when such a position exists', () => {
    const entries = level(6, 60);
    const i = pickMove('driving', entries, 6);
    const candidates = entries.filter((e, k) => k + 1 < entries.length && e.snake[0].x >= 3 && e.snake[0].x < 5 && e.snake[0].y >= 1 && e.snake[0].y < 5 && e.length >= 7 && e.length <= 18);
    if (candidates.length) expect(entries[i].snake[0].x).toBeGreaterThanOrEqual(3);
  });
  it('DON\'T TURN. shows a position with one way out when the level has one', () => {
    const entries = level(4, 40);
    const i = pickMove('danger', entries, 4);
    const any = entries.some((e, k) => k + 1 < entries.length && e.length >= 5 && survivableOptions(e, 4) === 1);
    if (any) expect(survivableOptions(entries[i], 4)).toBe(1);
  });
  it('THIS ACTUALLY WORKS? shows a grid at least 85 percent full when the level reaches it', () => {
    const entries = level(6, 80);
    const i = pickMove('works', entries, 6);
    if (entries.some(e => e.length >= 36 * 0.85 && e.length < 36)) expect(entries[i].length).toBeGreaterThanOrEqual(Math.ceil(36 * 0.85));
  });
});
