// The Telarchy client the operator uses. Deliberately has no trade method:
// docs/snake.md, "The operator account never trades."
import type { LeaderRow, MarketActivity, ProposalRef, TelarchyClient, Verdict } from './operator.js';
import { emptyDirectionQuotes, actionOfTitle, type Quotes, type Horizon } from './decide.js';

export interface SessionAuth {
  /** A browser account (the platform admin on the beta, which is admin-gated
   *  and refuses agent keys). Sign-in lives on the production auth, so its
   *  URL is separate from the store's base URL. */
  email: string;
  password: string;
  authUrl: string;
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  workspaceId: string;
  metricId: string;
  workspaceUrl: string;
  session?: SessionAuth;
  /** docs/snake.md "The step": no call waits without limit. Milliseconds a
   *  read (a poll, an activity read) and a write (a proposal, a decision, a
   *  reading, a settlement, a refresh) may take before it is abandoned. */
  timeouts?: { read?: number; write?: number };
}

/** The bounds when the options name none (docs/snake.md, "The step"). */
export const DEFAULT_TIMEOUTS = { read: 10_000, write: 20_000 };
/** A call slower than this is logged with its path and duration. */
const SLOW_CALL_MS = 5_000;
export const NO_ANSWER = 'no answer';

type FetchLike = typeof fetch;


/** The minute cell (YYYY-MM-DDTHH:MM, UTC) N minutes after the minute `openedAt` lies in. */
function cellAt(openedAt: Date, minutes: number): string {
  const m = new Date(openedAt);
  m.setUTCSeconds(0, 0);
  return new Date(m.getTime() + minutes * 60_000).toISOString().slice(0, 16);
}

