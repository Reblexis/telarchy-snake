// The operator loop, docs/snake.md "The step". Talks to Telarchy only through
// TelarchyClient, which has no trade call: the operator never trades.
import { GRID, newGame, step as applyStep, type Direction, type GameState, type Rng } from './engine.js';
import { decide, ACTIONS, proposalTitle, HORIZONS, directionsFrom, emptyQuotes, impact60, type Action, type Decision, type Quotes, type Horizon } from './decide.js';
import type { GameLog, LogStep } from './gamelog.js';
import { minuteCells } from './client.js';
import { commentary } from './commentary.js';

export interface ProposalRef { id: string; title: string; url: string }
export type Verdict = 'approve' | 'decline';
export type Side = 'higher' | 'lower';
export type Branch = 'approved' | 'declined';

/** One book's public activity, as Telarchy's market-activity endpoint reports it. */
export interface ActivityPosition { handle: string; direction: Side; shares: number; cost: number; worth: number | null }
export interface ActivityTrade { id: string; handle: string; direction: Side; kind: 'buy' | 'sell'; shares: number; cost: number; createdAt: string }
export interface MarketActivity { consensus: number | null; positions: ActivityPosition[]; trades: ActivityTrade[] }
/** One row of the workspace's public leaderboard. */
export interface LeaderRow { rank: number; handle: string; profit: number; trades: number }

/** A position in the open step's books, docs/snake.md "The feed". */
export interface TraderRow { handle: string; action: Action; horizon: Horizon; branch: Branch; side: Side; shares: number; cost: number; worth: number | null }
/** A trade in the rolling log, docs/snake.md "The feed". */
export interface TradeRecord {
  id: string; at: string; handle: string; step: number; action: Action; horizon: Horizon; branch: Branch; side: Side;
  kind: 'buy' | 'sell'; shares: number; cost: number; marketId: string;
  /** The book's consensus when the trade was first seen, or null. */
  price: number | null;
}
/** The next move, docs/snake.md "The board". */
export interface NextMove { action: Action; direction: Direction; decided: boolean; seconds: number }

export interface TelarchyClient {
  /** Post one proposal with an explicit deadline (docs/snake.md, "The step"). */
  postProposal(title: string, description: string, decideBy: Date): Promise<ProposalRef>;
  /** The pair of each proposal on the attempt's cell. */
  readQuotes(refs: ProposalRef[], cell: string): Promise<Quotes>;
  decideProposal(ref: ProposalRef, verdict: Verdict): Promise<void>;
  /** A reading of Reached length at `at`; `final` marks the last reading of a UTC day. */
  postReading(value: number, at: Date, final: boolean): Promise<void>;
  /** The attempt ended: settle every open book on the metric at `value`
   *  (docs/snake.md, "When the attempt ends the answer is known"). Throws
   *  when Telarchy refuses; the operator logs it and carries on. */
  settleMetric(value: number, at: Date, reason: string): Promise<void>;
  /** Force the workspace's markets to refresh, so the attempt's cell has
   *  its baseline book before the proposals are posted (docs/snake.md,
   *  "The workspace"). */
  refreshBooks(): Promise<void>;
  /** Make `cell` (YYYY-MM-DDTHH:MM) the metric's only horizon: one book per
   *  attempt (docs/snake.md, "The workspace"). Throws when Telarchy refuses. */
  setHorizon(cell: string): Promise<void>;
  /** Raise the metric's market range to `max` (the new full grid). Throws when
   *  Telarchy refuses (an open traded book), so the caller retries later. */
  setRange(max: number): Promise<void>;
  /** Public activity (positions and newest trades) of the given books, keyed
   *  by market id; a book that cannot be read is left out. Read-only. */
  readActivity(marketIds: string[]): Promise<Record<string, MarketActivity>>;
  /** The workspace's public leaderboard, top `limit` by profit. Read-only. */
  readLeaderboard(limit: number): Promise<LeaderRow[]>;
}

