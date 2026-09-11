import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/board/index.html', import.meta.url), 'utf8');
const doc = fs.readFileSync(new URL('../docs/snake.md', import.meta.url), 'utf8');

describe('the board page (docs/snake.md, "The board")', () => {
  it('has a slot for each element the doc lists', () => {
    for (const id of ['next', 'commentary', 'cards', 'ticker', 'traders', 'leaderboard', 'log', 'best', 'tradersToday']) {
      expect(html, id).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it('the embed hides the traders list, the leaderboard and the decisions table, and keeps the next move and the ticker', () => {
    const embedRules = html.split('\n').filter(l => l.includes('.embed ') && l.includes('display:none')).join('\n');
    for (const hidden of ['#traders', '#leaderboard', '.tscroll']) expect(embedRules, hidden).toContain(hidden);
    for (const kept of ['#next', '#ticker', '#cards']) expect(embedRules, kept).not.toContain(kept);
  });

  it('body text is left-aligned: no centred block', () => {
    expect(html).not.toMatch(/text-align:\s*center/);
  });

  it('no em-dash or en-dash anywhere in the board, the doc or the sources', () => {
    const files = ['../src/board/index.html', '../docs/snake.md', '../src/frame.ts', '../src/commentary.ts', '../src/operator.ts', '../src/client.ts'];
    for (const f of files) expect(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/[–—]/);
    void doc;
  });

  it('reads the ticker from recentTrades and the next move from next', () => {
    expect(html).toContain('recentTrades');
    expect(html).toContain('s.next');
    expect(html).toContain('s.commentary');
    expect(html).toContain('s.leaderboard');
    expect(html).toContain('s.traders');
  });
});
