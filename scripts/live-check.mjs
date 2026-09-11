// Does the floor update itself, without a reader touching it? Opens
// telarchy.com/snake in a headless browser, keeps it open across a step, and
// reports what changed on its own (docs/snake.md, "Operation"). Needs a
// chrome on PATH; run it from anywhere:
//   node scripts/live-check.mjs https://telarchy.com/snake 150
// Open the floor once, keep it open, and watch whether it updates itself.
import { spawn } from 'node:child_process';
const URL_ = process.argv[2] ?? 'https://telarchy.com/snake';
const WAIT = Number(process.argv[3] ?? 150);
const chrome = spawn('google-chrome', ['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=9333','--user-data-dir=/tmp/claude-1000/cdp-profile', URL_], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(6000);
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find(t => t.type === 'page' && t.url.includes('telarchy'));
if (!page) { console.log('no page'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (method, params) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const probe = `(() => ({
  next: document.querySelector('.snake-next')?.textContent ?? null,
  clock: document.querySelector('.snake-clock')?.textContent ?? null,
  arrows: [...document.querySelectorAll('a.snake-arrow-link')].map(a => a.getAttribute('href')),
  rows: [...document.querySelectorAll('[class*="job"], [class*="ballot"], [class*="prow"]')].map(e => e.textContent?.trim().slice(0,40)).filter(t => t && /#\\d+/.test(t)).slice(0,6),
  head: document.querySelector('.snake-head-mark')?.getAttribute('style') ?? null,
}))()`;
const read = async () => (await send('Runtime.evaluate', { expression: probe, returnByValue: true })).result.value;
const a = await read();
console.log('T0 ', JSON.stringify(a));
await sleep(WAIT * 1000);
const b = await read();
console.log('T+'+WAIT, JSON.stringify(b));
const changed = { next: a.next !== b.next, clock: a.clock !== b.clock, arrows: JSON.stringify(a.arrows) !== JSON.stringify(b.arrows), rows: JSON.stringify(a.rows) !== JSON.stringify(b.rows) };
const live = changed.next || changed.arrows || changed.rows;
console.log(live ? 'LIVE: the floor moved on its own' : 'STUCK: nothing changed in ' + WAIT + 's');
console.log('CHANGED next:', a.next !== b.next, '| clock:', a.clock !== b.clock, '| arrows:', JSON.stringify(a.arrows) !== JSON.stringify(b.arrows), '| rows:', JSON.stringify(a.rows) !== JSON.stringify(b.rows), '| head:', a.head !== b.head);
ws.close(); chrome.kill(); process.exit(live ? 0 : 1);