export interface OpenStep {
  step: number; // the step these proposals decide (game.step + 1)
  openedAt: string;
  /** When the operator decides: two seconds before the deadline. */
  decideAt: string;
  /** The proposals' deadline, the top of the next minute; trading closes there. */
  deadline: string;
  /** The minute cell the proposals are priced on. */
  cells: Record<Horizon, string>;
  /** The compass direction each action takes from the heading at this step. */
  directions: Record<Action, Direction>;
  proposals: Record<Action, ProposalRef>;
  quotes: Quotes | null;
  decision: Decision | null;
}

export interface OperatorOptions {
  boardUrl?: string;
  workspaceId?: string;
  metricId?: string;
  /** The on-disk game record behind /games and /history (docs/snake.md "The feed"); none in tests that do not need it. */
  log?: GameLog;
  /** docs/snake.md "The step", "No call to Telarchy waits without limit":
   *  how long a poll read, and the decision's own read, may take. */
  pollTimeoutMs?: number;
  decideReadTimeoutMs?: number;
}

export const RULE = 'Every minute three proposals, turn left, turn right and continue forward, each priced on the attempt\'s one book: the length the attempt will have reached one hour after it started (or at the next hour mark while it lives); when the attempt ends (a death or a full grid) the book settles at the length it reached. At :58 the proposal with the highest impact (approved minus declined) is approved and the other two are declined with refund; ties and unreadable prices continue forward. The snake moves at :00.';

/** One recorded move of a game, docs/snake.md "The feed" (`/replay`). */
export interface ReplayMove {
  step: number;
  at: string;
  action: Action;
  direction: Direction;
  undecided: boolean;
  /** The food's cell after the move; present only when the move ate it or killed the snake. */
  food?: { x: number; y: number };
  died: boolean;
}
/** One game's record: its start frame and every move applied since. */
export interface GameRecord {
  gameNumber: number;
  size: number;
  complete: boolean;
  start: { step: number; snake: { x: number; y: number }[]; heading: Direction; food: { x: number; y: number }; deaths: number; attemptStep: number };
  moves: ReplayMove[];
}

export interface DecisionRecord {
  step: number;
  at: string;
  /** The approved action, or forward when undecided. */
  action: Action;
  direction: Direction;
  approved: Action | null;
  undecided: boolean;
  quotes: Quotes;
  proposals: Record<Action, ProposalRef>;
  lengthBefore: number;
  lengthAfter: number | null;
  deathsBefore: number;
  /** Why the step was undecided (docs/snake.md, "The step"): which action
   *  had no price and what was missing, or the error the approval returned.
   *  Null when the step was decided. */
  undecidedReason: string | null;
}

const DECIDE_SECOND = 58;
/** docs/snake.md "The step": a poll read is abandoned after this, and no
 *  poll starts within this of the decision. */
const POLL_TIMEOUT_MS = 10_000;
/** The decision's own read: abandoned after this, falling on the last poll. */
const DECIDE_READ_TIMEOUT_MS = 2_000;
const NO_ANSWER = 'no answer';

/** `p`, or a rejection saying "no answer" once `ms` have passed. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${NO_ANSWER} in ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** The reason a step is undecided on these quotes: each action without a
 *  price and what its quote says was missing. */
function noPriceReason(quotes: Quotes): string {
  return ACTIONS.filter(a => impact60(quotes[a]) === null)
    .map(a => `${a}: ${quotes[a]?.m60?.reason ?? 'no price'}`)
    .join('; ');
}
/** docs/snake.md, "The feed": the rolling trades log keeps this many. */
const TRADES_KEPT = 30;
const LEADERBOARD_SIZE = 5;
const LEADERBOARD_EVERY_MS = 60_000;
/** docs/snake.md, "The game": the pause between a completed game and the next. */
const COOLDOWN_MS = 60 * 60_000;

