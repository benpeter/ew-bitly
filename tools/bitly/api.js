const BASE = 'https://api-ssl.bitly.com/v4';

export class BitlyError extends Error {
  constructor(status, body) {
    super(`Bitly ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function createBitly({
  token, fetch = (...args) => window.fetch(...args), timeout = 10000,
}) {
  async function call(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';
    let resp;
    try {
      resp = await fetch(`${BASE}${path}`, {
        method, headers, body: body && JSON.stringify(body), signal: controller.signal,
      });
    } catch {
      throw new BitlyError(0, null);
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try {
      json = JSON.parse(await resp.text());
    } catch {
      // keep null
    }
    if (!resp.ok) throw new BitlyError(resp.status, json);
    return json ?? {};
  }

  async function clicks(id) {
    try {
      const json = await call(`/bitlinks/${id}/clicks/summary?unit=day&units=30`);
      return json.total_clicks ?? null;
    } catch (e) {
      if (e.status === 402 || e.status === 403) return null;
      throw e;
    }
  }

  return {
    defaultGroup: async () => (await call('/user')).default_group_guid,
    listLinks: async ({ group, hostPath }) => {
      const query = new URLSearchParams({ hostname_path_query: hostPath, size: '50' });
      return (await call(`/groups/${encodeURIComponent(group)}/bitlinks?${query}`)).links ?? [];
    },
    createLink: ({
      longUrl, group, domain, title,
    }) => call('/bitlinks', {
      method: 'POST',
      body: {
        long_url: longUrl, group_guid: group, domain, title,
      },
    }),
    clicks,
    clicksFor: async (ids, limit = 3) => {
      const result = new Map();
      const queue = [...ids];
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift();
          // eslint-disable-next-line no-await-in-loop
          result.set(id, await clicks(id));
        }
      };
      await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
      return result;
    },
  };
}
