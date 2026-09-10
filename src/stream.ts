// Twitch streamer, docs/snake.md "The stream": polls /state, renders frames
// in-process, pipes raw RGB to ffmpeg, which encodes and pushes to RTMP.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { renderFrame, WIDTH, HEIGHT } from './frame.js';

const STATE_URL = process.env.SNAKE_STATE_URL ?? 'http://127.0.0.1:8797/state';
const RTMP = process.env.TWITCH_RTMP_URL ?? 'rtmp://live.twitch.tv/app';
const KEY = process.env.TWITCH_STREAM_KEY;
const FPS = Number(process.env.STREAM_FPS ?? '5');
const OUT = process.env.STREAM_OUT ?? (KEY ? `${RTMP}/${KEY}` : '');
if (!OUT) throw new Error('set TWITCH_STREAM_KEY (or STREAM_OUT for a file/other target)');

const ff = spawn('ffmpeg', [
  '-hide_banner', '-loglevel', 'warning',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${WIDTH}x${HEIGHT}`, '-r', String(FPS), '-i', 'pipe:0',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
  '-b:v', '1200k', '-maxrate', '1200k', '-bufsize', '2400k', '-g', String(FPS * 2), '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '64k', '-shortest',
  '-f', OUT.startsWith('rtmp') ? 'flv' : 'mp4', OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('exit', code => { console.error(`ffmpeg exited ${code}`); process.exit(code ?? 1); });

let state: any = null;
async function poll() {
  try { const r = await fetch(STATE_URL); state = await r.json(); } catch (e) { console.error('state poll failed', (e as Error).message); }
}
setInterval(poll, 1000); await poll();

const interval = 1000 / FPS;
let next = Date.now();
function frame() {
  if (state) {
    const buf = renderFrame({ ...state, secondsToDecision: state.open ? Math.max(0, Math.round((Date.parse(state.open.decideAt) - Date.now()) / 1000)) : null });
    if (!ff.stdin.write(buf)) { ff.stdin.once('drain', schedule); return; }
  }
  schedule();
}
function schedule() { next += interval; setTimeout(frame, Math.max(0, next - Date.now())); }
frame();