/** A game's record as it begins: its state now, no moves yet. */
function startRecord(g: GameState): GameRecord {
  return {
    gameNumber: g.gameNumber ?? 1,
    size: g.size ?? GRID,
    complete: !!g.complete,
    start: { step: g.step, snake: g.snake.map(c => ({ x: c.x, y: c.y })), heading: g.heading, food: { x: g.food.x, y: g.food.y }, deaths: g.deaths, attemptStep: g.attemptStep ?? 0 },
    moves: [],
  };
}

function utcDay(d: Date): string { return d.toISOString().slice(0, 10); }
function isoMinute(d: Date): Date { const c = new Date(d); c.setUTCSeconds(0, 0); return c; }

export class Operator {
  game: GameState;
  open: OpenStep | null = null;
  decisions: DecisionRecord[] = [];
  /** When the current game completed; null while a game is running. */
  completedAt: string | null = null;
  /** The longest the snake has been in this game (docs/snake.md, "The board"). */
  bestLength: number;
  /** Early settlements Telarchy refused (docs/snake.md, "The workspace"); shown on /state. */
  settleFailures = 0;
  /** The attempt's cell, the metric's only horizon (docs/snake.md, "The
   *  workspace"); null until set, cleared when the attempt ends. */
  cell: string | null = null;
  /** The rolling trades log, newest first (persisted). */
  recentTrades: TradeRecord[] = [];
  /** Distinct handles seen trading or holding a position today (persisted). */
  tradersToday: { day: string; handles: string[] } = { day: '', handles: [] };
  /** The workspace leaderboard as last read (not persisted). */
  leaderboard: LeaderRow[] = [];
  activityAt: string | null = null;
  /** Every game since recording began, oldest first (persisted), docs/snake.md "The replay". */
  games: GameRecord[] = [];
  private pending: Direction | null = null; // decided, waiting for the top of minute
  /** Positions per book of the open step, keyed by market id, for this step only. */
  private positions: Map<string, TraderRow[]> = new Map();
  private positionsStep = 0;
  private leaderboardAt = 0;

  /** The game log, when the process keeps one. */
  readonly log: GameLog | null;

  constructor(private client: TelarchyClient, game: GameState, private rng: Rng, private opts: OperatorOptions = {}) {
    this.game = game;
    this.bestLength = game.length;
    this.games = [startRecord(game)];
    this.log = opts.log ?? null;
    // docs/snake.md "The feed": a game with no log yet is recorded from
    // here on; when that is not its start the entry is marked partial.
    if (this.log && !this.log.has(game.gameNumber ?? 1)) {
      const at = new Date().toISOString();
      this.log.start(game.gameNumber ?? 1, game.size ?? GRID, at, this.logLine(game, at, null), game.step > 0);
      if (game.complete) this.log.end(game.gameNumber ?? 1, at);
    }
  }

  /** One log entry: the state as it stands, with the move that led to it (none for a starting position). */
  private logLine(g: GameState, at: string, rec: DecisionRecord | null, dir?: Direction): LogStep {
    const q = rec?.quotes;
    return {
      step: g.step, at,
      snake: g.snake.map(c => ({ x: c.x, y: c.y })), food: { x: g.food.x, y: g.food.y }, heading: g.heading,
      action: rec ? rec.action : null,
      direction: dir ?? g.heading,
      undecided: rec ? rec.undecided : false,
      impact: { forward: q ? impact60(q.forward) : null, left: q ? impact60(q.left) : null, right: q ? impact60(q.right) : null },
      length: g.length, deaths: g.deaths,
    };
  }

  static fresh(client: TelarchyClient, rng: Rng = Math.random, opts: OperatorOptions = {}): Operator {
    return new Operator(client, newGame(rng), rng, opts);
  }

  /** A step needs at least ten seconds of trading before its deadline, the
   *  top of the next minute; a process that starts later in the minute
   *  waits for the next one instead of posting proposals already past due. */
  canOpen(now: Date): boolean {
    return 60 - now.getUTCSeconds() >= 10;
  }

