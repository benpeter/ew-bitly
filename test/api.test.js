import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createBitly, BitlyError } from '../tools/bitly/api.js';

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const { status = 200, body = {}, text } = await handler(url, opts, calls.length);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (text ?? JSON.stringify(body)),
    };
  };
  fn.calls = calls;
  return fn;
}

describe('createBitly', () => {
  it('reads the default group with the bearer token', async () => {
    const fetch = fakeFetch(() => ({ body: { default_group_guid: 'G1' } }));
    const bitly = createBitly({ token: 'T', fetch });
    assert.equal(await bitly.defaultGroup(), 'G1');
    assert.equal(fetch.calls[0].url, 'https://api-ssl.bitly.com/v4/user');
    assert.equal(fetch.calls[0].opts.headers.Authorization, 'Bearer T');
  });

  it('lists links by host and path', async () => {
    const fetch = fakeFetch(() => ({ body: { links: [{ id: 'bit.ly/a' }] } }));
    const links = await createBitly({ token: 'T', fetch }).listLinks({ group: 'G1', hostPath: 'schamdan.de/speisekarte' });
    assert.deepEqual(links, [{ id: 'bit.ly/a' }]);
    const url = new URL(fetch.calls[0].url);
    assert.equal(url.pathname, '/v4/groups/G1/bitlinks');
    assert.equal(url.searchParams.get('hostname_path_query'), 'schamdan.de/speisekarte');
    assert.equal(url.searchParams.get('size'), '50');
  });

  it('returns no links when the field is missing', async () => {
    const fetch = fakeFetch(() => ({ body: {} }));
    assert.deepEqual(await createBitly({ token: 'T', fetch }).listLinks({ group: 'G', hostPath: 'h' }), []);
  });

  it('creates a link', async () => {
    const fetch = fakeFetch(() => ({ status: 201, body: { id: 'bit.ly/new', link: 'https://bit.ly/new' } }));
    const link = await createBitly({ token: 'T', fetch }).createLink({
      longUrl: 'https://h.de/x', group: 'G', domain: 'bit.ly', title: 'x',
    });
    assert.equal(link.id, 'bit.ly/new');
    const { url, opts } = fetch.calls[0];
    assert.equal(url, 'https://api-ssl.bitly.com/v4/bitlinks');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(opts.body), {
      long_url: 'https://h.de/x', group_guid: 'G', domain: 'bit.ly', title: 'x',
    });
  });

  it('reads 30-day clicks', async () => {
    const fetch = fakeFetch(() => ({ body: { total_clicks: 7 } }));
    assert.equal(await createBitly({ token: 'T', fetch }).clicks('bit.ly/a'), 7);
    const url = new URL(fetch.calls[0].url);
    assert.equal(url.pathname, '/v4/bitlinks/bit.ly/a/clicks/summary');
    assert.equal(url.searchParams.get('unit'), 'day');
    assert.equal(url.searchParams.get('units'), '30');
  });

  it('returns null clicks when the plan has no numbers', async () => {
    const results = await Promise.all([402, 403].map((status) => {
      const fetch = fakeFetch(() => ({ status, body: { message: 'UPGRADE_REQUIRED' } }));
      return createBitly({ token: 'T', fetch }).clicks('bit.ly/a');
    }));
    assert.deepEqual(results, [null, null]);
  });

  it('reads clicks for many links, at most 3 at a time', async () => {
    let running = 0;
    let peak = 0;
    const fetch = fakeFetch(async (url) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => { setTimeout(r, 5); });
      running -= 1;
      return { body: { total_clicks: url.includes('/b/') ? 2 : 1 } };
    });
    const result = await createBitly({ token: 'T', fetch }).clicksFor(['bit.ly/a', 'bit.ly/b', 'bit.ly/c', 'bit.ly/d', 'bit.ly/e']);
    assert.equal(result.get('bit.ly/b'), 2);
    assert.equal(result.get('bit.ly/e'), 1);
    assert.ok(peak <= 3, `peak ${peak}`);
  });

  it('throws BitlyError with status and body', async () => {
    const fetch = fakeFetch(() => ({ status: 429, body: { message: 'MONTHLY_LIMIT_EXCEEDED' } }));
    await assert.rejects(createBitly({ token: 'T', fetch }).defaultGroup(), (e) => {
      assert.ok(e instanceof BitlyError);
      assert.equal(e.status, 429);
      assert.equal(e.body.message, 'MONTHLY_LIMIT_EXCEEDED');
      return true;
    });
  });

  it('copes with a non-JSON error body', async () => {
    const fetch = fakeFetch(() => ({ status: 502, text: '<html>bad gateway</html>' }));
    await assert.rejects(createBitly({ token: 'T', fetch }).defaultGroup(), (e) => e.status === 502 && e.body === null);
  });

  it('turns network errors and timeouts into status 0', async () => {
    const failing = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(createBitly({ token: 'T', fetch: failing }).defaultGroup(), (e) => e.status === 0);

    const hanging = (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    await assert.rejects(createBitly({ token: 'T', fetch: hanging, timeout: 10 }).defaultGroup(), (e) => e.status === 0);
  });
});
