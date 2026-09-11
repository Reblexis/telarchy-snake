// The HTTP surface: the board page, /state, /replay, /games and /history
// (docs/snake.md "The board" and "The feed").
import http from 'node:http';
import type { Operator } from './operator.js';
import { HISTORY_LIMIT } from './gamelog.js';

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

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
  const json = (status: number, body: unknown) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify(body)); };
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
    res.writeHead(404); res.end('not found');
  }
}
