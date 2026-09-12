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
/**
 * Reads per READER per minute (docs/snake.md, "The feed"): the HTTP server
 * shares its event loop with the decision at :58, so no one reader may push
 * that late. A minute's window, cleared as it ages.
 *
 * The number is high because it exists to stop one client hammering, not to
 * ration ordinary reading: the board polls twice a second between its state
 * and its replay, and the floor's proxy reads for every visitor it serves.
 * At 60 a single board tab reached the cap by itself, which is how the feed
 * came to answer 429 to the public on 2026-09-12.
 */
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

/** Loopback, i.e. this host: the stream and the operator's own tooling. */
function isLoopback(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Who to count this read against, or null for a reader that is never counted.
 *
 * Every public read arrives from Caddy on this same host, so the socket
 * address is the proxy's for all of them and counting it put the stream, the
 * floor's proxy and every visitor into one bucket. The forwarded chain names
 * the reader; its FIRST entry is the client, the rest are hops. A forwarded
 * header is only believed from loopback, because otherwise anyone could lift
 * their own limit by claiming to be a proxy.
 *
 * A loopback socket with no forwarded header is this host's own stream,
 * polling once a second forever, and is not counted at all.
 */
function readerKey(remote: string, forwardedFor: string | string[] | undefined): string | null {
  const local = isLoopback(remote);
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const first = (raw ?? '').split(',')[0].trim();
  if (local) return first || null;
  return remote;
}

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
    const key = readerKey(req.socket.remoteAddress ?? 'unknown', req.headers['x-forwarded-for']);
    const retry = key === null ? null : overRate(key, Date.now());
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