  /** Second 0: post the three proposals for the next step. */
  async openStep(now: Date): Promise<OpenStep> {
    if (this.open) throw new Error(`step ${this.open.step} is already open`);
    if (this.game.complete) throw new Error('the game is complete');
    if (!this.canOpen(now)) throw new Error('too close to the deadline to open a step');
    // One cell per attempt (docs/snake.md, "The workspace"): set when the
    // attempt starts or its cell's minute has passed; a refusal leaves it
    // unset so the next step tries again, and this step runs on whatever
    // pair Telarchy gives it (the undecided path covers none).
    if (!this.cell || Date.parse(`${this.cell}:00Z`) + 60_000 <= now.getTime()) {
      const cell = minuteCells(now).m60;
      try {
        await this.client.setHorizon(cell);
        this.cell = cell;
      } catch (e) {
        console.error(`set horizon ${cell} failed: ${(e as Error).message}`);
      }
    }
    // Every step: make sure the attempt's cell has its baseline book.
    // A failure here only costs this step's prices (the undecided path).
    try { await this.client.refreshBooks(); } catch { /* undecided path covers it */ }
    const stepNo = this.game.step + 1;
    const g = this.game;
    const openedAt = isoMinute(now);
    const deadline = new Date(openedAt.getTime() + 60_000);
    const decideAt = new Date(openedAt.getTime() + DECIDE_SECOND * 1000);
    const cells: Record<Horizon, string> = { m60: this.cell ?? minuteCells(now).m60 };
    const directions = directionsFrom(g.heading);
    const hhmm = (c: string) => c.slice(11);
    // The proposal in the snake's own first person, one per action
    // (docs/snake.md, "The step"): the move, then the state a trader prices
    // on, the cell, and the rule in one clause. No board address: the game
    // is on the floor itself.
    const verb: Record<Action, string> = { forward: 'continue forward', left: 'turn left', right: 'turn right' };
    const attempt = g.deaths + 1;
    const move = (g.attemptStep ?? 0) + 1;
    const gameNo = g.gameNumber ?? 1;
    const describe = (a: Action) =>
      `I will ${verb[a]} at move ${move} of attempt ${attempt}, game ${gameNo}: from (${g.snake[0].x},${g.snake[0].y}) heading ${g.heading}, that is ${directions[a]}. ` +
      `Length ${g.length}, record ${this.bestLength}, food at (${g.food.x},${g.food.y}). ` +
      `Priced on the length this attempt reaches by ${hhmm(cells.m60)} UTC; when the attempt ends every open book settles at the length it reached. ` +
      `Of the three moves the one with the highest impact at :58 is approved, the rest are declined with refund; ties continue forward; the snake moves at :00.`;
    // All three at once, so they land in the same second and share the deadline.
    const refs = await Promise.all(ACTIONS.map(a => this.client.postProposal(proposalTitle(a, gameNo, attempt, move), describe(a), deadline)));
    const proposals = {} as Record<Action, ProposalRef>;
    ACTIONS.forEach((a, i) => { proposals[a] = refs[i]; });
    this.open = {
      step: stepNo,
      openedAt: now.toISOString(),
      decideAt: decideAt.toISOString(),
      deadline: deadline.toISOString(),
      cells,
      directions,
      proposals,
      quotes: null,
      decision: null,
    };
    return this.open;
  }

  private pollTimeout(): number { return this.opts.pollTimeoutMs ?? POLL_TIMEOUT_MS; }

  /** docs/snake.md "The step": no poll starts in the last ten seconds
   *  before the decision, so a slow poll can delay nothing past :58. */
  private pollAllowed(now: Date): boolean {
    const open = this.open;
    if (!open || open.decision) return true;
    const toDecision = Date.parse(open.decideAt) - now.getTime();
    return toDecision < 0 || toDecision > POLL_TIMEOUT_MS;
  }

  /** During the minute: refresh the live quotes on the open step, deciding nothing. */
  async pollQuotes(now: Date): Promise<void> {
    const open = this.open;
    if (!open || open.decision || !this.pollAllowed(now)) return;
    try {
      open.quotes = await within(this.client.readQuotes(ACTIONS.map(a => open.proposals[a]), open.cells.m60), this.pollTimeout());
    } catch {
      // keep the last quotes
    }
  }

