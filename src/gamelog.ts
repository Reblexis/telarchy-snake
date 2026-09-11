// The on-disk game record, docs/snake.md "The feed" (/games and /history).
// One JSON line per step in state/games/<number>.jsonl, the games list in
// state/games/index.json. Reads stream the file; nothing here holds a
// whole game in memory.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Cell, Direction } from './engine.js';
import type { Action } from './decide.js';

/** One entry of a game's log: the state after the move of `step` (step 0,
 *  or the first entry of a partial log, is a position with no move: action null). */
export interface LogStep {
  step: number;
  at: string;
  snake: Cell[];
  food: Cell;
  heading: Direction;
  action: Action | null;
  direction: Direction;
  undecided: boolean;
  impact: Record<Action, number | null>;
  length: number;
  deaths: number;
}

/** One row of the games list, docs/snake.md "The feed" (/games). */
export interface GameEntry {
  number: number;
  size: number;
  startedAt: string;
  endedAt: string | null;
  /** Moves made in the game (the `step` of /state). */
  steps: number;
  bestLength: number;
  deaths: number;
  /** Present (true) only when the log began mid-game: earlier steps are unavailable. */
  partial?: true;
}

/** The index as kept on disk: the public rows plus the entry count per game. */
interface IndexFile { games: GameEntry[]; entries: Record<string, number> }

export interface History {
  game: { number: number; size: number; startedAt: string; endedAt: string | null; partial?: true };
  total: number;
  from: number;
  steps: LogStep[];
}

export const HISTORY_LIMIT = 300;
export const HISTORY_MAX = 2000;

export class GameLog {
  private index: IndexFile;

  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.index = this.readIndex();
    // A torn last line (a crash mid-write) is closed off so the next line is whole.
    for (const g of this.index.games) this.closeTornLine(this.file(g.number));
  }

  private file(n: number): string { return path.join(this.dir, `${n}.jsonl`); }
  private indexFile(): string { return path.join(this.dir, 'index.json'); }

  private readIndex(): IndexFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile(), 'utf8'));
      return { games: Array.isArray(raw.games) ? raw.games : [], entries: raw.entries ?? {} };
    } catch {
      return { games: [], entries: {} };
    }
  }

  /** Rewritten whole, through a temp file and a rename, so no half index is ever read. */
  private writeIndex() {
    const tmp = `${this.indexFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.index));
    fs.renameSync(tmp, this.indexFile());
  }

  private closeTornLine(file: string) {
    let fd: number | null = null;
    try {
      const st = fs.statSync(file);
      if (st.size === 0) return;
      fd = fs.openSync(file, 'r+');
      const buf = Buffer.alloc(1);
      fs.readSync(fd, buf, 0, 1, st.size - 1);
      if (buf[0] !== 0x0a) fs.appendFileSync(file, '\n');
    } catch {
      // no file yet
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  /** The games list, oldest first (a copy). */
  games(): GameEntry[] {
    return this.index.games.map(g => ({ ...g }));
  }

  has(number: number): boolean {
    return this.index.games.some(g => g.number === number);
  }

  /** Begin a game's log with its starting position (`partial` when the
   *  position is not step 0: the log starts mid-game). */
  start(number: number, size: number, at: string, first: LogStep, partial: boolean) {
    if (this.has(number)) throw new Error(`game ${number} is already logged`);
    const entry: GameEntry = { number, size, startedAt: at, endedAt: null, steps: first.step, bestLength: first.length, deaths: first.deaths };
    if (partial) entry.partial = true;
    fs.writeFileSync(this.file(number), JSON.stringify(first) + '\n');
    this.index.games.push(entry);
    this.index.entries[String(number)] = 1;
    this.writeIndex();
  }

  /** Append the state after a move; `complete` ends the game at `line.at`. */
  append(number: number, line: LogStep, bestLength: number, complete: boolean) {
    const g = this.index.games.find(x => x.number === number);
    if (!g) throw new Error(`game ${number} is not logged`);
    fs.appendFileSync(this.file(number), JSON.stringify(line) + '\n');
    g.steps = line.step;
    g.bestLength = Math.max(g.bestLength, bestLength, line.length);
    g.deaths = line.deaths;
    if (complete && !g.endedAt) g.endedAt = line.at;
    this.index.entries[String(number)] = (this.index.entries[String(number)] ?? 0) + 1;
    this.writeIndex();
  }

  /** Mark a game ended at `at` (a game found complete when the log begins). */
  end(number: number, at: string) {
    const g = this.index.games.find(x => x.number === number);
    if (g && !g.endedAt) { g.endedAt = at; this.writeIndex(); }
  }

  /** docs/snake.md "The feed": the entries of one game from index `from`
   *  (default the newest `limit`), streamed from its file. Null for an
   *  unknown game. */
  async history(game: number | 'current' | undefined, from?: number, limit: number = HISTORY_LIMIT): Promise<History | null> {
    const g = game === undefined || game === 'current'
      ? this.index.games[this.index.games.length - 1]
      : this.index.games.find(x => x.number === game);
    if (!g) return null;
    const lim = Math.min(HISTORY_MAX, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : HISTORY_LIMIT)));
    const start = from === undefined || !Number.isFinite(from) ? undefined : Math.max(0, Math.floor(from));
    // One pass over the file: count whole lines, keep only the window. With
    // no `from` the window is the newest `lim` lines, kept as a sliding
    // window of raw strings; either way at most `lim` lines are held.
    const kept: string[] = [];
    let total = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(this.file(g.number), { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const raw of rl) {
      if (raw.length === 0 || raw[raw.length - 1] !== '}') continue; // a torn line
      const i = total++;
      if (start === undefined) {
        kept.push(raw);
        if (kept.length > lim) kept.shift();
      } else if (i >= start && i < start + lim) {
        kept.push(raw);
      }
    }
    const first = start === undefined ? Math.max(0, total - lim) : start;
    const steps: LogStep[] = [];
    for (const raw of kept) {
      try { steps.push(JSON.parse(raw)); } catch { /* a torn line: skipped */ }
    }
    const meta: History['game'] = { number: g.number, size: g.size, startedAt: g.startedAt, endedAt: g.endedAt };
    if (g.partial) meta.partial = true;
    return { game: meta, total, from: first, steps };
  }
}
