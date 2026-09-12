import { describe, it, expect } from 'vitest';
import { HttpTelarchyClient, minuteCells } from '../src/client.js';
import { proposalOptions, OPTION_LABEL } from '../src/decide.js';

type Req = { url: string; method: string; headers: Record<string, string>; body: any };

function fakeFetch(handler: (r: Req) => { status?: number; json: any }) {
  const reqs: Req[] = [];
  const fetchImpl = async (url: string, init: any = {}) => {
    const r: Req = { url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(r);
    const out = handler(r);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { reqs, fetchImpl };
}

const opts = { baseUrl: 'https://telarchy.com/api', apiKey: 'k', workspaceId: 'ws1', metricId: 'm1', workspaceUrl: 'https://telarchy.com/snake' };
const OPTIONS = proposalOptions();
const REF = { id: 'p-1', number: 1, url: 'https://telarchy.com/snake/p/1' };
/** One row's options as the app returns them: each option's consensus, its delta against the best other, and its market id. */
function row(px: Record<'forward' | 'left' | 'right', number | null>) {
  return (['forward', 'left', 'right'] as const).map(id => {
    const others = (['forward', 'left', 'right'] as const).filter(o => o !== id).map(o => px[o]).filter((v): v is number => v !== null);
    const c = px[id];
    return { id, label: OPTION_LABEL[id], marketId: `m-${id}`, consensus: c, liquidity: 1000, tradeCount: 0, resolved: false, voided: false, actualValue: null,
      delta: c === null || others.length === 0 ? null : c - Math.max(...others) };
  });
}

describe('the Telarchy client (docs/snake.md, "The workspace" and "The step")', () => {
  it('posts ONE proposal with the three options in order, the agent key and workspace header, no subsidy, the given deadline, and returns its id, number and public url', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ status: 201, json: { id: 'p-1', number: 41, conditionalMarketIds: [], options: OPTIONS } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:00.400Z'));
    const ref = await c.postProposal('Game 1, attempt 1, move 1', 'I will ...', new Date('2026-09-11T10:01:00Z'), OPTIONS);
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals');
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].headers['X-Agent-Key']).toBe('k');
    expect(reqs[0].headers['X-Workspace-Id']).toBe('ws1');
    expect(reqs[0].body.title).toBe('Game 1, attempt 1, move 1');
    expect(reqs[0].body.description).toBe('I will ...');
    expect(reqs[0].body.options).toEqual([
      { id: 'forward', label: 'Continue forward' }, { id: 'left', label: 'Turn left' }, { id: 'right', label: 'Turn right' },
    ]);
    expect('liquiditySubsidy' in reqs[0].body).toBe(false);
    expect(reqs[0].body.decideBy).toBe('2026-09-11T10:01:00.000Z'); // the deadline is given, not derived from posting time
    expect(ref).toEqual({ id: 'p-1', number: 41, url: 'https://telarchy.com/snake/p/41' });
  });

  it('reads the one proposal once and takes each option\'s price, lead and market id from the row on the attempt\'s cell; other cells are not read', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { id: 'p-1', markets: [
      { targetDate: '2026-09-11T10:01', options: row({ forward: 1, left: 1, right: 1 }) },
      { targetDate: '2026-09-11T11:00', options: row({ forward: 4, left: 2, right: 5 }) },
      { targetDate: '2026-09-11', options: row({ forward: 99, left: 99, right: 99 }) },
    ] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00.400Z')).m60);
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals/p-1');
    expect(q.right.m60).toEqual({ price: 5, lead: 1, marketId: 'm-right' });
    expect(q.forward.m60).toEqual({ price: 4, lead: -1, marketId: 'm-forward' });
    expect(q.left.m60).toEqual({ price: 2, lead: -3, marketId: 'm-left' });
    expect(Object.keys(q.right)).toEqual(['m60']);
  });

  it('an option row without a consensus is a null price with the reason "no consensus"; its lead is null too', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [{ targetDate: '2026-09-11T11:00', options: [
      { id: 'forward', label: 'Continue forward', marketId: 'm-forward', consensus: 4, delta: null },
      { id: 'left', label: 'Turn left', marketId: 'm-left', consensus: null, delta: null },
      { id: 'right', label: 'Turn right', marketId: 'm-right', consensus: null, delta: null },
    ] }] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    const q = await c.readQuotes(REF, '2026-09-11T11:00');
    expect(q.forward.m60).toEqual({ price: 4, lead: null, marketId: 'm-forward' });
    expect(q.left.m60).toEqual({ price: null, lead: null, marketId: 'm-left', reason: 'no consensus' });
  });

  it('AN OLDER APP THAT RETURNS NO OPTIONS ON THE ROW gives every action a null price and says so, without crashing', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [
      { targetDate: '2026-09-11T11:00', approved: { consensus: 4, marketId: 'a' }, declined: { consensus: 3, marketId: 'd' } },
    ] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    const q = await c.readQuotes(REF, '2026-09-11T11:00');
    for (const a of ['forward', 'left', 'right'] as const) {
      expect(q[a].m60.price).toBe(null);
      expect(q[a].m60.lead).toBe(null);
      expect(q[a].m60.marketId).toBeUndefined();
      expect(q[a].m60.reason).toBe('no options on 2026-09-11T11:00');
    }
  });

  it('an option the row does not carry is a null price naming the missing option', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [{ targetDate: '2026-09-11T11:00', options: row({ forward: 4, left: 2, right: 5 }).filter(o => o.id !== 'left') }] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    const q = await c.readQuotes(REF, '2026-09-11T11:00');
    expect(q.forward.m60.price).toBe(4);
    expect(q.left.m60).toEqual({ price: null, lead: null, reason: 'no option left on 2026-09-11T11:00' });
  });

  it('matches a minute cell by its settlement instant when the row carries no target date (production shape)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [
      { resolvesOn: '2026-09-11T11:01:00Z', options: row({ forward: 4.5, left: 3, right: 3 }) },
      { resolvesOn: '2026-09-11T10:06:00.000Z', options: row({ forward: 2, left: 2, right: 2 }) },
      { resolvesOn: '2026-09-11T10:02:00Z', options: row({ forward: 1, left: 1, right: 1 }) },
    ] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00Z')).m60);
    expect(q.forward.m60).toEqual({ price: 4.5, lead: 1.5, marketId: 'm-forward' });
    expect(Object.keys(q.forward)).toEqual(['m60']);
  });

  it('the cells roll over the hour and the day correctly', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [
      { targetDate: '2026-09-12T00:00', options: row({ forward: 1, left: 1, right: 1 }) },
      { targetDate: '2026-09-12T00:04', options: row({ forward: 5, left: 5, right: 5 }) },
      { targetDate: '2026-09-12T00:59', options: row({ forward: 60, left: 61, right: 60 }) },
    ] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T23:59:55Z'));
    const q = await c.readQuotes(REF, minuteCells(new Date('2026-09-11T23:59:00Z')).m60);
    expect(q.left.m60.price).toBe(61);
  });

  it('a proposal that cannot be read is a null price on every action with the error, not a throw', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, json: { error: 'boom' } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00Z')).m60);
    for (const a of ['forward', 'left', 'right'] as const) expect(q[a].m60).toEqual({ price: null, lead: null, reason: expect.stringMatching(/GET \/proposals\/p-1 -> 500/) });
  });

  it('THE APPROVAL CARRIES THE CHOSEN OPTION: approve posts { option } to /approve in one call', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { ok: true } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.approveOption(REF, 'right');
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals/p-1/approve');
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].body).toEqual({ option: 'right' });
  });

  it('decline posts to /decline with refund: true so every option voids and refunds', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { ok: true } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.declineProposal(REF);
    expect(reqs.length).toBe(1);
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals/p-1/decline');
    expect(reqs[0].body).toEqual({ refund: true });
  });

  it('a failed decision throws with the status so the operator can take the undecided path', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 409, json: { error: 'no' } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await expect(c.approveOption(REF, 'left')).rejects.toThrow(/409/);
    await expect(c.declineProposal(REF)).rejects.toThrow(/409/);
  });

  it('posts a reading as PUT /metrics/:id with the value and its timestamp, and never null', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { ok: true } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.postReading(7, new Date('2026-09-11T23:59:00Z'), true);
    expect(reqs[0].url).toBe('https://telarchy.com/api/metrics/m1');
    expect(reqs[0].method).toBe('PUT');
    expect(reqs[0].body).toEqual({ value: 7, asOf: '2026-09-11T23:59:00.000Z', updateNote: 'step reading' });
    expect(reqs[0].body.value).not.toBeNull();
  });

  it('settles the metric early with POST /metrics/:id/settle carrying the value, the reason and asOf, and throws on failure', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { settled: ['a', 'b'], count: 2 } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.settleMetric(9, new Date('2026-09-11T10:01:00Z'), 'Game 1, attempt 3 ended at length 9');
    expect(reqs[0].url).toBe('https://telarchy.com/api/metrics/m1/settle');
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].body).toEqual({ value: 9, asOf: '2026-09-11T10:01:00.000Z', reason: 'Game 1, attempt 3 ended at length 9' });
    const bad = new HttpTelarchyClient(opts, fakeFetch(() => ({ status: 500, json: { error: 'boom' } })).fetchImpl as any);
    await expect(bad.settleMetric(9, new Date(), 'x')).rejects.toThrow(/500/);
  });

  it('raises the metric range with PUT /metrics/:id marketRangeMax, and throws on 409 so the operator can retry', async () => {
    const { reqs, fetchImpl } = fakeFetch(r => r.body?.marketRangeMax === 169 ? { json: { ok: true } } : { status: 409, json: { error: 'traded' } });
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.setRange(169);
    expect(reqs[0].url).toBe('https://telarchy.com/api/metrics/m1');
    expect(reqs[0].method).toBe('PUT');
    expect(reqs[0].body).toEqual({ marketRangeMax: 169 });
    await expect(c.setRange(196)).rejects.toThrow(/409/);
  });

  it('the client has no trade method', () => {
    const c = new HttpTelarchyClient(opts);
    expect((c as any).trade).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(c)).some(n => /trade|order/i.test(n))).toBe(false);
  });

  it('sets the attempt\'s cell as the metric\'s only horizon, an absolute minute, carrying the credits the metric already has', async () => {
    const { reqs, fetchImpl } = fakeFetch(r => r.method === 'GET'
      ? { json: { id: 'm1', timePreference: { enabled: false, customHorizons: ['2026-09-11T10:30'], horizonCredits: { '2026-09-11T10:30': { book: 1000, proposal: 1000 } } } } }
      : { json: { ok: true } });
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.setHorizon('2026-09-11T11:00');
    const put = reqs.find(r => r.method === 'PUT')!;
    expect(put.url).toBe('https://telarchy.com/api/metrics/m1');
    expect(put.body).toEqual({ timePreference: { enabled: false, customHorizons: ['2026-09-11T11:00'], horizonCredits: { '2026-09-11T11:00': { book: 1000, proposal: 1000 } } } });
    const bare = new HttpTelarchyClient(opts, fakeFetch(r => r.method === 'GET' ? { json: { id: 'm1', timePreference: null } } : { json: { ok: true } }).fetchImpl as any);
    await bare.setHorizon('2026-09-11T11:00');
  });

  /**
   * A METRIC WITH NO CREDITS YET STILL GETS THE DOCUMENTED DEPTH
   * (docs/snake.md, "The workspace": 1,000 credits an option).
   *
   * This fallback is the only place the number is written down in code, and
   * it had been left at 40. Once it was used, every option book on the floor
   * opened with 40 credits instead of 1,000, so two credits moved a price
   * from 2.00 to 6.58 and the market could not be traded seriously. Nothing
   * reported an error: the books existed, they were just shallow.
   */
  it('a metric carrying no credits gets the documented 1,000 an option, not a thin fallback', async () => {
    for (const tp of [null, undefined, {}, { enabled: false, customHorizons: [] }, { horizonCredits: {} }]) {
      const { reqs, fetchImpl } = fakeFetch(r =>
        r.method === 'GET' ? { json: { id: 'm1', timePreference: tp } } : { json: { ok: true } },
      );
      const c = new HttpTelarchyClient(opts, fetchImpl as any);
      await c.setHorizon('2026-09-11T11:00');
      const put = reqs.find(r => r.method === 'PUT')!;
      const entry = (put.body as any).timePreference.horizonCredits['2026-09-11T11:00'];
      expect(entry.proposal).toBe(1000);
      expect(entry.book).toBe(25);
    }
  });

  it('minute cell: the one cell sixty minutes after the opening minute, named YYYY-MM-DDTHH:MM', () => {
    expect(minuteCells(new Date('2026-09-11T10:00:40Z'))).toEqual({ m60: '2026-09-11T11:00' });
    expect(minuteCells(new Date('2026-12-31T23:59:00Z'))).toEqual({ m60: '2027-01-01T00:59' });
  });
});

