// The operator loop, docs/snake.md "The step". Talks to Telarchy only through
// TelarchyClient, which has no trade call: the operator never trades.
import { newGame, step as applyStep, type Direction, type GameState, type Rng } from './engine.js';
import { decide, DIRECTIONS, emptyQuotes, type Decision, type Quotes, type Horizon } from './decide.js';
import { minuteCells } from './client.js';

export interface ProposalRef { id: string; title: string; url: string }
export type Verdict = 'approve' | 'decline';

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
  proposals: Record<Direction, ProposalRef>;
  quotes: Quotes | null;
  decision: Decision | null;
}

export interface OperatorOptions {
  boardUrl?: string;
  workspaceId?: string;
  metricId?: string;
}

export const RULE = 'Every minute four proposals, one per direction, each priced on the snake length in 1, 5 and 60 moves. At :58 the proposal with the highest 60-move impact (approved minus declined) is approved and the other three are declined with refund; ties keep the heading. The snake moves at :00.';

export interface DecisionRecord {
  step: number;
  at: string;
  direction: Direction;
  approved: Direction | null;
  undecided: boolean;
  quotes: Quotes;
  proposals: Record<Direction, ProposalRef>;
  lengthBefore: number;
  lengthAfter: number | null;
  deathsBefore: number;
}

const DECIDE_SECOND = 58;

function utcDay(d: Date): string { return d.toISOString().slice(0, 10); }
function isoMinute(d: Date): Date { const c = new Date(d); c.setUTCSeconds(0, 0); return c; }

export class Operator {
  game: GameState;
  open: OpenStep | null = null;
  decisions: DecisionRecord[] = [];
  private pending: Direction | null = null; // decided, waiting for the top of minute

  constructor(private client: TelarchyClient, game: GameState, private rng: Rng, private opts: OperatorOptions = {}) {
    this.game = game;
  }

  static fresh(client: TelarchyClient, rng: Rng = Math.random, opts: OperatorOptions = {}): Operator {
    return new Operator(client, newGame(rng), rng, opts);
  }

  /** Second 0: post the four proposals for the next step. */
  async openStep(now: Date): Promise<OpenStep> {
    if (this.open) throw new Error(`step ${this.open.step} is already open`);
    if (this.game.complete) throw new Error('the game is complete');
    // Every step: make sure the three minute cells have their baseline books.
    // A failure here only costs this step's prices (the undecided path).
    try { await this.client.refreshBooks(); } catch { /* undecided path covers it */ }
    const stepNo = this.game.step + 1;
    const g = this.game;
    const openedAt = isoMinute(now);
    const deadline = new Date(openedAt.getTime() + 60_000);
    const decideAt = new Date(openedAt.getTime() + DECIDE_SECOND * 1000);
    const cells = minuteCells(now);
    const hhmm = (c: string) => c.slice(11);
    const board = this.opts.boardUrl ? ` Board: ${this.opts.boardUrl}.` : '';
    const description =
      `Step ${stepNo}: snake length ${g.length}, heading ${g.heading}, head at (${g.snake[0].x},${g.snake[0].y}), ` +
      `food at (${g.food.x},${g.food.y}), ${g.deaths} deaths so far. Priced on the length in 1, 5 and 60 moves ` +
      `(${hhmm(cells.m1)}, ${hhmm(cells.m5)}, ${hhmm(cells.m60)} UTC). The highest 60-move impact is approved at :58, ` +
      `the others are declined with refund; the snake moves at :00.${board}`;
    // All four at once, so they land in the same second and share the deadline.
    const refs = await Promise.all(DIRECTIONS.map(d => this.client.postProposal(`Move ${d}`, description, deadline)));
    const proposals = {} as Record<Direction, ProposalRef>;
    DIRECTIONS.forEach((d, i) => { proposals[d] = refs[i]; });
    this.open = {
      step: stepNo,
      openedAt: now.toISOString(),
      decideAt: decideAt.toISOString(),
      deadline: deadline.toISOString(),
      cells,
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
      open.quotes = await this.client.readQuotes(DIRECTIONS.map(d => open.proposals[d]), new Date(open.openedAt));
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
      quotes = await this.client.readQuotes(DIRECTIONS.map(d => open.proposals[d]), new Date(open.openedAt));
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
        decision = { approved: null, declined: [...DIRECTIONS], direction: this.game.heading, undecided: true };
      }
    }
    for (const d of decision.declined) {
      if (d === decision.approved) continue;
      try { await this.client.decideProposal(open.proposals[d], 'decline'); } catch { /* logged below as undecided */ }
    }
    open.quotes = quotes;
    open.decision = decision;
    this.pending = decision.direction;
    this.decisions.push({
      step: open.step,
      at: now.toISOString(),
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
    if (this.open && !this.open.decision) await this.closeStep(now);
    const dir = this.pending ?? this.game.heading;
    const before = this.game;
    this.game = applyStep(before, dir, this.rng);
    const rec = this.decisions[this.decisions.length - 1];
    if (rec && rec.lengthAfter === null) rec.lengthAfter = this.game.length;
    this.pending = null;
    this.open = null;
    // The reading is stamped at the minute it was taken; the last one before
    // midnight is marked final so the day's books settle on it.
    const next = new Date(now.getTime() + 60_000);
    const final = utcDay(next) !== utcDay(now) || this.game.complete;
    await this.client.postReading(this.game.length, now, final);
    if (this.game.complete) return; // the final reading; no more proposals
    await this.openStep(now);
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
    return {
      game: this.game,
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
  }

  toJSON() {
    return { game: this.game, open: this.open, decisions: this.decisions, pending: this.pending };
  }

  static fromJSON(client: TelarchyClient, raw: any, rng: Rng = Math.random, opts: OperatorOptions = {}): Operator {
    const op = new Operator(client, raw.game, rng, opts);
    op.open = raw.open ?? null;
    op.decisions = raw.decisions ?? [];
    op.pending = raw.pending ?? null;
    if (op.game.complete === undefined) op.game = { ...op.game, complete: false };
    return op;
  }
}
