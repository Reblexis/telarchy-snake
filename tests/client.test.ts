import { describe, it, expect } from 'vitest';
import { HttpTelarchyClient, periodKeys } from '../src/client.js';

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
  it('posts a proposal with the agent key and workspace header, no subsidy, a one-minute deadline, and returns its public url', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ status: 201, json: { id: 'p-1', number: 41, conditionalMarketIds: [] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:00.400Z'));
    const ref = await c.postProposal('Move up', 'Step 1: ...', 1);
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals');
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].headers['X-Agent-Key']).toBe('k');
    expect(reqs[0].headers['X-Workspace-Id']).toBe('ws1');
    expect(reqs[0].body.title).toBe('Move up');
    expect(reqs[0].body.description).toBe('Step 1: ...');
    expect('liquiditySubsidy' in reqs[0].body).toBe(false);
    expect(reqs[0].body.decideBy).toBe('2026-09-11T10:01:00.400Z');
    expect(ref).toEqual({ id: 'p-1', title: 'Move up', url: 'https://telarchy.com/snake/p/41' });
  });

  it('reads the approved and declined consensus on the today horizon, per direction by title', async () => {
    const { fetchImpl } = fakeFetch(r => {
      const id = r.url.split('/').pop();
      const px: Record<string, number> = { 'p-up': 4, 'p-right': 5, 'p-down': 3, 'p-left': 2 };
      return { json: { id, markets: [
        { targetDate: '2026-W37', approved: { consensus: 99 }, declined: { consensus: 98 } },
        { targetDate: '2026-09-11', approved: { consensus: px[id!] }, declined: { consensus: 3.5 } },
      ] } };
    });
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes([
      { id: 'p-up', title: 'Move up', url: '' }, { id: 'p-right', title: 'Move right', url: '' },
      { id: 'p-down', title: 'Move down', url: '' }, { id: 'p-left', title: 'Move left', url: '' },
    ]);
    expect(q.right).toEqual({ approved: 5, declined: 3.5 });
    expect(q.left.approved).toBe(2);
  });

  it('reads today only: a proposal with no today pair (last minute of the day) has no price', async () => {
    const { fetchImpl } = fakeFetch(() => ({ json: { markets: [{ targetDate: '2026-W37', approved: { consensus: 7 }, declined: { consensus: 6 } }] } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T23:59:55Z'));
    const q = await c.readQuotes([{ id: 'p-up', title: 'Move up', url: '' }]);
    expect(q.up).toEqual({ approved: null, declined: null });
  });

  it('forces the refresh of the rolling markets with manage rights (the midnight book)', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { ok: true } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.refreshBooks();
    expect(reqs[0].url).toBe('https://telarchy.com/api/predictions/markets/refresh');
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].body).toEqual({ force: true });
  });

  it('a pair with no consensus, or a proposal that cannot be read, is a null price, not a throw', async () => {
    const { fetchImpl } = fakeFetch(r => r.url.endsWith('p-up')
      ? { json: { markets: [{ targetDate: '2026-09-11', approved: { consensus: null }, declined: { consensus: null } }] } }
      : { status: 500, json: { error: 'boom' } });
    const c = new HttpTelarchyClient(opts, fetchImpl as any, () => new Date('2026-09-11T10:00:55Z'));
    const q = await c.readQuotes([{ id: 'p-up', title: 'Move up', url: '' }, { id: 'p-right', title: 'Move right', url: '' }]);
    expect(q.up).toEqual({ approved: null, declined: null });
    expect(q.right).toEqual({ approved: null, declined: null });
  });

  it('approve posts to /approve; decline posts to /decline with refund: true so both branches void', async () => {
    const { reqs, fetchImpl } = fakeFetch(() => ({ json: { ok: true } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await c.decideProposal({ id: 'p-1', title: 'Move up', url: '' }, 'approve');
    await c.decideProposal({ id: 'p-2', title: 'Move down', url: '' }, 'decline');
    expect(reqs[0].url).toBe('https://telarchy.com/api/proposals/p-1/approve');
    expect(reqs[1].url).toBe('https://telarchy.com/api/proposals/p-2/decline');
    expect(reqs[1].body).toEqual({ refund: true });
  });

  it('a failed decision throws with the status so the operator can take the undecided path', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 409, json: { error: 'no' } }));
    const c = new HttpTelarchyClient(opts, fetchImpl as any);
    await expect(c.decideProposal({ id: 'p-1', title: 'Move up', url: '' }, 'approve')).rejects.toThrow(/409/);
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

  it('the client has no trade method', () => {
    const c = new HttpTelarchyClient(opts);
    expect((c as any).trade).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(c)).some(n => /trade|order/i.test(n))).toBe(false);
  });

  it('period keys: today is the UTC date, week is the ISO week', () => {
    expect(periodKeys(new Date('2026-09-11T23:59:55Z'))).toEqual({ today: '2026-09-11', week: '2026-W37' });
    expect(periodKeys(new Date('2026-01-01T00:00:00Z'))).toEqual({ today: '2026-01-01', week: '2026-W01' });
    expect(periodKeys(new Date('2027-01-01T00:00:00Z'))).toEqual({ today: '2027-01-01', week: '2026-W53' });
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