  /** Second 58: read the pair prices and decide, approving one, declining three. */
  async closeStep(now: Date): Promise<Decision> {
    const open = this.open;
    if (!open) throw new Error('no step is open');
    if (open.decision) return open.decision;
    // The last read, bounded: past its bound the decision falls on the
    // prices last polled during the minute (docs/snake.md, "The step").
    let quotes: Quotes;
    try {
      quotes = await within(this.client.readQuotes(ACTIONS.map(a => open.proposals[a]), open.cells.m60), this.opts.decideReadTimeoutMs ?? DECIDE_READ_TIMEOUT_MS);
    } catch (e) {
      quotes = open.quotes ?? emptyQuotes();
      if (!open.quotes) for (const a of ACTIONS) quotes[a].m60.reason = (e as Error).message;
    }
    let decision = decide(quotes, this.game.heading);
    let undecidedReason: string | null = decision.undecided ? noPriceReason(quotes) : null;
    // Approve first: if that fails the step is undecided and the snake keeps
    // its heading; the other three are declined regardless so nothing is
    // left pending past the deadline.
    if (decision.approved) {
      try {
        await this.client.decideProposal(open.proposals[decision.approved], 'approve');
      } catch (e) {
        undecidedReason = `approve of ${decision.approved} failed: ${(e as Error).message}`;
        decision = { approved: null, declined: [...ACTIONS], direction: this.game.heading, undecided: true };
      }
    }
    // The declines together, so the decision lands inside its two seconds.
    await Promise.all(decision.declined.filter(a => a !== decision.approved).map(async a => {
      try { await this.client.decideProposal(open.proposals[a], 'decline'); } catch { /* logged below as undecided */ }
    }));
    open.quotes = quotes;
    open.decision = decision;
    this.pending = decision.direction;
    this.decisions.push({
      step: open.step,
      at: now.toISOString(),
      action: decision.approved ?? 'forward',
      direction: decision.direction,
      approved: decision.approved,
      undecided: decision.undecided,
      quotes,
      proposals: open.proposals,
      lengthBefore: this.game.length,
      lengthAfter: null,
      deathsBefore: this.game.deaths,
      undecidedReason,
    });
    return decision;
  }

