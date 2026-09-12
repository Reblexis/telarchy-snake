// The HTTP surface: the board page, /state, /replay, /games and /history
// (docs/snake.md "The board" and "The feed").
import http from 'node:http';
import type { Operator } from './operator.js';
import { HISTORY_LIMIT } from './gamelog.js';

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
const ALLOW = 'GET, HEAD, OPTIONS';
const CORS_PREFLIGHT = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': ALLOW,
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};
/** Reads per client address per minute (docs/snake.md, "The feed"): the HTTP
 *  server shares its event loop with the decision at :58, so no reader may
 *  push that late. A minute's window, counted per address, cleared as it ages. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();
function overRate(addr: string, now: number): number | null {
  const seen = (hits.get(addr) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  seen.push(now);
  hits.set(addr, seen);
  // Cheap sweep so a long-lived process does not hold every address it ever saw.
  if (hits.size > 1_000) for (const [k, v] of hits) if (v.every(t => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  if (seen.length <= RATE_LIMIT) return null;
  return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - seen[0])) / 1000));
}

export function createServer(op: Operator, boardHtml: Buffer): http.Server {
  return http.createServer((req, res) => {
    handle(op, boardHtml, req, res).catch(e => {
      console.error('request error', (e as Error).message);
      if (!res.headersSent) res.writeHead(500, JSON_HEADERS);
      res.end('{"error":"internal"}');
    });
  });
}

async function handle(op: Operator, boardHtml: Buffer, req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...JSON_HEADERS, ...extra });
    res.end(JSON.stringify(body));
  };
  // The surface says no in JSON too (docs/snake.md, "The feed").
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_PREFLIGHT);
    res.end();
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return json(405, { error: 'method not allowed' }, { allow: ALLOW });
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    const retry = overRate(req.socket.remoteAddress ?? 'unknown', Date.now());
    if (retry !== null) return json(429, { error: 'too many requests' }, { 'retry-after': String(retry) });
  }
  if (url.pathname === '/state') {
    json(200, op.publicState(new Date()));
  } else if (url.pathname === '/replay') {
    // docs/snake.md "The feed": one game's record, its moves from `from` on.
    const game = url.searchParams.get('game');
    const from = Number(url.searchParams.get('from') ?? '0');
    const r = op.replay(game === null ? undefined : Number(game), Number.isFinite(from) ? from : 0);
    if (!r) return json(404, { error: 'no such game' });
    json(200, r);
  } else if (url.pathname === '/games') {
    json(200, { games: op.log?.games() ?? [] });
  } else if (url.pathname === '/history') {
    const gameParam = url.searchParams.get('game');
    const game = gameParam === null || gameParam === 'current' ? 'current' : Number(gameParam);
    const fromParam = url.searchParams.get('from');
    const from = fromParam === null ? undefined : Number(fromParam);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam === null ? HISTORY_LIMIT : Number(limitParam);
    const r = op.log ? await op.log.history(game, from, limit) : null;
    if (!r) return json(404, { error: 'no such game' });
    json(200, r);
  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(boardHtml);
  } else {
    json(404, { error: 'not found' });
  }
}
