// The Telarchy client the operator uses. Deliberately has no trade method:
// docs/snake.md, "The operator account never trades."
import type { ProposalRef, TelarchyClient, Verdict } from './operator.js';
import { emptyDirectionQuotes, type Quotes, type Horizon } from './decide.js';
import type { Direction } from './engine.js';

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
}

type FetchLike = typeof fetch;

const HORIZON_MINUTES: Record<Horizon, number> = { m1: 1, m5: 5, m60: 60 };

/** The minute cell (YYYY-MM-DDTHH:MM, UTC) N minutes after the minute `openedAt` lies in. */
function cellAt(openedAt: Date, minutes: number): string {
  const m = new Date(openedAt);
  m.setUTCSeconds(0, 0);
  return new Date(m.getTime() + minutes * 60_000).toISOString().slice(0, 16);
}

/** The three cells a step's proposals are priced on (docs/snake.md, "The workspace"). */
export function minuteCells(openedAt: Date): Record<Horizon, string> {
  return { m1: cellAt(openedAt, 1), m5: cellAt(openedAt, 5), m60: cellAt(openedAt, 60) };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class HttpTelarchyClient implements TelarchyClient {
  constructor(
    private o: ClientOptions,
    private fetchImpl: FetchLike = fetch,
    private clock: () => Date = () => new Date(),
  ) {}

  private cookie: string | null = null;

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
    const res = await this.fetchImpl(`${this.o.baseUrl}${path}`, {
      method,
      headers: await this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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

  async readQuotes(refs: ProposalRef[], openedAt: Date): Promise<Quotes> {
    const cells = minuteCells(openedAt);
    const out = {} as Quotes;
    for (const ref of refs) {
      const dir = ref.title.replace(/^Move /, '') as Direction;
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
          }
        }
      } catch {
        // unreadable: null prices, the decision rule handles it
      }
      out[dir] = q;
    }
    return out;
  }

  async decideProposal(ref: ProposalRef, verdict: Verdict): Promise<void> {
    if (verdict === 'approve') await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/approve`, {});
    else await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/decline`, { refund: true });
  }

  async refreshBooks(): Promise<void> {
    await this.call('POST', '/predictions/markets/refresh', { force: true });
  }

  async postReading(value: number, at: Date, _final: boolean): Promise<void> {
    if (!Number.isFinite(value)) throw new Error('a reading must be a number');
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, { value, asOf: at.toISOString(), updateNote: 'step reading' });
  }
}