  /** Top of minute: apply the decided move, post the reading, open the next step. */
  async tick(now: Date): Promise<void> {
    if (this.game.complete) {
      // The cooldown: the full length is the reading every minute; after an
      // hour the range is raised to the next grid and a new game starts.
      if (!this.completedAt) this.completedAt = now.toISOString();
      const due = Date.parse(this.completedAt) + COOLDOWN_MS;
      if (now.getTime() >= due) {
        const size = (this.game.size ?? GRID) + 1;
        try {
          await this.client.setRange(size * size);
        } catch {
          await this.client.postReading(this.game.length, now, false);
          return; // a traded open book: try again next minute
        }
        this.game = newGame(this.rng, size, (this.game.gameNumber ?? 1) + 1);
        this.games.push(startRecord(this.game));
        this.log?.start(this.game.gameNumber, this.game.size, now.toISOString(), this.logLine(this.game, now.toISOString(), null), false);
        this.bestLength = this.game.length;
        this.completedAt = null;
        this.pending = null;
        this.open = null;
        await this.client.postReading(this.game.length, now, false);
        await this.openStep(now);
        return;
      }
      await this.client.postReading(this.game.length, now, false);
      return;
    }
    if (this.open && !this.open.decision) await this.closeStep(now);
    const dir = this.pending ?? this.game.heading;
    const before = this.game;
    this.game = applyStep(before, dir, this.rng);
    this.bestLength = Math.max(this.bestLength, this.game.length);
    const rec = this.decisions[this.decisions.length - 1];
    if (rec && rec.lengthAfter === null) rec.lengthAfter = this.game.length;
    this.recordMove(before, this.game, dir, now, rec);
    // docs/snake.md "The feed": the state after the move, right after it is applied.
    this.log?.append(this.game.gameNumber ?? 1, this.logLine(this.game, now.toISOString(), rec && rec.step === this.game.step ? rec : null, dir), this.bestLength, this.game.complete);
    this.pending = null;
    this.open = null;
    // The attempt ended: the answer to every open book is known now, so
    // they settle at the length the attempt reached, before the new
    // attempt's reading (docs/snake.md, "When the attempt ends the answer is
    // known"). A refusal is logged and the step carries on.
    const died = this.game.deaths > before.deaths;
    if (died || this.game.complete) {
      const gameNo = before.gameNumber ?? 1;
      const reason = died
        ? `Game ${gameNo}, attempt ${before.deaths + 1} ended at length ${before.length}`
        : `Game ${gameNo} complete at length ${this.game.length}`;
      try {
        await this.client.settleMetric(died ? before.length : this.game.length, now, reason);
      } catch (e) {
        this.settleFailures++;
        console.error(`settle failed (${reason}): ${(e as Error).message}`);
      }
      this.cell = null; // the next step sets the new attempt's cell
    }
    // The reading is the snake's length (docs/snake.md, "What must hold"),
    // stamped at the minute it was taken; the last one before midnight is
    // marked final so the day's books settle on it.
    const next = new Date(now.getTime() + 60_000);
    const final = utcDay(next) !== utcDay(now) || this.game.complete;
    await this.client.postReading(this.game.length, now, final);
    if (this.game.complete) { this.completedAt = now.toISOString(); return; } // the cooldown begins
    await this.openStep(now);
  }

  /** The books of the open step, by market id: which action, horizon and branch each is. */
  private books(horizons: Horizon[]): Map<string, { action: Action; horizon: Horizon; branch: Branch }> {
    const out = new Map<string, { action: Action; horizon: Horizon; branch: Branch }>();
    const q = this.open?.quotes;
    if (!q) return out;
    for (const a of ACTIONS) for (const h of horizons) {
      const x = q[a]?.[h];
      if (!x) continue;
      if (x.approvedMarketId) out.set(x.approvedMarketId, { action: a, horizon: h, branch: 'approved' });
      if (x.declinedMarketId) out.set(x.declinedMarketId, { action: a, horizon: h, branch: 'declined' });
    }
    return out;
  }

  private noteTraderToday(handle: string, day: string) {
    if (this.tradersToday.day !== day) this.tradersToday = { day, handles: [] };
    if (!this.tradersToday.handles.includes(handle)) this.tradersToday.handles.push(handle);
  }

  /** On its own timer, apart from the quotes (docs/snake.md, "The feed"):
   *  the six books of the open step every call, the leaderboard once a
   *  minute. Reads only; nothing here can trade. Failures keep the last
   *  activity. */
  async pollActivity(now: Date): Promise<void> {
    if (!this.pollAllowed(now)) return;
    const open = this.open;
    if (open && open.quotes) {
      if (this.positionsStep !== open.step) { this.positions = new Map(); this.positionsStep = open.step; }
      const books = this.books(HORIZONS);
      if (books.size > 0) {
        try {
          const activity = await within(this.client.readActivity([...books.keys()]), this.pollTimeout());
          const day = utcDay(now);
          const seen = new Set(this.recentTrades.map(t => t.id));
          for (const [marketId, meta] of books) {
            const a = activity[marketId];
            if (!a) continue;
            this.positions.set(marketId, a.positions.map(p => ({
              handle: p.handle, action: meta.action, horizon: meta.horizon, branch: meta.branch,
              side: p.direction, shares: p.shares, cost: p.cost, worth: p.worth ?? null,
            })));
            for (const p of a.positions) this.noteTraderToday(p.handle, day);
            for (const t of a.trades) {
              if (t.createdAt.slice(0, 10) === day) this.noteTraderToday(t.handle, day);
              if (seen.has(t.id)) continue;
              seen.add(t.id);
              this.recentTrades.push({
                id: t.id, at: t.createdAt, handle: t.handle, step: open.step, action: meta.action, horizon: meta.horizon,
                branch: meta.branch, side: t.direction, kind: t.kind, shares: t.shares, cost: t.cost, marketId, price: a.consensus ?? null,
              });
            }
          }
          this.recentTrades.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
          this.recentTrades = this.recentTrades.slice(0, TRADES_KEPT);
          this.activityAt = now.toISOString();
        } catch {
          // keep the last activity
        }
      }
    }
    if (now.getTime() - this.leaderboardAt >= LEADERBOARD_EVERY_MS) {
      this.leaderboardAt = now.getTime();
      try { this.leaderboard = await within(this.client.readLeaderboard(LEADERBOARD_SIZE), this.pollTimeout()); } catch { /* keep the last */ }
    }
  }

