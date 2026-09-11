// The operator loop, docs/snake.md "The step". Talks to Telarchy only through
// TelarchyClient, which has no trade call: the operator never trades.
import { GRID, newGame, step as applyStep, type Direction, type GameState, type Rng } from './engine.js';
import { decide, ACTIONS, proposalTitle, HORIZONS, directionsFrom, emptyQuotes, type Action, type Decision, type Quotes, type Horizon } from './decide.js';
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
  /** The three pairs of each proposal, for the step that opened at `openedAt`. */
  readQuotes(refs: ProposalRef[], openedAt: Date): Promise<Quotes>;
  decideProposal(ref: ProposalRef, verdict: Verdict): Promise<void>;
  /** A reading of Snake length at `at`; `final` marks the last reading of a UTC day. */
  postReading(value: number, at: Date, final: boolean): Promise<void>;
  /** Force the workspace's rolling markets to refresh, so the step's three
   *  minute cells have their baseline books before the proposals are posted
   *  (docs/snake.md, "The workspace"). */
  refreshBooks(): Promise<void>;
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
  /** The three minute cells the proposals are priced on. */
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
}

export const RULE = 'Every minute three proposals, turn left, turn right and continue forward, each priced on the snake length in 1, 5 and 60 moves. At :58 the proposal with the highest 60-move impact (approved minus declined) is approved and the other two are declined with refund; ties and unreadable prices continue forward. The snake moves at :00.';

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
  start: { step: number; snake: { x: number; y: number }[]; heading: Direction; food: { x: number; y: number }; deaths: number };
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
}

const DECIDE_SECOND = 58;
/** docs/snake.md, "The feed": the rolling trades log keeps this many. */
const TRADES_KEPT = 30;
const LEADERBOARD_SIZE = 5;
const LEADERBOARD_EVERY_MS = 60_000;
/** The 1-move and 5-move books are read once per step, from this second on. */
const NEAR_BOOKS_SECOND = 45;
/** docs/snake.md, "The game": the pause between a completed game and the next. */
const COOLDOWN_MS = 60 * 60_000;

