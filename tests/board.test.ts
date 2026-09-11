import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/board/index.html', import.meta.url), 'utf8');

/** The ids inside one element's markup (its own id excluded). */
function idsIn(section: string): string[] {
  return [...section.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
}
const first = html.slice(html.indexOf('<main id="first"'), html.indexOf('</main>'));
const more = html.slice(html.indexOf('<details id="more"'), html.indexOf('</details>'));
const styles = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

describe('the board page (docs/snake.md, "The board")', () => {
  it('the first screen holds exactly the grid, the next move, the tiles, the status line and the quiet line, in that order', () => {
    expect(first.length).toBeGreaterThan(0);
    expect(idsIn(first)).toEqual(['first', 'c', 'next', 'clock', 'tiles', 'status', 'quiet']);
  });

  it('two tabs, Live and Replay, in one row above the first screen and nothing else above it; Live is the default', () => {
    const tabs = html.slice(html.indexOf('<nav id="tabs"'), html.indexOf('</nav>'));
    expect(tabs.length).toBeGreaterThan(0);
    expect(html.indexOf('<nav id="tabs"')).toBeLessThan(html.indexOf('<main id="first"'));
    expect(html.slice(html.indexOf('<body>'), html.indexOf('<nav id="tabs"')).trim()).toBe('<body>');
    expect(tabs.match(/<a\b/g)?.length).toBe(2);
    expect(tabs).toMatch(/>Live</);
    expect(tabs).toMatch(/>Replay</);
    expect(html).toMatch(/<main id="first"(?![^>]*hidden)/);
    expect(html).toMatch(/<section id="replay"[^>]*\shidden/);
  });

  it('the replay tab holds the grid, the timeline (slider, play, game picker) and one caption line, in that order', () => {
    const replay = html.slice(html.indexOf('<section id="replay"'), html.indexOf('</section>', html.indexOf('<section id="replay"')));
    expect(idsIn(replay)).toEqual(['replay', 'rc', 'timeline', 'play', 'slider', 'games', 'caption']);
    expect(replay).toMatch(/<input[^>]*type="range"[^>]*id="slider"/);
    expect(replay).toMatch(/<select[^>]*id="games"/);
    expect(replay).toMatch(/<canvas[^>]*id="rc"/);
  });

  it('the replay is rebuilt from /replay with from=<moves held>, replayed through the rules, and follows the newest move', () => {
    expect(html).toMatch(/\/replay\?game=/);
    expect(html).toMatch(/from=/);
    expect(html).toMatch(/died/);
    expect(html).toContain('m.food');
    expect(html).toMatch(/follow/);
    expect(html).toMatch(/10 moves a second|100\b/);
  });

  it('the tab row is kept in the embed, with More and the footer still hidden', () => {
    const embedRules = styles.split('\n').filter(l => l.includes('.embed ') && l.includes('display:none')).join('\n');
    expect(embedRules).not.toContain('#tabs');
  });

  it('everything else is behind a More section that is a details element, closed by default', () => {
    expect(more.length).toBeGreaterThan(0);
    expect(more).not.toMatch(/<details[^>]*\sopen/);
    for (const id of ['prices', 'traders', 'ticker', 'leaderboard', 'log', 'counters', 'rule']) expect(idsIn(more), id).toContain(id);
    expect(html.indexOf('<details id="more"')).toBeGreaterThan(html.indexOf('</main>'));
  });

  it('the embed renders the first screen alone: More and the footer are hidden', () => {
    const embedRules = styles.split('\n').filter(l => l.includes('.embed ') && l.includes('display:none')).join('\n');
    for (const hidden of ['#more', '.foot']) expect(embedRules, hidden).toContain(hidden);
    for (const kept of ['#next', '#tiles', '#status', '#quiet', '#c']) expect(embedRules, kept).not.toContain(kept);
  });

  it('the footer is one short line with the workspace, the stream and /state', () => {
    const foot = html.slice(html.indexOf('class="foot"'), html.indexOf('</p>', html.indexOf('class="foot"')));
    expect(foot).toContain('telarchy.com/snake');
    expect(foot).toContain('twitch.tv/telarchy');
    expect(foot).toContain('href="/state"');
  });

  it('prices one horizon: no 1-move or 5-move column, no near-horizon label, and the status line carries the record', () => {
    expect(html).not.toMatch(/1 move|5 moves|m1|m5\b/);
    expect(html).toMatch(/Record \$\{s\.bestLength/);
  });

  it('the provisioning script creates the one metric, Max length achieved, on the +60min horizon alone', () => {
    const sh = fs.readFileSync(new URL('../scripts/provision.sh', import.meta.url), 'utf8');
    expect(sh).toContain('"name": "Max length achieved"');
    expect(sh).toMatch(/"customHorizons": \["\+60min"\]/);
    expect(sh).not.toMatch(/\+1min|\+5min/);
  });

  it('body text is left-aligned: no centred block', () => {
    expect(html).not.toMatch(/text-align:\s*center/);
  });

  it('no em-dash or en-dash anywhere in the board, the doc or the sources', () => {
    const files = ['../src/board/index.html', '../docs/snake.md', '../src/frame.ts', '../src/stream.ts', '../src/commentary.ts', '../src/operator.ts', '../src/client.ts'];
    for (const f of files) expect(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/[–—]/);
  });

  it('loads only Inter from Google Fonts as an external asset, with a system fallback', () => {
    const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map(m => m[1]).filter(u => !/telarchy\.com|twitch\.tv/.test(u));
    for (const u of external) expect(u).toMatch(/^https:\/\/fonts\.(googleapis|gstatic)\.com/);
    expect(html).toMatch(/font-family:\s*Inter,[^;]*system-ui/);
  });

  it('reads the quiet line from recentTrades then commentary, the next move from next, and the tiles from the open step', () => {
    expect(html).toContain('recentTrades');
    expect(html).toContain('s.next');
    expect(html).toContain('s.commentary');
    expect(html).toContain('s.leaderboard');
    expect(html).toContain('s.traders');
    expect(html).toContain('s.open.proposals');
  });
});
