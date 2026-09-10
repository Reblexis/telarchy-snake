// The Telarchy client the operator uses. Deliberately has no trade method:
// docs/snake.md, "The operator account never trades."
import type { ProposalRef, TelarchyClient, Verdict } from './operator.js';
import type { Quotes, Quote } from './decide.js';
import type { Direction } from './engine.js';

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  workspaceId: string;
  metricId: string;
  workspaceUrl: string;
}

type FetchLike = typeof fetch;

export function periodKeys(now: Date): { today: string; week: string } {
  const today = now.toISOString().slice(0, 10);
  // ISO week: Thursday of this week decides the year.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { today, week: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class HttpTelarchyClient implements TelarchyClient {
  constructor(
    private o: ClientOptions,
    private fetchImpl: FetchLike = fetch,
    private clock: () => Date = () => new Date(),
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.o.baseUrl}${path}`, {
      method,
      headers: {
        'X-Agent-Key': this.o.apiKey,
        'X-Workspace-Id': this.o.workspaceId,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error ?? text.slice(0, 200)}`);
    return json;
  }

  async postProposal(title: string, description: string, decisionMinutes: number): Promise<ProposalRef> {
    const decideBy = new Date(this.clock().getTime() + decisionMinutes * 60_000).toISOString();
    const r = await this.call('POST', '/proposals', { title, description, decideBy });
    return { id: String(r.id), title, url: `${this.o.workspaceUrl}/p/${r.number}` };
  }

  async readQuotes(refs: ProposalRef[]): Promise<Quotes> {
    const keys = periodKeys(this.clock());
    const out = {} as Quotes;
    for (const ref of refs) {
      const dir = ref.title.replace(/^Move /, '') as Direction;
      let q: Quote = { approved: null, declined: null };
      try {
        const r = await this.call('GET', `/proposals/${encodeURIComponent(ref.id)}`);
        const markets: any[] = Array.isArray(r?.markets) ? r.markets : [];
        const m = markets.find(x => x.targetDate === keys.today) ?? markets.find(x => x.targetDate === keys.week);
        if (m) q = { approved: num(m.approved?.consensus), declined: num(m.declined?.consensus) };
      } catch {
        // unreadable: a null price, the decision rule handles it
      }
      out[dir] = q;
    }
    return out;
  }

  async decideProposal(ref: ProposalRef, verdict: Verdict): Promise<void> {
    if (verdict === 'approve') await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/approve`, {});
    else await this.call('POST', `/proposals/${encodeURIComponent(ref.id)}/decline`, { refund: true });
  }

  async postReading(value: number, at: Date, _final: boolean): Promise<void> {
    if (!Number.isFinite(value)) throw new Error('a reading must be a number');
    await this.call('PUT', `/metrics/${encodeURIComponent(this.o.metricId)}`, { value, asOf: at.toISOString(), updateNote: 'step reading' });
  }
}
