// Level video maker, docs/level-video.md and docs/snake.md "The level videos":
// `npm run video -- <game> [--music <file>] [--credit "<line>"]` reads one complete game
// from public reads and writes the produced full cut and Short, each with its sidecar.
// Nothing is written when the game is refused.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { fillPricesFromTrades, nameTradesByProposal, readLevel, tradesByMove, type ProposalRead } from './level.js';
import { momentsOf } from './moments.js';
import { fullTimeline, shortTimeline, TL_FPS, type Segment } from './timeline.js';
import { frameCountOf, type FrameInfo } from './frames.js';
import { buildScene, drawFull, drawShort, FULL_SIZE, SHORT_SIZE, type Drawn, type Scene } from './draw.js';
import { musicTrack, wavOf } from './mixer.js';
import { cutSidecar, encodeArgs, musicDecodeArgs, muxArgs, productionFrames } from './produce.js';
import { pump } from './pump.js';
import { parseTruePeak, peakCorrectionDb } from './loudness.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const n = Number(argv[0]);
if (!Number.isInteger(n) || n < 1) {
  console.error('usage: npm run video -- <game number> [--music <audio file>] [--credit "<line>"] [--only full|short]');
  process.exit(2);
}
const musicPath = flag('--music');
const credit = flag('--credit');
const only = flag('--only');
if (musicPath && !existsSync(musicPath)) {
  console.error(`refused: no music file at ${musicPath}`);
  process.exit(1);
}
if (!musicPath) console.error('no --music: the cuts are silent');

let level;
try {
  level = await readLevel(n, {
    feedUrl: process.env.SNAKE_FEED_URL ?? 'https://snake.telarchy.com',
    telarchyUrl: process.env.TELARCHY_PUBLIC_URL ?? 'https://telarchy.com',
  });
} catch (e) {
  console.error(`refused: ${(e as Error).message}`);
  process.exit(1);
}
const { game, games } = level;
// which way each trade was bet, from its proposal (docs/snake.md); the reads are kept between renders
const telarchyUrl = (process.env.TELARCHY_PUBLIC_URL ?? 'https://telarchy.com').replace(/\/+$/, '');
const cachePath = 'videos/.cache/proposals.json';
mkdirSync('videos/.cache', { recursive: true });
const cache = new Map<string, ProposalRead | null>(existsSync(cachePath) ? Object.entries(JSON.parse(readFileSync(cachePath, 'utf8'))) : []);
const known = cache.size;
const slim = (p: ProposalRead): ProposalRead => ({ title: p.title, options: p.options ? true : null, conditionalMarketIds: p.conditionalMarketIds, markets: (p.markets ?? []).map(m => ({ options: (m.options ?? []).map(o => ({ id: o.id, marketId: o.marketId })) })) });
// the proposal read wants the workspace named; its id is public, on the floor's contracts read
let workspaceId = '';
try { workspaceId = String(((await (await fetch(`${telarchyUrl}/api/marketplace/snake/contracts`)).json()) as { workspaceId?: string }).workspaceId ?? ''); } catch { /* the trades then stay named by the price match alone */ }
const trades = await nameTradesByProposal(level.trades, async id => {
  if (!workspaceId) throw new Error('no workspace id');
  const r = await fetch(`${telarchyUrl}/api/proposals/${id}`, { headers: { 'X-Workspace-Id': workspaceId } });
  if (!r.ok) throw new Error(`proposal ${id} answered ${r.status}`);
  return slim((await r.json()) as ProposalRead);
}, cache);
writeFileSync(cachePath, JSON.stringify(Object.fromEntries(cache)));
console.error(`trades: ${trades.length}, named by proposal: ${trades.filter(t => t.option).length}, proposals read: ${cache.size - known}`);
const entries = fillPricesFromTrades(level.entries, tradesByMove(level.entries, trades));
const byMove = tradesByMove(entries, trades);
const moments = momentsOf(entries, game.size, byMove);
const scene = buildScene(game, games, entries, byMove);