/** The one cell a step's proposals are priced on, sixty minutes out (docs/snake.md, "The workspace"). */
export function minuteCells(openedAt: Date): Record<Horizon, string> {
  return { m60: cellAt(openedAt, 60) };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class HttpTelarchyClient implements TelarchyClient {
  constructor(
    private o: ClientOptions,
    private fetchImpl: FetchLike = fetch,
    private clock: () => Date = () => new Date(),
  ) {}

  private cookie: string | null = null;

  private bound(kind: 'read' | 'write'): number {
    return this.o.timeouts?.[kind] ?? DEFAULT_TIMEOUTS[kind];
  }

  /** One bounded request: aborted after the bound with a "no answer" error,
   *  logged when slow (docs/snake.md, "The step"). */
  private async request(url: string, init: RequestInit, kind: 'read' | 'write'): Promise<Response> {
    const ms = this.bound(kind);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error(`${NO_ANSWER} in ${ms}ms`)), ms);
    const started = Date.now();
    try {
      return await this.fetchImpl(url, { ...init, signal: ctl.signal });
    } catch (e) {
      const err = e as Error;
      if (ctl.signal.aborted) throw new Error(`${init.method ?? 'GET'} ${new URL(url).pathname} -> ${NO_ANSWER} in ${ms}ms`);
      throw err;
    } finally {
      clearTimeout(timer);
      const took = Date.now() - started;
      if (took >= SLOW_CALL_MS) console.error(`slow call: ${init.method ?? 'GET'} ${new URL(url).pathname} took ${(took / 1000).toFixed(1)}s`);
    }
  }

  private async signIn(): Promise<void> {
    const s = this.o.session!;
    const res = await this.fetchImpl(`${s.authUrl}/auth/sign-in/email`, {
      method: 'POST',
      // better-auth refuses a POST whose Origin is null, which is what Node's
      // fetch sends by default; name the site as the origin.
      headers: { 'Content-Type': 'application/json', Origin: new URL(s.authUrl).origin },
      body: JSON.stringify({ email: s.email, password: s.password }),
    });
    if (!res.ok) throw new Error(`sign-in -> ${res.status}`);
    const raw: string[] = typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : [res.headers.get('set-cookie') ?? ''];
    const pairs = raw.filter(Boolean).map(c => c.split(';')[0].trim());
    if (pairs.length === 0) throw new Error('sign-in returned no session cookie');
    this.cookie = pairs.join('; ');
  }

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'X-Workspace-Id': this.o.workspaceId, 'Content-Type': 'application/json' };
    if (this.o.session) {
      if (!this.cookie) await this.signIn();
      h['Cookie'] = this.cookie!;
    } else {
      h['X-Agent-Key'] = this.o.apiKey;
    }
    return h;
  }

  private async call(method: string, path: string, body?: unknown, retried = false): Promise<any> {
    const res = await this.request(`${this.o.baseUrl}${path}`, {
      method,
      headers: await this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    }, method === 'GET' ? 'read' : 'write');
    // The beta gate answers a stale session with a bare 404, a route with 401.
    if (this.o.session && !retried && (res.status === 401 || res.status === 404)) {
      this.cookie = null;
      return this.call(method, path, body, true);
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error ?? text.slice(0, 200)}`);
    return json;
  }

  async postProposal(title: string, description: string, decideBy: Date): Promise<ProposalRef> {
    const r = await this.call('POST', '/proposals', { title, description, decideBy: decideBy.toISOString() });
    return { id: String(r.id), title, url: `${this.o.workspaceUrl}/p/${r.number}` };
  }

  /** The three proposals are read at once, and a missing price says why
   *  (docs/snake.md "The step", `undecidedReason`). */
  async readQuotes(refs: ProposalRef[], cell: string): Promise<Quotes> {
    const cells: Record<Horizon, string> = { m60: cell };
    const out = {} as Quotes;
    await Promise.all(refs.map(async ref => {
      const action = actionOfTitle(ref.title);
      if (!action) return;
      const q = emptyDirectionQuotes();
      try {
        const r = await this.call('GET', `/proposals/${encodeURIComponent(ref.id)}`);
        const markets: any[] = Array.isArray(r?.markets) ? r.markets : [];
        for (const h of Object.keys(cells) as Horizon[]) {
          const cell = cells[h];
          // By target date when the summary names one, else by the settlement
          // instant, which is the end of the cell (one minute after it).
          const end = Date.parse(`${cell}:00Z`) + 60_000;
          const m =
            markets.find(x => x.targetDate === cell) ??
            markets.find(x => !x.targetDate && typeof x.resolvesOn === 'string' && Date.parse(x.resolvesOn) === end);
          if (m) {
            q[h] = { approved: num(m.approved?.consensus), declined: num(m.declined?.consensus) };
            const aId = m.approved?.marketId ?? m.approvedMarketId;
            const dId = m.declined?.marketId ?? m.declinedMarketId;
            if (typeof aId === 'string') q[h].approvedMarketId = aId;
            if (typeof dId === 'string') q[h].declinedMarketId = dId;
            if (q[h].approved === null || q[h].declined === null) q[h].reason = 'no consensus';
          } else {
            q[h].reason = `no pair on ${cell}`;
          }
        }
      } catch (e) {
        // unreadable: null prices, the decision rule handles it
        for (const h of Object.keys(cells) as Horizon[]) q[h].reason = (e as Error).message;
      }
      out[action] = q;
    }));
    return out;
  }

  async decideProposal(ref: ProposalRef, verdict: Verdict): Promise<void> {
    if (verdict === 'approve') await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/approve`, {});
    else await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/decline`, { refund: true });
  }

  async setRange(max: number): Promise<void> {
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, { marketRangeMax: max });
  }

  /** docs/snake.md "The workspace": the attempt's cell becomes the metric's
   *  only horizon, an absolute minute; the credits the metric already has
   *  move with it. */
  async setHorizon(cell: string): Promise<void> {
    const m = await this.call('GET', `/metrics/${encodeURIComponent(this.o.metricId)}`);
    const credits: Record<string, unknown> = m?.timePreference?.horizonCredits ?? {};
    const first = Object.values(credits)[0] as { book?: number; proposal?: number } | undefined;
    const entry = { book: first?.book ?? 25, proposal: first?.proposal ?? 40 };
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, {
      timePreference: { enabled: false, customHorizons: [cell], horizonCredits: { [cell]: entry } },
    });
  }

  async refreshBooks(): Promise<void> {
    await this.call('POST', '/predictions/markets/refresh', { force: true });
  }

  /** The workspace slug, the last segment of its public url (telarchy.com/snake). */
  private slug(): string {
    return new URL(this.o.workspaceUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  }

  private async publicGet(path: string): Promise<any> {
    const res = await this.request(`${this.o.baseUrl}${path}`, { method: 'GET', headers: { Accept: 'application/json' } }, 'read');
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json();
  }

  /** docs/snake.md "The feed": the public market-activity read, one call per book. */
  async readActivity(marketIds: string[]): Promise<Record<string, MarketActivity>> {
    const out: Record<string, MarketActivity> = {};
    const slug = encodeURIComponent(this.slug());
    await Promise.all(marketIds.map(async id => {
      try {
        const r = await this.publicGet(`/marketplace/${slug}/market-activity?marketId=${encodeURIComponent(id)}`);
        out[id] = {
          consensus: num(r?.consensus),
          positions: (Array.isArray(r?.positions) ? r.positions : []).map((p: any) => ({
            handle: String(p.handle ?? p.id ?? '?'), direction: p.direction === 'lower' ? 'lower' : 'higher',
            shares: Number(p.shares) || 0, cost: Number(p.cost) || 0, worth: num(p.worth),
          })),
          trades: (Array.isArray(r?.trades) ? r.trades : []).map((t: any) => ({
            id: String(t.id), handle: String(t.handle ?? '?'), direction: t.direction === 'lower' ? 'lower' : 'higher',
            kind: t.kind === 'sell' ? 'sell' : 'buy', shares: Number(t.shares) || 0, cost: Number(t.cost) || 0, createdAt: String(t.createdAt),
          })),
        };
      } catch {
        // left out: the operator keeps the last activity of that book
      }
    }));
    return out;
  }

  /** docs/snake.md "The feed": the public leaderboard scoped to this workspace. */
  async readLeaderboard(limit: number): Promise<LeaderRow[]> {
    const r = await this.publicGet(`/leaderboard?workspaceId=${encodeURIComponent(this.o.workspaceId)}&limit=${limit}`);
    const rows: any[] = Array.isArray(r?.participants) ? r.participants : [];
    return rows.map((p, i) => ({
      rank: Number(p.rank) || i + 1,
      handle: String(p.nickname ?? p.handle ?? p.id ?? '?'),
      profit: Number(p.totalEarnings) || 0,
      trades: Number(p.totalTrades) || 0,
    }));
  }

  /** docs/snake.md "The workspace", "When the attempt ends the answer is known":
   *  Telarchy's early settlement of every open book on the metric. */
  async settleMetric(value: number, at: Date, reason: string): Promise<void> {
    if (!Number.isFinite(value)) throw new Error('a settlement value must be a number');
    await this.call('POST', `/metrics/${encodeURIComponent(this.o.metricId)}/settle`, { value, asOf: at.toISOString(), reason });
  }

  async postReading(value: number, at: Date, _final: boolean): Promise<void> {
    if (!Number.isFinite(value)) throw new Error('a reading must be a number');
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, { value, asOf: at.toISOString(), updateNote: 'step reading' });
  }
}
