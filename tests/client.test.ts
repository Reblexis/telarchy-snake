import { describe, it, expect } from 'vitest';
import { HttpTelarchyClient, minuteCells } from '../src/client.js';

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

describe('the Telarchy client (docs/snake.md, "The workspace" and "The step")', () => {
  it('posts a proposal with the agent key and workspace header, no subsidy, the given deadline, and returns its public url', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ status: 201, json: { id: 'p-1', number: 41, conditionalMarketIds: [] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:00.400Z'));
    const ref = await c.postProposal('Turn left', 'Step 1: ...', new Date('2026-09-11T10:01:00Z'));
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals');
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].headers['X-Agent-Key']).toBe('k');
    expect(reqs[0].headers['X-Workspace-Id']).toBe('ws1');
    expect(reqs[0].body.title).toBe('Turn left');
    expect(reqs[0].body.description).toBe('Step 1: ...');
    expect('liquiditySubsidy' in reqs[0].body).toBe(false);
    expect(reqs[0].body.decideBy).toBe('2026-09-11T10:01:00.000Z'); // the deadline is given, not derived from posting time
    expect(ref).toEqual({ id: 'p-1', title: 'Turn left', url: 'https://telarchy.com/snake/p/41' });
  });

  it('reads the three horizons by their minute cells: +1, +5 and +60 minutes after the opening minute, per action by title', async () => {
    const { fetchImpl } = fakeFetch(r => {
      const id = r.url.split('/').pop()!;
      const px: Record<string, number> = { 'p-forward': 4, 'p-right': 5, 'p-left': 2 };
      return { json: { id, markets: [
        { targetDate: '2026-09-11T10:01', approved: { consensus: 1.5 }, declined: { consensus: 1 } },
        { targetDate: '2026-09-11T10:05', approved: { consensus: 2.5 }, declined: { consensus: 2 } },
        { targetDate: '2026-09-11T11:00', approved: { consensus: px[id], marketId: `a-${id}` }, declined: { consensus: 3.5, marketId: `d-${id}` } },
        { targetDate: '2026-09-11', approved: { consensus: 99 }, declined: { consensus: 99 } },
      ] } };
    });
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes([
      { id: 'p-forward', title: 'Continue forward', url: '' }, { id: 'p-right', title: 'Turn right', url: '' },
      { id: 'p-left', title: 'Turn left', url: '' },
    ], new Date('2026-09-11T10:00:00.400Z'));
    expect(q.right.m60).toEqual({ approved: 5, declined: 3.5, approvedMarketId: 'a-p-right', declinedMarketId: 'd-p-right' });
    expect(q.right.m1).toEqual({ approved: 1.5, declined: 1 });
    expect(q.right.m5).toEqual({ approved: 2.5, declined: 2 });
    expect(q.left.m60.approved).toBe(2);
  });

  it('matches a minute cell by its settlement instant when the summary carries no target date (production shape)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [
      { resolvesOn: '2026-09-11T11:01:00Z', approved: { consensus: 4.5 }, declined: { consensus: 3 } },
      { resolvesOn: '2026-09-11T10:06:00.000Z', approved: { consensus: 2 }, declined: { consensus: 2 } },
      { resolvesOn: '2026-09-11T10:02:00Z', approved: { consensus: 1 }, declined: { consensus: 1 } },
    ] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes([{ id: 'p-up', title: 'Continue forward', url: '' }], new Date('2026-09-11T10:00:00Z'));
    expect(q.forward.m60).toEqual({ approved: 4.5, declined: 3 });
    expect(q.forward.m5).toEqual({ approved: 2, declined: 2 });
    expect(q.forward.m1).toEqual({ approved: 1, declined: 1 });
  });

  it('the cells roll over the hour and the day correctly', async () => {
    const seen: string[] = [];
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [
      { targetDate: '2026-09-12T00:00', approved: { consensus: 1 }, declined: { consensus: 1 } },
      { targetDate: '2026-09-12T00:04', approved: { consensus: 5 }, declined: { consensus: 5 } },
      { targetDate: '2026-09-12T00:59', approved: { consensus: 60 }, declined: { consensus: 60 } },
    ] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T23:59:55Z'));
    const q = await c.readQuotes([{ id: 'p-up', title: 'Turn left', url: '' }], new Date('2026-09-11T23:59:00Z'));
    expect(q.left.m1.approved).toBe(1); expect(q.left.m5.approved).toBe(5); expect(q.left.m60.approved).toBe(60);
    void seen;
  });

  it('a missing pair, or a proposal that cannot be read, is a null price on that horizon, not a throw', async () => {
    const { fetchImpl } = fakeFetch(r => r.url.endsWith('p-up')
      ? { json: { markets: [{ targetDate: '2026-09-11T11:00', approved: { consensus: null }, declined: { consensus: null } }] } }
      : { status: 500, json: { error: 'boom' } });
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes([{ id: 'p-up', title: 'Turn left', url: '' }, { id: 'p-right', title: 'Turn right', url: '' }], new Date('2026-09-11T10:00:00Z'));
    expect(q.left.m60).toEqual({ approved: null, declined: null });
    expect(q.left.m1).toEqual({ approved: null, declined: null });
    expect(q.right.m60).toEqual({ approved: null, declined: null });
  });

  it('approve posts to /approve; decline posts to /decline with refund: true so both branches void', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { ok: true } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.decideProposal({ id: 'p-1', title: 'Turn left', url: '' }, 'approve');
    await c.decideProposal({ id: 'p-2', title: 'Turn right', url: '' }, 'decline');
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals/p-1/approve');
    expect(reqs[1].url).toBe('https://telarchy.com/api/proposals/p-2/decline');
    expect(reqs[1].body).toEqual({ refund: true });
  });

  it('a failed decision throws with the status so the operator can take the undecided path', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 409, json: { error: 'no' } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await expect(c.decideProposal({ id: 'p-1', title: 'Turn left', url: '' }, 'approve')).rejects.toThrow(/409/);
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

  it('minute cells: the cell N minutes after the opening minute, named YYYY-MM-DDTHH:MM', () => {
    expect(minuteCells(new Date('2026-09-11T10:00:40Z'))).toEqual({ m1: '2026-09-11T10:01', m5: '2026-09-11T10:05', m60: '2026-09-11T11:00' });
    expect(minuteCells(new Date('2026-12-31T23:59:00Z'))).toEqual({ m1: '2027-01-01T00:00', m5: '2027-01-01T00:04', m60: '2027-01-01T00:59' });
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
