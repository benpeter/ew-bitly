const HLX_ADMIN = 'https://admin.hlx.page';
const AEM_API = 'https://api.aem.live';
const DA_SOURCE = 'https://admin.da.live/source';

// Legacy DA sites keep their sidekick config and media in admin.hlx.page and admin.da.live,
// Helix 6 sites in the AEM API. The admin ping marks Helix 6 sites with a header.
export default function createSite({
  org, site, daFetch, fetch = (...args) => window.fetch(...args), timeout = 15000,
}) {
  const timed = async (request, url, opts = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await request(url, { ...opts, signal: controller.signal });
      if (!resp.ok) throw new Error(`${resp.status} ${url}`);
      return resp;
    } finally {
      clearTimeout(timer);
    }
  };

  let sourceBus;
  const detect = () => {
    sourceBus ??= timed(fetch, `${HLX_ADMIN}/ping/${org}/${site}`, { credentials: 'omit' })
      .then((resp) => resp.headers.get('x-api-upgrade-available') !== null);
    sourceBus.catch(() => { sourceBus = undefined; });
    return sourceBus;
  };

  return {
    async host() {
      const url = (await detect())
        ? `${AEM_API}/${org}/sites/${site}/sidekick`
        : `${HLX_ADMIN}/sidekick/${org}/${site}/main/config.json`;
      return (await (await timed(daFetch, url)).json())?.host;
    },

    async upload(path, file) {
      if (await detect()) {
        const resp = await timed(daFetch, `${AEM_API}/${org}/sites/${site}/media${path}`, {
          method: 'POST', body: file, headers: { 'content-type': 'image/png' },
        });
        const { uri } = await resp.json();
        const prefix = `https://main--${site}--${org}.aem.page/`;
        return uri.startsWith(prefix) ? `./${uri.slice(prefix.length)}` : uri;
      }
      const body = new FormData();
      body.append('data', file);
      const resp = await timed(daFetch, `${DA_SOURCE}/${org}/${site}${path}`, { method: 'POST', body });
      return (await resp.json()).source.contentUrl;
    },
  };
}
