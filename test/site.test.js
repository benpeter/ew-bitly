import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import createSite from '../tools/bitly/site.js';

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});

function fakes({
  hlx6 = false, ping = 200, sidekick = { host: 'schamdan.de' }, upload,
} = {}) {
  const calls = { fetch: [], daFetch: [] };
  const fetch = async (url, opts) => {
    calls.fetch.push({ url, opts });
    return response(ping, {}, hlx6 ? { 'x-api-upgrade-available': 'true' } : {});
  };
  const daFetch = async (url, opts = {}) => {
    calls.daFetch.push({ url, opts });
    if (url.includes('sidekick')) return response(200, sidekick);
    return upload ?? response(201, hlx6
      ? { uri: 'https://main--s--o.aem.page/media_123.png' }
      : { source: { contentUrl: 'https://content.da.live/o/s/.p/qr.png' } });
  };
  return { fetch, daFetch, calls };
}

describe('createSite', () => {
  it('reads the host of a legacy site from the admin sidekick config', async () => {
    const f = fakes();
    const site = createSite({ org: 'o', site: 's', ...f });
    assert.equal(await site.host(), 'schamdan.de');
    assert.equal(f.calls.fetch[0].url, 'https://admin.hlx.page/ping/o/s');
    assert.equal(f.calls.fetch[0].opts.credentials, 'omit');
    assert.equal(f.calls.daFetch[0].url, 'https://admin.hlx.page/sidekick/o/s/main/config.json');
  });

  it('reads the host of a Helix 6 site from the AEM API', async () => {
    const f = fakes({ hlx6: true });
    await createSite({ org: 'o', site: 's', ...f }).host();
    assert.equal(f.calls.daFetch[0].url, 'https://api.aem.live/o/sites/s/sidekick');
  });

  it('fails when the backend check fails', async () => {
    const f = fakes({ ping: 503 });
    await assert.rejects(createSite({ org: 'o', site: 's', ...f }).host());
  });

  it('uploads to the legacy source store as form data', async () => {
    const f = fakes();
    const file = new Blob(['png'], { type: 'image/png' });
    const src = await createSite({ org: 'o', site: 's', ...f }).upload('/.p/qr.png', file);
    assert.equal(src, 'https://content.da.live/o/s/.p/qr.png');
    const call = f.calls.daFetch.at(-1);
    assert.equal(call.url, 'https://admin.da.live/source/o/s/.p/qr.png');
    assert.equal(call.opts.method, 'POST');
    assert.ok(call.opts.body instanceof FormData);
  });

  it('uploads to the Helix 6 media route and returns a relative media src', async () => {
    const f = fakes({ hlx6: true });
    const file = new Blob(['png'], { type: 'image/png' });
    const src = await createSite({ org: 'o', site: 's', ...f }).upload('/.p/qr.png', file);
    assert.equal(src, './media_123.png');
    const call = f.calls.daFetch.at(-1);
    assert.equal(call.url, 'https://api.aem.live/o/sites/s/media/.p/qr.png');
    assert.equal(call.opts.headers['content-type'], 'image/png');
    assert.equal(call.opts.body, file);
  });

  it('detects the backend once', async () => {
    const f = fakes();
    const site = createSite({ org: 'o', site: 's', ...f });
    await site.host();
    await site.upload('/.p/qr.png', new Blob(['x']));
    assert.equal(f.calls.fetch.length, 1);
  });

  it('gives up on a backend check that hangs', async () => {
    const hanging = (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const f = fakes();
    await assert.rejects(createSite({
      org: 'o', site: 's', ...f, fetch: hanging, timeout: 10,
    }).host());
  });

  it('passes a signal to daFetch', async () => {
    const f = fakes();
    await createSite({ org: 'o', site: 's', ...f }).host();
    assert.ok(f.calls.daFetch[0].opts.signal);
  });

  it('fails on a failed upload', async () => {
    const f = fakes({ upload: response(403, {}) });
    await assert.rejects(createSite({ org: 'o', site: 's', ...f }).upload('/.p/qr.png', new Blob(['x'])));
  });
});
