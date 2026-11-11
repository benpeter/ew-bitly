const HLX_ADMIN = 'https://admin.hlx.page';
const AEM_API = 'https://api.aem.live';
const DA_SOURCE = 'https://admin.da.live/source';

// Legacy DA sites keep their sidekick config and media in admin.hlx.page and admin.da.live,
// Helix 6 sites in the AEM API. The admin ping marks Helix 6 sites with a header.
export default function createSite({
  org, site, daFetch, fetch = (...args) => window.fetch(...args),
}) {
  let sourceBus;
  const detect = () => {
    sourceBus ??= fetch(`${HLX_ADMIN}/ping/${org}/${site}`, { credentials: 'omit' }).then((resp) => {
      if (!resp.ok) throw new Error(`ping ${resp.status}`);
      return resp.headers.get('x-api-upgrade-available') !== null;
    });
    sourceBus.catch(() => { sourceBus = undefined; });
    return sourceBus;
  };

  return {
    async host() {
      const url = (await detect())
        ? `${AEM_API}/${org}/sites/${site}/sidekick`
        : `${HLX_ADMIN}/sidekick/${org}/${site}/main/config.json`;
      const resp = await daFetch(url);
      if (!resp.ok) throw new Error(`sidekick ${resp.status}`);
      return (await resp.json())?.host;
    },

    async upload(path, file) {
      let resp;
      if (await detect()) {
        resp = await daFetch(`${AEM_API}/${org}/sites/${site}/media${path}`, {
          method: 'POST', body: file, headers: { 'content-type': 'image/png' },
        });
        if (!resp.ok) throw new Error(`upload ${resp.status}`);
        const { uri } = await resp.json();
        const prefix = `https://main--${site}--${org}.aem.page/`;
        return uri.startsWith(prefix) ? `./${uri.slice(prefix.length)}` : uri;
      }
      const body = new FormData();
      body.append('data', file);
      resp = await daFetch(`${DA_SOURCE}/${org}/${site}${path}`, { method: 'POST', body });
      if (!resp.ok) throw new Error(`upload ${resp.status}`);
      return (await resp.json()).source.contentUrl;
    },
  };
}
