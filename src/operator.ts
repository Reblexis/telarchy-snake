// The operator loop, docs/snake.md "The step". Talks to Telarchy only through
// TelarchyClient, which has no trade call: the operator never trades.
import { newGame, step as applyStep, type Direction, type GameState, type Rng } from './engine.js';
import { decide, DIRECTIONS, type Decision, type Quotes } from './decide.js';

export interface ProposalRef { id: string; title: string; url: string }
export type Verdict = 'approve' | 'decline';

export interface TelarchyClient {
  postProposal(title: string, description: string, decisionMinutes: number): Promise<ProposalRef>;
  readQuotes(refs: ProposalRef[]): Promise<Quotes>;
  decideProposal(ref: ProposalRef, verdict: Verdict): Promise<void>;
  /** A reading of Snake length at `at`; `final` marks the last reading of a UTC day. */
  postReading(value: number, at: Date, final: boolean): Promise<void>;
  /** Force the workspace's rolling markets to refresh, so the new day's today
   *  book exists before the first proposals of the day (docs/snake.md, "The
   *  workspace"). */
  refreshBooks(): Promise<void>;
}

export interface OpenStep {
  step: number; // the step these proposals decide (game.step + 1)
  openedAt: string;
  decideAt: string;
  proposals: Record<Direction, ProposalRef>;
  quotes: Quotes | null;
  decision: Decision | null;
}

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

const DECIDE_SECOND = 55;
const WINDOW_MINUTES = 1;

const emptyQuotes = (): Quotes => ({
  up: { approved: null, declined: null },
  right: { approved: null, declined: null },
  down: { approved: null, declined: null },
  left: { approved: null, declined: null },
});

function utcDay(d: Date): string { return d.toISOString().slice(0, 10); }
function isoMinute(d: Date): Date { const c = new Date(d); c.setUTCSeconds(0, 0); return c; }

export class Operator {
  game: GameState;
  open: OpenStep | null = null;
  decisions: DecisionRecord[] = [];
  private pending: Direction | null = null; // decided, waiting for the top of minute
  private lastOpenedDay: string | null = null;

  constructor(private client: TelarchyClient, game: GameState, private rng: Rng) {
    this.game = game;
  }

  static fresh(client: TelarchyClient, rng: Rng = Math.random): Operator {
    return new Operator(client, newGame(rng), rng);
  }

  /** Second 0: post the four proposals for the next step. */
  async openStep(now: Date): Promise<OpenStep> {
    if (this.open) throw new Error(`step ${this.open.step} is already open`);
    const day = utcDay(now);
    if (day !== this.lastOpenedDay) {
      // First step of a UTC day (or of this process): make sure the today
      // book is open. A failure here only costs a step's prices.
      try { await this.client.refreshBooks(); } catch { /* undecided path covers it */ }
      this.lastOpenedDay = day;
    }
    const stepNo = this.game.step + 1;
    const g = this.game;
    const description =
      `Step ${stepNo}: snake length ${g.length}, heading ${g.heading}, head at (${g.snake[0].x},${g.snake[0].y}), ` +
      `food at (${g.food.x},${g.food.y}), ${g.deaths} deaths so far. Approve moves the snake this way at the top of the next minute.`;
    const proposals = {} as Record<Direction, ProposalRef>;
    for (const d of DIRECTIONS) {
      proposals[d] = await this.client.postProposal(`Move ${d}`, description, WINDOW_MINUTES);
    }
    const openedAt = isoMinute(now);
    const decideAt = new Date(openedAt.getTime() + DECIDE_SECOND * 1000);
    this.open = { step: stepNo, openedAt: now.toISOString(), decideAt: decideAt.toISOString(), proposals, quotes: null, decision: null };
    return this.open;
  }

  /** Second 55: read the pair prices and decide, approving one, declining three. */
  async closeStep(now: Date): Promise<Decision> {
    const open = this.open;
    if (!open) throw new Error('no step is open');
    if (open.decision) return open.decision;
    let quotes: Quotes;
    try {
      quotes = await this.client.readQuotes(DIRECTIONS.map(d => open.proposals[d]));
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
    const final = utcDay(next) !== utcDay(now);
    await this.client.postReading(this.game.length, now, final);
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
    return {
      game: this.game,
      open: open
        ? {
            step: open.step,
            openedAt: open.openedAt,
            decideAt: open.decideAt,
            proposals: open.proposals,
            quotes: open.quotes ?? emptyQuotes(),
          }
        : null,
      secondsToDecision: open ? Math.max(0, Math.round((Date.parse(open.decideAt) - now.getTime()) / 1000)) : null,
      recentDecisions: this.recentDecisions(),
      deathsToday: this.deathsToday(now),
      stepsTotal: this.game.step,
      now: now.toISOString(),
    };
  }

  toJSON() {
    return { game: this.game, open: this.open, decisions: this.decisions, pending: this.pending, lastOpenedDay: this.lastOpenedDay };
  }

  static fromJSON(client: TelarchyClient, raw: any, rng: Rng = Math.random): Operator {
    const op = new Operator(client, raw.game, rng);
    op.open = raw.open ?? null;
    op.decisions = raw.decisions ?? [];
    op.pending = raw.pending ?? null;
    op.lastOpenedDay = raw.lastOpenedDay ?? null;
    return op;
  }
}