  /** The open step's positions, one row each (docs/snake.md, "The feed"). */
  traders(): TraderRow[] {
    if (!this.open || this.positionsStep !== this.open.step) return [];
    return [...this.positions.values()].flat();
  }

  /** The next move: the live leader before the decision, the approved action after it. */
  next(now: Date): NextMove | null {
    const open = this.open;
    if (!open || this.game.complete) return null;
    if (open.decision) {
      return { action: open.decision.approved ?? 'forward', direction: open.decision.direction, decided: true, seconds: 0 };
    }
    const lead = decide(open.quotes ?? emptyQuotes(), this.game.heading);
    const seconds = Math.max(0, Math.round((Date.parse(open.decideAt) - now.getTime()) / 1000));
    return { action: lead.approved ?? 'forward', direction: lead.direction, decided: false, seconds };
  }

  /** Append the move just applied to the current game's record. */
  private recordMove(before: GameState, after: GameState, dir: Direction, now: Date, rec: DecisionRecord | undefined) {
    let g = this.games[this.games.length - 1];
    if (!g || g.gameNumber !== (before.gameNumber ?? 1)) { g = startRecord(before); this.games.push(g); }
    const died = after.deaths > before.deaths;
    const ate = !died && (after.food.x !== before.food.x || after.food.y !== before.food.y);
    const m: ReplayMove = {
      step: after.step,
      at: now.toISOString(),
      action: rec && rec.step === after.step ? rec.action : 'forward',
      direction: dir,
      undecided: rec && rec.step === after.step ? rec.undecided : true,
      died,
    };
    if (died || ate) m.food = { x: after.food.x, y: after.food.y };
    g.moves.push(m);
    g.complete = after.complete;
  }

  /** docs/snake.md "The feed": the record of game `gameNumber` (the newest
   *  when absent) with its moves from index `from` on; null for an unknown game. */
  replay(gameNumber?: number, from = 0) {
    const g = gameNumber === undefined ? this.games[this.games.length - 1] : this.games.find(x => x.gameNumber === gameNumber);
    if (!g) return null;
    return {
      games: this.games.map(x => x.gameNumber),
      gameNumber: g.gameNumber,
      size: g.size,
      complete: g.complete,
      start: g.start,
      moves: g.moves.slice(Math.max(0, Math.floor(from) || 0)),
    };
  }

  recentDecisions(): DecisionRecord[] {
    return this.decisions.slice(-10).reverse();
  }

  deathsToday(now: Date): number {
    const day = utcDay(now);
    return this.decisions.filter(d => d.at.slice(0, 10) === day && d.lengthAfter !== null && d.lengthAfter < d.lengthBefore).length;
  }