describe('session auth for the beta store (docs/snake.md, "Operation")', () => {
  it('signs in with email and password and sends the session cookie instead of an agent key', async () => {
    const { reqs, fetchImpl } = fakeFetch(r => {
      if (r.url.endsWith('/auth/sign-in/email')) return { json: { token: 't' } };
      return { json: { ok: true } };
    });
    // The sign-in response carries the cookie in Set-Cookie; the fake returns it via headers below.
    const fetchWithCookie = async (url: string, init: any) => {
      const res = await fetchImpl(url, init);
      if (url.endsWith('/auth/sign-in/email')) res.headers.set('set-cookie', '__Secure-better-auth.session_token=abc; Path=/; HttpOnly');
      return res;
    };
    const c = new HttpTelarchyClient({ ...opts, apiKey: '', session: { email: 'a@b', password: 'pw', authUrl: 'https://telarchy.com/api' } }, fetchWithCookie as any);
    await c.postReading(3, new Date('2026-09-11T10:00:00Z'), false);
    expect(reqs[0].url).toBe('https://telarchy.com/api/auth/sign-in/email');
    expect(reqs[0].body).toEqual({ email: 'a@b', password: 'pw' });
    expect(reqs[1].headers['Cookie']).toBe('__Secure-better-auth.session_token=abc');
    expect(reqs[1].headers['X-Agent-Key']).toBeUndefined();
  });

  it('signs in again once when the session is refused, then retries the call', async () => {
    let calls = 0;
    const { reqs, fetchImpl } = fakeFetch(r => {
      if (r.url.endsWith('/auth/sign-in/email')) return { json: { token: 't' } };
      calls++;
      return calls === 1 ? { status: 404, json: { error: 'Not found' } } : { json: { ok: true } };
    });
    const fetchWithCookie = async (url: string, init: any) => {
      const res = await fetchImpl(url, init);
      if (url.endsWith('/auth/sign-in/email')) res.headers.set('set-cookie', `s=v${reqs.length}; Path=/`);
      return res;
    };
    const c = new HttpTelarchyClient({ ...opts, apiKey: '', session: { email: 'a@b', password: 'pw', authUrl: 'https://telarchy.com/api' } }, fetchWithCookie as any);
    await c.postReading(3, new Date('2026-09-11T10:00:00Z'), false);
    const signIns = reqs.filter(r => r.url.endsWith('/auth/sign-in/email'));
    expect(signIns.length).toBe(2);
    expect(reqs[reqs.length - 1].headers['Cookie']).toBe('s=v3');
  });
});

