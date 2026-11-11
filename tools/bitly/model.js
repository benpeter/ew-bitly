export const CAMPAIGNS = [
  { label: 'Table card', source: 'table-card', medium: 'print' },
  { label: 'Flyer', source: 'flyer', medium: 'print' },
  { label: 'Instagram', source: 'instagram', medium: 'social' },
  { label: 'Newsletter', source: 'newsletter', medium: 'email' },
];

const HOST = /^(?:https:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/?$/i;
const PREVIEW_HOST = /\.(aem|hlx)\.page$/i;

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function hostOrigin(host) {
  const match = typeof host === 'string' && host.match(HOST);
  if (!match || PREVIEW_HOST.test(match[1])) return null;
  return `https://${match[1].toLowerCase()}`;
}

export function pageUrl(origin, path) {
  const page = `/${path.replace(/^\/+/, '')}`.replace(/\.html$/, '');
  return `${origin}${page.replace(/(^|\/)index$/, '$1')}`;
}

export const isDraft = (path) => path.startsWith('/drafts/');

export function withCampaign(url, campaign) {
  if (!campaign) return url;
  const u = new URL(url);
  u.searchParams.set('utm_source', campaign.source);
  u.searchParams.set('utm_medium', campaign.medium);
  return u.href;
}

export function isSamePage(longUrl, page) {
  const a = parse(longUrl);
  const b = parse(page);
  return !!a && !!b && a.hostname === b.hostname && a.pathname === b.pathname;
}

export const findExisting = (links, longUrl) => links.find((l) => l.long_url === longUrl);

export function campaignOf(longUrl) {
  const params = parse(longUrl)?.searchParams;
  if (!params) return '';
  const source = params.get('utm_source');
  const known = CAMPAIGNS.find((c) => c.source === source && c.medium === params.get('utm_medium'));
  return known?.label || source || '';
}

export function safeHref(link) {
  return parse(link)?.protocol === 'https:' ? link : null;
}

export function qrFileName(link) {
  const name = link.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `qr-${name}.png`;
}

export function mediaPath(path, fileName) {
  let clean = path.replace(/^\/+/, '').replace(/\.html$/, '');
  if (!clean || clean.endsWith('/')) clean += 'index';
  const parts = clean.split('/');
  const page = parts.pop();
  return `/${[...parts, `.${page}`, fileName].join('/')}`;
}

const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const imageHtml = ({ src, alt }) => `<p><img src="${escape(src)}" alt="${escape(alt)}"></p>`;

export const bare = (url) => url.replace(/^https:\/\//, '');

export function linkHtml(link) {
  return `<p><a href="${escape(link)}">${escape(bare(link))}</a></p>`;
}

export function errorMessage({ status, body }) {
  const message = body?.message || '';
  if (status === 0) return "Bitly didn't answer. Check your connection and try again.";
  if (status === 401 || status === 403) {
    return "Bitly didn't accept your token. Remove it under Settings and paste a new one.";
  }
  if (status === 429 && /MONTHLY_LIMIT|API_USAGE_LIMIT/.test(message)) {
    return "Your Bitly plan's monthly limit is used up. It resets on the 1st.";
  }
  if (status === 429) return 'Too many requests to Bitly. Wait a minute and try again.';
  if (status === 400 && message.includes('LONG_URL')) return "Bitly didn't accept this page URL.";
  return `Bitly returned an error (${status}${message ? `: ${message}` : ''}).`;
}