  publicState(now: Date) {
    const open = this.open;
    const nextStepAt = open ? open.deadline : new Date(isoMinute(now).getTime() + 60_000).toISOString();
    const base = {
      game: this.game,
      grid: this.game.size ?? GRID,
      gameNumber: this.game.gameNumber ?? 1,
      completedAt: this.completedAt,
      nextGameAt: this.completedAt ? new Date(Date.parse(this.completedAt) + COOLDOWN_MS).toISOString() : null,
      workspaceId: this.opts.workspaceId ?? null,
      metricId: this.opts.metricId ?? null,
      rule: RULE,
      nextStepAt,
      open: open
        ? {
            step: open.step,
            openedAt: open.openedAt,
            decideAt: open.decideAt,
            deadline: open.deadline,
            cells: open.cells,
            directions: open.directions,
            proposals: open.proposals,
            quotes: open.quotes ?? emptyQuotes(),
          }
        : null,
      secondsToDecision: open ? Math.max(0, Math.round((Date.parse(open.decideAt) - now.getTime()) / 1000)) : null,
      recentDecisions: this.recentDecisions(),
      deathsToday: this.deathsToday(now),
      stepsTotal: this.game.step,
      complete: this.game.complete,
      now: now.toISOString(),
    };
    const traders = this.traders();
    const activity = {
      next: this.next(now),
      bestLength: this.bestLength,
      settleFailures: this.settleFailures,
      cell: this.cell,
      traders,
      tradersThisStep: new Set(traders.map(t => t.handle)).size,
      tradersToday: this.tradersToday.day === utcDay(now) ? this.tradersToday.handles.length : 0,
      recentTrades: this.recentTrades,
      leaderboard: this.leaderboard,
      activityAt: this.activityAt,
    };
    return { ...base, ...activity, commentary: commentary({ ...base, ...activity }, now) };
  }

  toJSON() {
    return {
      game: this.game, open: this.open, decisions: this.decisions, pending: this.pending, completedAt: this.completedAt,
      bestLength: this.bestLength, recentTrades: this.recentTrades, tradersToday: this.tradersToday,
      games: this.games, cell: this.cell,
    };
  }

  static fromJSON(client: TelarchyClient, raw: any, rng: Rng = Math.random, opts: OperatorOptions = {}): Operator {
    let game: GameState = raw.game;
    if (game.complete === undefined) game = { ...game, complete: false };
    if (game.size === undefined) game = { ...game, size: GRID, gameNumber: 1 };
    const decisions: DecisionRecord[] = raw.decisions ?? [];
    if (game.attemptStep === undefined) {
      // A state file from before attempts were counted: the attempt's moves
      // are the decisions since the last death in this game.
      // A record's move killed the snake when the next record (or the game
      // now) counts one more death than it did.
      let n = 0;
      const ds = decisions;
      for (let i = 0; i < ds.length; i++) {
        if (ds[i].lengthAfter === null) continue;
        const after = i + 1 < ds.length ? ds[i + 1].deathsBefore : game.deaths;
        n = after > ds[i].deathsBefore ? 0 : n + 1;
      }
      game = { ...game, attemptStep: Math.min(n, game.step) };
    }
    const op = new Operator(client, game, rng, opts);
    op.open = raw.open ?? null;
    // A record from before the reason was kept: undecided with no reason known.
    op.decisions = decisions.map(d => (d.undecidedReason === undefined ? { ...d, undecidedReason: d.undecided ? 'not recorded' : null } : d));
    op.pending = raw.pending ?? null;
    op.completedAt = raw.completedAt ?? null;
    op.bestLength = typeof raw.bestLength === 'number' ? Math.max(raw.bestLength, op.game.length) : op.game.length;
    op.cell = typeof raw.cell === 'string' ? raw.cell : null;
    op.log?.noteBest(op.game.gameNumber ?? 1, op.bestLength);
    op.recentTrades = Array.isArray(raw.recentTrades) ? raw.recentTrades : [];
    op.tradersToday = raw.tradersToday && Array.isArray(raw.tradersToday.handles) ? raw.tradersToday : { day: '', handles: [] };
    // A state file from before recording began: the record starts from the
    // game as it stands (docs/snake.md, "The replay").
    op.games = Array.isArray(raw.games) && raw.games.length > 0 ? raw.games : [startRecord(op.game)];
    return op;
  }
}
