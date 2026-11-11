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
    let text;
    try {
      resp = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body && JSON.stringify(body),
        credentials: 'omit',
        signal: controller.signal,
      });
      text = await resp.text();
    } catch {
      throw new BitlyError(0, null);
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // keep null
    }
    if (!resp.ok) throw new BitlyError(resp.status, json);
    return { ...json, status: resp.status };
  }

  const clicks = (id) => call(`/bitlinks/${id}/clicks/summary?unit=day&units=30`)
    .then((json) => json.total_clicks ?? null, () => null);

  return {
    defaultGroup: async () => (await call('/user')).default_group_guid,
    listLinks: async ({ group, hostPath }) => {
      const query = new URLSearchParams({ hostname_path_query: hostPath, size: '50' });
      return (await call(`/groups/${encodeURIComponent(group)}/bitlinks?${query}`)).links ?? [];
    },
    createLink: async ({
      longUrl, group, domain, title,
    }) => {
      const { status, ...link } = await call('/bitlinks', {
        method: 'POST',
        body: {
          long_url: longUrl, group_guid: group, domain, title,
        },
      });
      return { ...link, existed: status === 200 };
    },
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