/** A game's record as it begins: its state now, no moves yet. */
function startRecord(g: GameState): GameRecord {
  return {
    gameNumber: g.gameNumber ?? 1,
    size: g.size ?? GRID,
    complete: !!g.complete,
    start: { step: g.step, snake: g.snake.map(c => ({ x: c.x, y: c.y })), heading: g.heading, food: { x: g.food.x, y: g.food.y }, deaths: g.deaths },
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
  private nearPolledStep = 0;
  private leaderboardAt = 0;

  constructor(private client: TelarchyClient, game: GameState, private rng: Rng, private opts: OperatorOptions = {}) {
    this.game = game;
    this.bestLength = game.length;
    this.games = [startRecord(game)];
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
    // Every step: make sure the three minute cells have their baseline books.
    // A failure here only costs this step's prices (the undecided path).
    try { await this.client.refreshBooks(); } catch { /* undecided path covers it */ }
    const stepNo = this.game.step + 1;
    const g = this.game;
    const openedAt = isoMinute(now);
    const deadline = new Date(openedAt.getTime() + 60_000);
    const decideAt = new Date(openedAt.getTime() + DECIDE_SECOND * 1000);
    const cells = minuteCells(now);
    const directions = directionsFrom(g.heading);
    const hhmm = (c: string) => c.slice(11);
    const board = this.opts.boardUrl ? ` Board: ${this.opts.boardUrl}.` : '';
    const description =
      `Step ${stepNo}: snake length ${g.length}, heading ${g.heading} (forward = ${directions.forward}, turn left = ${directions.left}, ` +
      `turn right = ${directions.right}), head at (${g.snake[0].x},${g.snake[0].y}), food at (${g.food.x},${g.food.y}), ` +
      `${g.deaths} deaths so far. Priced on the length in 1, 5 and 60 moves (${hhmm(cells.m1)}, ${hhmm(cells.m5)}, ${hhmm(cells.m60)} UTC). ` +
      `The highest 60-move impact is approved at :58, the others are declined with refund; ties continue forward; the snake moves at :00.${board}`;
    // All three at once, so they land in the same second and share the deadline.
    const refs = await Promise.all(ACTIONS.map(a => this.client.postProposal(proposalTitle(a, g.gameNumber ?? 1, stepNo), description, deadline)));
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

  /** During the minute: refresh the live quotes on the open step, deciding nothing. */
  async pollQuotes(_now: Date): Promise<void> {
    const open = this.open;
    if (!open || open.decision) return;
    try {
      open.quotes = await this.client.readQuotes(ACTIONS.map(a => open.proposals[a]), new Date(open.openedAt));
    } catch {
      // keep the last quotes
    }
  }

  /** Second 58: read the pair prices and decide, approving one, declining three. */
  async closeStep(now: Date): Promise<Decision> {
    const open = this.open;
    if (!open) throw new Error('no step is open');
    if (open.decision) return open.decision;
    let quotes: Quotes;
    try {
      quotes = await this.client.readQuotes(ACTIONS.map(a => open.proposals[a]), new Date(open.openedAt));
    } catch {
      quotes = emptyQuotes();
    }
    let decision = decide(quotes, this.game.heading);
    // Approve first: if that fails the step is undecided and the snake keeps
    // its heading; the other three are declined regardless so nothing is
    // left pending past the deadline.
    if (decision.approved) {
      try {
        await this.client.decideProposal(open.proposals[decision.approved], 'approve');
      } catch {
        decision = { approved: null, declined: [...ACTIONS], direction: this.game.heading, undecided: true };
      }
    }
    for (const a of decision.declined) {
      if (a === decision.approved) continue;
      try { await this.client.decideProposal(open.proposals[a], 'decline'); } catch { /* logged below as undecided */ }
    }
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
    this.pending = null;
    this.open = null;
    // The reading is stamped at the minute it was taken; the last one before
    // midnight is marked final so the day's books settle on it.
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
   *  the six 60-move books of the open step every call, the twelve near
   *  books once per step late in the minute, the leaderboard once a minute.
   *  Reads only; nothing here can trade. Failures keep the last activity. */
  async pollActivity(now: Date): Promise<void> {
    const open = this.open;
    if (open && open.quotes) {
      if (this.positionsStep !== open.step) { this.positions = new Map(); this.positionsStep = open.step; }
      const near = now.getUTCSeconds() >= NEAR_BOOKS_SECOND && this.nearPolledStep !== open.step;
      const books = this.books(near ? HORIZONS : ['m60']);
      if (books.size > 0) {
        try {
          const activity = await this.client.readActivity([...books.keys()]);
          if (near) this.nearPolledStep = open.step;
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
      try { this.leaderboard = await this.client.readLeaderboard(LEADERBOARD_SIZE); } catch { /* keep the last */ }
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
      games: this.games,
    };
  }

  static fromJSON(client: TelarchyClient, raw: any, rng: Rng = Math.random, opts: OperatorOptions = {}): Operator {
    const op = new Operator(client, raw.game, rng, opts);
    op.open = raw.open ?? null;
    op.decisions = raw.decisions ?? [];
    op.pending = raw.pending ?? null;
    op.completedAt = raw.completedAt ?? null;
    if (op.game.complete === undefined) op.game = { ...op.game, complete: false };
    if (op.game.size === undefined) op.game = { ...op.game, size: GRID, gameNumber: 1 };
    op.bestLength = typeof raw.bestLength === 'number' ? Math.max(raw.bestLength, op.game.length) : op.game.length;
    op.recentTrades = Array.isArray(raw.recentTrades) ? raw.recentTrades : [];
    op.tradersToday = raw.tradersToday && Array.isArray(raw.tradersToday.handles) ? raw.tradersToday : { day: '', handles: [] };
    // A state file from before recording began: the record starts from the
    // game as it stands (docs/snake.md, "The replay").
    op.games = Array.isArray(raw.games) && raw.games.length > 0 ? raw.games : [startRecord(op.game)];
    return op;
  }
}
