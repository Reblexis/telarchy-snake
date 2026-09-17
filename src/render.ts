// What every render command shares, docs/snake.md "The level videos": reading a level ready to draw
// (trades named, missing prices filled), encoding frames through ffmpeg, and putting the music beside them.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fillPricesFromTrades, nameTradesByProposal, readLevel, tradesByMove, type ProposalRead } from './level.js';
import { TL_FPS } from './timeline.js';
import { musicTrack, wavOf } from './mixer.js';
import { encodeArgs, musicDecodeArgs, muxArgs } from './produce.js';
import { pump } from './pump.js';
import { parseTruePeak, peakCorrectionDb } from './loudness.js';

const feedUrl = () => process.env.SNAKE_FEED_URL ?? 'https://snake.telarchy.com';
const telarchyUrl = () => (process.env.TELARCHY_PUBLIC_URL ?? 'https://telarchy.com').replace(/\/+$/, '');
const CACHE = 'videos/.cache/proposals.json';
let workspaceId: string | null = null;

/** One complete level, ready to draw: its trades named from their proposals (the reads kept between
 *  renders) and the prices the feed did not record filled from them. Throws when the level is refused. */
export async function loadLevel(n: number) {
  const level = await readLevel(n, { feedUrl: feedUrl(), telarchyUrl: telarchyUrl() });
  mkdirSync('videos/.cache', { recursive: true });
  const cache = new Map<string, ProposalRead | null>(existsSync(CACHE) ? Object.entries(JSON.parse(readFileSync(CACHE, 'utf8'))) : []);
  const known = cache.size;
  const slim = (p: ProposalRead): ProposalRead => ({ title: p.title, options: p.options ? true : null, conditionalMarketIds: p.conditionalMarketIds, markets: (p.markets ?? []).map(m => ({ options: (m.options ?? []).map(o => ({ id: o.id, marketId: o.marketId })) })) });
  // the proposal read wants the workspace named; its id is public, on the floor's contracts read
  if (workspaceId === null) {
    try { workspaceId = String(((await (await fetch(`${telarchyUrl()}/api/marketplace/snake/contracts`)).json()) as { workspaceId?: string }).workspaceId ?? ''); } catch { workspaceId = ''; }
  }
  const trades = await nameTradesByProposal(level.trades, async id => {
    if (!workspaceId) throw new Error('no workspace id');
    const r = await fetch(`${telarchyUrl()}/api/proposals/${id}`, { headers: { 'X-Workspace-Id': workspaceId } });
    if (!r.ok) throw new Error(`proposal ${id} answered ${r.status}`);
    return slim((await r.json()) as ProposalRead);
  }, cache);
  writeFileSync(CACHE, JSON.stringify(Object.fromEntries(cache)));
  console.error(`level ${n}: ${trades.length} trades, ${trades.filter(t => t.option).length} named by proposal, ${cache.size - known} proposals read`);
  const entries = fillPricesFromTrades(level.entries, tradesByMove(level.entries, trades));
  return { game: level.game, games: level.games, entries, trades, byMove: tradesByMove(entries, trades) };
}

async function run(args: string[]) {
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  const [code] = await once(ff, 'exit');
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

export async function decodeMusic(path: string): Promise<Float32Array> {
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

/** Encodes `total` frames to videos/<name>.mp4 with the music beside them; the peak is measured and the
 *  mix lowered until it cannot clip (docs/level-video.md, "Encoding"). */
export async function renderVideo(name: string, size: { w: number; h: number }, total: number, frames: Iterable<Buffer>, music: Float32Array[] | null) {
  const out = `videos/${name}.mp4`, video = `videos/${name}.video.mp4`, audio = `videos/${name}.mix.wav`, part = `videos/${name}.part.mp4`;
  mkdirSync('videos', { recursive: true });
  try {
    const ff = spawn('ffmpeg', encodeArgs(video, size), { stdio: ['pipe', 'inherit', 'inherit'] });
    const exited = once(ff, 'exit');
    ff.stdin.on('error', () => {});
    const started = Date.now();
    function* logged() {
      let f = 0;
      for (const frame of frames) {
        if (f % 900 === 0) console.error(`${name}: frame ${f}/${total}, ${Math.round((Date.now() - started) / 1000)} s`);
        f++;
        yield frame;
      }
    }
    await pump(logged(), { write: frame => ff.stdin.write(frame), drained: async () => { await once(ff.stdin, 'drain'); } });
    ff.stdin.end();
    const [code] = await exited;
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
    writeFileSync(audio, wavOf(musicTrack(music, total, TL_FPS)));
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
  } finally {
    for (const f of [video, audio, part]) rmSync(f, { force: true });
  }
  return out;
}
