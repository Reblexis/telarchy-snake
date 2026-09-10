// The process: engine + operator loop + board + /state, docs/snake.md "Operation".
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Operator } from './operator.js';
import { HttpTelarchyClient } from './client.js';

const env = (k: string, d?: string) => process.env[k] ?? d ?? (() => { throw new Error(`missing env ${k}`); })();
const BASE = env('TELARCHY_BASE_URL', 'https://telarchy.com/api');
const KEY = env('TELARCHY_API_KEY', '');
const SESSION_EMAIL = process.env.TELARCHY_SESSION_EMAIL;
const SESSION_PASSWORD = process.env.TELARCHY_SESSION_PASSWORD;
const AUTH_URL = env('TELARCHY_AUTH_URL', 'https://telarchy.com/api');
if (!KEY && !SESSION_EMAIL) throw new Error('set TELARCHY_API_KEY or TELARCHY_SESSION_EMAIL/PASSWORD');
const WS = env('TELARCHY_WORKSPACE_ID');
const METRIC = env('TELARCHY_METRIC_ID');
const PORT = Number(env('PORT', '8802'));
const STATE = env('STATE_FILE', 'state/snake.json');
const PUBLIC_WS_URL = env('WORKSPACE_URL', 'https://telarchy.com/snake');
const BOARD_URL = env('BOARD_URL', 'https://snake.telarchy.com');
const OPTS = { boardUrl: BOARD_URL, workspaceId: WS, metricId: METRIC };

const client = new HttpTelarchyClient({
  baseUrl: BASE, apiKey: KEY, workspaceId: WS, metricId: METRIC, workspaceUrl: PUBLIC_WS_URL,
  session: SESSION_EMAIL ? { email: SESSION_EMAIL, password: SESSION_PASSWORD ?? '', authUrl: AUTH_URL } : undefined,
});

function load(): Operator {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    console.log(`resuming at step ${raw.game.step}`);
    return Operator.fromJSON(client, raw, Math.random, OPTS);
  } catch {
    console.log('fresh game');
    return Operator.fresh(client, Math.random, OPTS);
  }
}
function save(op: Operator) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  const tmp = `${STATE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(op.toJSON()));
  fs.renameSync(tmp, STATE);
}

const op = load();
const boardHtml = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'board', 'index.html'));

http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(op.publicState(new Date())));
  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(boardHtml);
  } else {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => console.log(`board on :${PORT}`));

// Scheduler: :00 tick (move + post), :55 close (decide). Wall-clock driven so a
// long API call never drifts the minute; a missed second is caught up.
let busy = false;
let lastTickMinute = -1;
let lastCloseMinute = -1;
let lastPoll = 0;
async function loop() {
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  const sec = now.getUTCSeconds();
  if (busy) return;
  busy = true;
  try {
    if (!op.open && lastTickMinute !== minute) {
      lastTickMinute = minute;
      await op.openStep(now);
      save(op);
    } else if (sec >= 58 && op.open && !op.open.decision && lastCloseMinute !== minute) {
      lastCloseMinute = minute;
      await op.closeStep(now);
      save(op);
    } else if (op.open && !op.open.decision && sec < 58 && now.getTime() - lastPoll >= 5_000) {
      lastPoll = now.getTime();
      await op.pollQuotes(now);
    } else if (sec < 58 && op.open && op.open.decision && lastTickMinute !== minute) {
      lastTickMinute = minute;
      await op.tick(now);
      save(op);
      const d = op.decisions[op.decisions.length - 1];
      console.log(`step ${d.step} ${d.direction}${d.undecided ? ' (undecided)' : ''} length ${d.lengthBefore} -> ${d.lengthAfter}`);
    }
  } catch (e) {
    console.error('loop error', (e as Error).message);
  } finally {
    busy = false;
  }
}
setInterval(loop, 500);