describe('the activity reads (docs/snake.md, "The feed")', () => {
  it('readActivity asks the public market-activity endpoint of the workspace slug once per book and maps positions and trades', async () => {
    const { reqs, fetchImpl } = fakeFetch(r => {
      const id = new URL(r.url).searchParams.get('marketId');
      return { json: { consensus: id === 'a' ? 3.5 : null, positions: [{ handle: 'ada', id: 'x', direction: 'higher', shares: 2, cost: 5, worth: 6 }], trades: [{ id: 't1', handle: 'ada', direction: 'lower', kind: 'sell', shares: 1, cost: 0.5, createdAt: '2026-09-11T10:00:04.000Z' }], pool: [] } };
    });
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    const out = await c.readActivity(['a', 'b']);
    expect(reqs.map(r => r.url).sort()).toEqual([
      'https://telarchy.com/api/marketplace/snake/market-activity?marketId=a',
      'https://telarchy.com/api/marketplace/snake/market-activity?marketId=b',
    ]);
    expect(reqs.every(r => r.method === 'GET')).toBe(true);
    expect(out.a).toEqual({ consensus: 3.5, positions: [{ handle: 'ada', direction: 'higher', shares: 2, cost: 5, worth: 6 }], trades: [{ id: 't1', handle: 'ada', direction: 'lower', kind: 'sell', shares: 1, cost: 0.5, createdAt: '2026-09-11T10:00:04.000Z' }] });
    expect(out.b.consensus).toBe(null);
  });

  it('readActivity drops a book whose read fails and keeps the others', async () => {
    const { fetchImpl } = fakeFetch(r => (r.url.endsWith('=bad') ? { status: 500, json: { error: 'x' } } : { json: { consensus: 1, positions: [], trades: [], pool: [] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    const out = await c.readActivity(['ok', 'bad']);
    expect(Object.keys(out)).toEqual(['ok']);
  });

  it('readActivity with no ids makes no request', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: {} }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    expect(await c.readActivity([])).toEqual({});
    expect(reqs.length).toBe(0);
  });

  it('readLeaderboard asks the public leaderboard scoped to this workspace and maps rank, handle, profit and trades', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { participants: [
      { rank: 1, id: 'a1', nickname: 'ada', totalEarnings: 12.5, totalTrades: 9 },
      { rank: 2, id: 'b2', nickname: null, totalEarnings: -1, totalTrades: 2 },
    ] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    const rows = await c.readLeaderboard(5);
    expect(reqs[0].url).toBe('https://telarchy.com/api/leaderboard?workspaceId=ws1&limit=5');
    expect(rows).toEqual([{ rank: 1, handle: 'ada', profit: 12.5, trades: 9 }, { rank: 2, handle: 'b2', profit: -1, trades: 2 }]);
  });

  it('the client still has no trade call', () => {
    const c = new HttpTelarchyClient(opts, (async () => new Response('{}')) as any);
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(c));
    expect(names.some(n => /trade|order/i.test(n))).toBe(false);
  });
});

describe('bounded calls (docs/snake.md, "The step": "No call to Telarchy waits without limit")', () => {
  /** A fetch that never answers unless the request's signal aborts it. */
  function hungFetch() {
    const fetchImpl = (_url: string, init: any = {}) => new Promise<Response>((_resolve, reject) => {
      const s: AbortSignal | undefined = init.signal;
      if (!s) return; // no bound: hang for ever, which is what the test must not see
      s.addEventListener('abort', () => reject(s.reason ?? new Error('aborted')));
    });
    return fetchImpl;
  }
  const bounded = { ...opts, timeouts: { read: 30, write: 30 } };

  it('a read that does not answer within the bound is abandoned: readQuotes returns null prices with the reason "no answer"', async () => {
    const c = new HttpTelarchyClient(bounded, hungFetch() as any);
    const t = Date.now();
    const q = await c.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00Z')).m60);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(q.left.m60.price).toBe(null);
    expect(q.left.m60.reason).toMatch(/no answer/);
  });

  it('a write that does not answer within the bound throws, so the operator takes its failure path instead of waiting', async () => {
    const c = new HttpTelarchyClient(bounded, hungFetch() as any);
    await expect(c.approveOption(REF, 'left')).rejects.toThrow(/no answer|abort|timeout/i);
    await expect(c.declineProposal(REF)).rejects.toThrow(/no answer|abort|timeout/i);
    await expect(c.settleMetric(4, new Date(), 'Game 1, attempt 1 ended at length 4')).rejects.toThrow(/no answer|abort|timeout/i);
    await expect(c.postProposal('Game 1, attempt 1, move 1', 'x', new Date(Date.now() + 60_000), OPTIONS)).rejects.toThrow(/no answer|abort|timeout/i);
  });

  it('the public reads are bounded too: a hung activity read leaves that book out, a hung leaderboard read throws', async () => {
    const c = new HttpTelarchyClient(bounded, hungFetch() as any);
    const t = Date.now();
    expect(await c.readActivity(['m1'])).toEqual({});
    await expect(c.readLeaderboard(5)).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('every request carries an abort signal (the bound), with the default bounds when none are given', async () => {
    const seen: any[] = [];
    const fetchImpl = async (_url: string, init: any = {}) => { seen.push(init.signal); return new Response('{"markets":[]}', { status: 200 }); };
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.readQuotes(REF, minuteCells(new Date()).m60);
    await c.refreshBooks();
    expect(seen.length).toBe(2);
    expect(seen.every(s => s instanceof AbortSignal)).toBe(true);
  });

  it('a null price says why: no book on the cell, no consensus, or the error', async () => {
    const noRow = new HttpTelarchyClient(opts, fakeFetch(() => ({ json: { markets: [{ resolvesOn: '2026-09-11T10:02:00Z', options: row({ forward: 2, left: 2, right: 2 }) }] } })).fetchImpl as any);
    const q1 = await noRow.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00Z')).m60);
    expect(q1.forward.m60).toEqual({ price: null, lead: null, reason: 'no book on 2026-09-11T11:00' });
    const partial = new HttpTelarchyClient(opts, fakeFetch(() => ({ json: { markets: [{ resolvesOn: '2026-09-11T11:01:00Z', options: row({ forward: 3, left: null, right: 4 }) }] } })).fetchImpl as any);
    const q2 = await partial.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00Z')).m60);
    expect(q2.left.m60.reason).toBe('no consensus');
    expect(q2.forward.m60.price).toBe(3);
    expect(q2.forward.m60.reason).toBeUndefined();
    const broken = new HttpTelarchyClient(opts, fakeFetch(() => ({ status: 500, json: { error: 'boom' } })).fetchImpl as any);
    const q3 = await broken.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00Z')).m60);
    expect(q3.right.m60.reason).toMatch(/GET \/proposals\/p-1 -> 500/);
  });

  it('a priced option carries no reason', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [{ resolvesOn: '2026-09-11T11:01:00Z', options: row({ forward: 3, left: 2, right: 2 }) }] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    const q = await c.readQuotes(REF, minuteCells(new Date('2026-09-11T10:00:00Z')).m60);
    expect(q.left.m60.reason).toBeUndefined();
    expect(q.forward.m60.reason).toBeUndefined();
  });

  it('reading the quotes is one request per read, not one per option', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { markets: [] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.readQuotes(REF, minuteCells(new Date()).m60);
    expect(reqs.length).toBe(1);
  });
});