async function run(args: string[]) {
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const [code] = await once(ff, 'exit');
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

async function decodeMusic(path: string): Promise<Float32Array> {
  const ff = spawn('ffmpeg', musicDecodeArgs(path), { stdio: ['ignore', 'pipe', 'inherit'] });
  const chunks: Buffer[] = [];
  ff.stdout.on('data', (d: Buffer) => chunks.push(d));
  const [code] = await once(ff, 'exit');
  if (code !== 0) throw new Error(`ffmpeg could not decode ${path}`);
  const all = Buffer.concat(chunks);
  const samples = new Float32Array(Math.floor(all.length / 4));
  for (let i = 0; i < samples.length; i++) samples[i] = all.readFloatLE(i * 4);
  return samples;
}

async function truePeakOf(file: string): Promise<number | null> {
  const ff = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', d => { err += String(d); });
  await once(ff, 'exit');
  return parseTruePeak(err);
}

async function encode(path: string, size: { w: number; h: number }, tl: Segment[], draw: (s: Scene, i: FrameInfo) => Drawn) {
  const ff = spawn('ffmpeg', encodeArgs(path, size), { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = once(ff, 'exit');
  ff.stdin.on('error', () => {});
  const total = frameCountOf(tl);
  const started = Date.now();
  function* logged() {
    let f = 0;
    for (const frame of productionFrames(scene, tl, draw)) {
      if (f % 900 === 0) console.error(`${path}: frame ${f}/${total}, ${Math.round((Date.now() - started) / 1000)} s`);
      f++;
      yield frame;
    }
  }
  await pump(logged(), { write: frame => ff.stdin.write(frame), drained: async () => { await once(ff.stdin, 'drain'); } });
  ff.stdin.end();
  const [code] = await exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

async function cut(kind: 'full' | 'short', music: Float32Array | null) {
  const name = kind === 'full' ? `snake-level-${n}` : `snake-level-${n}-short`;
  const tl = kind === 'full' ? fullTimeline(entries, game.size, byMove, moments) : shortTimeline(entries, game.size, byMove, moments);
  const total = frameCountOf(tl);
  const out = `videos/${name}.mp4`, video = `videos/${name}.video.mp4`, audio = `videos/${name}.mix.wav`, part = `videos/${name}.part.mp4`;
  console.error(`${name}: ${tl.length} segments, ${total} frames, ${(total / TL_FPS).toFixed(1)} s`);
  try {
    await encode(video, kind === 'full' ? FULL_SIZE : SHORT_SIZE, tl, kind === 'full' ? drawFull : drawShort);
    const mix = musicTrack(music, total, TL_FPS);
    writeFileSync(audio, wavOf(mix));
    // measure the encoded file and lower the mix until it cannot clip (docs/level-video.md, "Encoding")
    let gainDb = 0;
    for (let pass = 0; pass < 4; pass++) {
      await run(muxArgs({ video, audio, out: part, gainDb }));
      const peak = await truePeakOf(part);
      const correction = peak === null ? 0 : peakCorrectionDb(peak);
      console.error(`${name}: true peak ${peak} dBFS${correction ? `, lowering the mix ${correction.toFixed(1)} dB` : ''}`);
      if (correction === 0 || pass === 3) break;
      gainDb += correction;
    }
    renameSync(part, out);
    writeFileSync(`videos/${name}.json`, `${JSON.stringify(cutSidecar(kind, game, entries, trades, tl, credit), null, 2)}\n`);
    console.error(`wrote ${out} and videos/${name}.json`);
  } finally {
    for (const f of [video, audio, part]) rmSync(f, { force: true });
  }
}

mkdirSync('videos', { recursive: true });
try {
  const music = musicPath ? await decodeMusic(musicPath) : null;
  if (only !== 'short') await cut('full', music);
  if (only !== 'full') await cut('short', music);
} catch (e) {
  console.error(`render failed: ${(e as Error).message}`);
  process.exit(1);
}
