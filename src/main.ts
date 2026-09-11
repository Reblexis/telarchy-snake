// The process: engine + operator loop + board + /state, docs/snake.md "Operation".
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Operator } from './operator.js';
import { HttpTelarchyClient } from './client.js';
import { GameLog } from './gamelog.js';
import { createServer } from './server.js';

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
/** docs/snake.md "The feed": the game log lives beside the state file. */
const GAMES_DIR = env('GAMES_DIR', path.join(path.dirname(STATE), 'games'));
const OPTS = { boardUrl: BOARD_URL, workspaceId: WS, metricId: METRIC, log: new GameLog(GAMES_DIR) };

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

createServer(op, boardHtml).listen(PORT, () => console.log(`board on :${PORT}`));

// Scheduler: :00 tick (move + post), :58 close (decide). Wall-clock driven so a
// long API call never drifts the minute; a missed second is caught up. Every
// call is bounded (client timeouts, docs/snake.md "The step"), so `busy` can
// hold the loop for at most one bound, never past a deadline.
let busy = false;
let lastTickMinute = -1;
let lastCloseMinute = -1;
let lastPoll = 0;
let lastActivity = 0;
/** docs/snake.md "The feed": the activity reads run on their own timer, every ten seconds. */
const ACTIVITY_EVERY_MS = 10_000;
async function loop() {
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  const sec = now.getUTCSeconds();
  if (busy) return;
  busy = true;
  try {
    if (!op.open && lastTickMinute !== minute && op.canOpen(now)) {
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
      console.log(`step ${d.step} ${d.direction}${d.undecided ? ` (undecided: ${d.undecidedReason})` : ''} length ${d.lengthBefore} -> ${d.lengthAfter}`);
    } else if (now.getTime() - lastActivity >= ACTIVITY_EVERY_MS) {
      lastActivity = now.getTime();
      await op.pollActivity(now);
    }
  } catch (e) {
    console.error('loop error', (e as Error).message);
  } finally {
    busy = false;
  }
}
setInterval(loop, 500);
