export const DEFAULT_CAMPAIGNS = [
  { label: 'Print / QR code', source: 'qr', medium: 'print' },
  { label: 'Flyer', source: 'flyer', medium: 'print' },
  { label: 'Instagram', source: 'instagram', medium: 'social' },
  { label: 'Newsletter', source: 'newsletter', medium: 'email' },
];

function parseCampaigns(value) {
  return value.split('|').map((entry) => {
    const [label, rest = ''] = entry.split('=').map((s) => s.trim());
    const [source, medium] = rest.split('/').map((s) => s?.trim());
    return label && source && medium ? { label, source, medium } : null;
  }).filter(Boolean);
}

function toHost(value) {
  return value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function readSettings(config) {
  const settings = {
    host: '', group: '', domain: 'bit.ly', campaigns: DEFAULT_CAMPAIGNS,
  };
  const rows = config?.bitly?.data;
  if (!Array.isArray(rows)) return settings;
  rows.forEach(({ key, value }) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    if (key === 'host') settings.host = toHost(v);
    if (key === 'group') settings.group = v;
    if (key === 'domain') settings.domain = toHost(v);
    if (key === 'campaigns') {
      const campaigns = parseCampaigns(v);
      if (campaigns.length) settings.campaigns = campaigns;
    }
  });
  return settings;
}

export function pageUrl({ context, settings }) {
  const { org } = context;
  const site = context.site || context.repo;
  if (!org || !site) return null;
  let path = `/${(context.path || '').replace(/^\/+/, '')}`.replace(/\.html$/, '');
  path = path.replace(/(^|\/)index$/, '$1');
  const host = settings.host || `main--${site}--${org}.aem.live`;
  return { url: `https://${host}${path}`, host, hostSource: settings.host ? 'config' : 'default' };
}

export function withCampaign(url, campaign) {
  if (!campaign) return url;
  const u = new URL(url);
  u.searchParams.set('utm_source', campaign.source);
  u.searchParams.set('utm_medium', campaign.medium);
  return u.href;
}

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const trimPath = (path) => path.replace(/\/+$/, '') || '/';

export function isSamePage(longUrl, page) {
  const a = parse(longUrl);
  const b = parse(page);
  if (!a || !b) return false;
  return a.hostname.toLowerCase() === b.hostname.toLowerCase()
    && trimPath(a.pathname) === trimPath(b.pathname);
}

export function campaignOf(longUrl, campaigns) {
  const params = parse(longUrl)?.searchParams;
  if (!params) return '';
  const source = params.get('utm_source');
  const medium = params.get('utm_medium');
  const known = campaigns.find((c) => c.source === source && c.medium === medium);
  return known?.label || source || '';
}

export function errorMessage({ status, body }) {
  const message = body?.message || '';
  if (status === 0) return "Bitly didn't answer. Check your connection and try again.";
  if (status === 401 || status === 403) return "Bitly didn't accept your token. Paste a new one in Settings.";
  if (status === 429 && message === 'MONTHLY_LIMIT_EXCEEDED') {
    return "Your Bitly plan's monthly limit is used up. It resets on the 1st.";
  }
  if (status === 429) return 'Too many requests to Bitly. Wait a minute and try again.';
  if (status === 400 && message.includes('LONG_URL')) return "Bitly didn't accept this page URL.";
  return `Bitly returned an error (${status}${message ? `: ${message}` : ''}).`;
}
