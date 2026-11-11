/* eslint-disable no-use-before-define */
import { createBitly } from './api.js';
import createSite from './upload.js';
import createTokenStore from './storage.js';
import {
  CAMPAIGNS, hostOrigin, pageUrl, isDraft, withCampaign, isSamePage, findExisting, campaignOf,
  safeHref, qrFileName, mediaPath, imageHtml, linkHtml, errorMessage,
} from './model.js';

const GROUP_KEY = 'ew-bitly:group';
const TOKEN_HELP = 'https://app.bitly.com/settings/api/';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === false) return;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && !key.startsWith('aria')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  });
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

const button = (label, onclick, className = 'nx-action-btn nx-btn-sm', extra = {}) => el('button', {
  type: 'button', className, onclick, ...extra,
}, label);

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function mountPanel(root, {
  context, actions, capabilities = {}, storage = window.localStorage,
  fetch, site: siteOverride, qr: qrOverride,
}) {
  const tokens = createTokenStore(storage);
  const site = siteOverride ?? createSite({
    org: context.org, site: context.site || context.repo, daFetch: actions.daFetch,
  });
  const path = context.path || '/';
  const state = {
    origin: null, hostProblem: null, links: [], clicks: new Map(), selected: null, busy: false,
  };
  let bitly;
  let disposeDrag;
  let alive = true;

  const status = el('p', { className: 'bl-status', role: 'status' });
  const main = el('div');
  root.replaceChildren(el('div', { className: 'bitly' }, main, status));
  const say = (text) => { status.textContent = text; };
  const loadQr = () => qrOverride ?? import('./qr.js');

  const group = () => {
    try { return storage.getItem(GROUP_KEY) || ''; } catch { return ''; }
  };
  const setGroup = (value) => {
    try {
      if (value) storage.setItem(GROUP_KEY, value);
      else storage.removeItem(GROUP_KEY);
    } catch { /* memory only */ }
  };

  const fail = (e) => say(e.status !== undefined ? errorMessage(e) : 'Something went wrong. Try again.');

  async function loadLinks() {
    if (!bitly || !state.origin) return;
    let g = group();
    if (!g) {
      g = await bitly.defaultGroup();
      setGroup(g);
    }
    const url = pageUrl(state.origin, path);
    const all = await bitly.listLinks({ group: g, hostPath: url.replace(/^https:\/\//, '') });
    state.links = all.filter((l) => isSamePage(l.long_url, url))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    state.clicks = await bitly.clicksFor(state.links.slice(0, 10).map((l) => l.id));
  }

  async function prepareQr(link) {
    const { qrSvg, qrPng } = await loadQr();
    const svg = qrSvg(link.link);
    const png = await qrPng(link.link);
    const file = new File([png], qrFileName(link.link), { type: 'image/png' });
    return { svg, png, file };
  }

  function qrView(link, prepared) {
    const url = pageUrl(state.origin, path);
    const alt = el('input', {
      type: 'text', value: `QR code: ${url.replace(/^https:\/\//, '')}`, id: 'bl-alt',
    });
    const withLink = el('input', { type: 'checkbox', checked: true, id: 'bl-with-link' });
    const preview = el('img', {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared.svg)}`,
      alt: `QR code for ${link.link}`,
      width: 160,
      height: 160,
    });
    const insert = async () => {
      say('Uploading the QR code…');
      try {
        const src = await site.upload(mediaPath(path, prepared.file.name), prepared.file);
        actions.sendHTML(imageHtml({ src, alt: alt.value.trim() }) + (withLink.checked ? linkHtml(link.link) : ''));
        say('Inserted at the cursor.');
      } catch {
        say("Couldn't upload the QR code. Try again, or drag it into the page.");
      }
    };
    const copy = () => {
      try {
        const item = new window.ClipboardItem({ 'image/png': prepared.png });
        navigator.clipboard.write([item]).then(
          () => say('Copied the QR code image.'),
          () => navigator.clipboard.writeText(link.link).then(() => say('Copied the link only.')),
        );
      } catch {
        navigator.clipboard.writeText(link.link).then(() => say('Copied the link only.'));
      }
    };
    const handle = el('span', {
      className: 'bl-drag', tabIndex: -1, title: 'Drag into the page',
    }, preview);
    if (capabilities.dragDrop === 1 && actions.makeDraggable) {
      disposeDrag?.();
      disposeDrag = undefined;
      actions.makeDraggable({
        element: handle,
        getData: () => ({ files: [prepared.file] }),
        onResult: ({ ok, error }) => {
          if (ok) say('Added to the page. Add alt text to the image in the editor.');
          else if (error !== 'cancelled') say("Couldn't add the QR code to the page.");
        },
      }).then((dispose) => { if (alive) disposeDrag = dispose; else dispose(); });
    }
    return el(
      'div',
      { className: 'bl-qr' },
      handle,
      el('div', { className: 'bl-field' }, el('label', { htmlFor: 'bl-alt' }, 'Alt text'), alt),
      el('div', { className: 'bl-check' }, withLink, el('label', { htmlFor: 'bl-with-link' }, 'Add the link below the image')),
      el(
        'div',
        { className: 'bl-actions' },
        button('Insert at cursor', insert, 'nx-btn-primary nx-btn-sm'),
        button('Download SVG', () => download(new Blob([prepared.svg], { type: 'image/svg+xml' }), prepared.file.name.replace(/\.png$/, '.svg'))),
        button('Download PNG', () => download(prepared.png, prepared.file.name)),
        button('Copy image', copy),
      ),
      el('p', { className: 'bl-hint' }, capabilities.dragDrop === 1
        ? 'You can also drag the code into the page. Works in the document view.'
        : 'Works in the document view.'),
    );
  }

  async function select(link) {
    state.selected = state.selected?.id === link.id ? null : { ...link, prepared: null };
    render();
    if (!state.selected) return;
    try {
      const prepared = await prepareQr(link);
      if (state.selected?.id !== link.id) return;
      state.selected.prepared = prepared;
      render();
    } catch {
      say("Couldn't make the QR code.");
    }
  }

  async function create(campaign) {
    const longUrl = withCampaign(pageUrl(state.origin, path), campaign);
    const known = findExisting(state.links, longUrl);
    if (known) {
      say('You already have this link.');
      if (state.selected?.id !== known.id) select(known);
      return;
    }
    state.busy = true;
    render();
    try {
      const title = campaign ? `${path} (${campaign.label})` : path;
      const link = await bitly.createLink({
        longUrl, group: group(), domain: 'bit.ly', title,
      });
      if (!state.links.some((l) => l.id === link.id)) {
        state.links.unshift({ ...link, long_url: longUrl });
      }
      say(link.existed ? 'You already had this link.' : 'Short link created.');
      state.busy = false;
      select(link);
    } catch (e) {
      state.busy = false;
      render();
      fail(e);
    }
  }

  function linkRow(link) {
    const href = safeHref(link.link);
    const clicks = state.clicks.get(link.id);
    const isOpen = state.selected?.id === link.id;
    return el(
      'li',
      { className: 'bl-link' },
      el(
        'div',
        { className: 'bl-link-main' },
        href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, href.replace(/^https:\/\//, '')) : el('span', {}, link.id),
        el('span', { className: 'bl-meta' }, [campaignOf(link.long_url) || 'No campaign', clicks === undefined || clicks === null ? '' : `${clicks} click${clicks === 1 ? '' : 's'} in 30 days`].filter(Boolean).join(' · ')),
      ),
      el(
        'div',
        { className: 'bl-link-actions' },
        button('Copy link', () => navigator.clipboard.writeText(link.link).then(() => say('Copied the link.'), () => say("Couldn't copy."))),
        button(isOpen ? 'Hide QR code' : 'QR code', () => select(link), 'nx-action-btn nx-btn-sm', { 'aria-expanded': String(isOpen) }),
      ),
      isOpen && (state.selected.prepared ? qrView(link, state.selected.prepared) : el('p', { className: 'bl-hint' }, 'Making the QR code…')),
    );
  }

  function tokenCard() {
    const input = el('input', {
      type: 'password', id: 'bl-token', autocomplete: 'off', spellcheck: false,
    });
    const save = async () => {
      if (!input.value.trim()) return;
      tokens.set(input.value);
      input.value = '';
      setGroup('');
      start();
    };
    return el(
      'section',
      { className: 'bl-setup' },
      el('h2', {}, 'Connect your Bitly account'),
      el('p', {}, 'Paste your Bitly API token. Create one in Bitly under ', el('a', { href: TOKEN_HELP, target: '_blank', rel: 'noopener noreferrer' }, 'Settings, API'), '.'),
      el('div', { className: 'bl-field' }, el('label', { htmlFor: 'bl-token' }, 'API token'), input),
      button('Save', save, 'nx-btn-primary nx-btn-sm'),
      el('p', { className: 'bl-hint' }, tokens.persistent
        ? 'The token stays in this browser, for this panel only.'
        : "This browser blocks storage, so you'll paste the token again next time."),
    );
  }

  function render() {
    if (!alive) return;
    const url = state.origin && pageUrl(state.origin, path);
    const header = el(
      'section',
      { className: 'bl-page' },
      url ? el('p', {}, 'Links open ', el('strong', {}, url.replace(/^https:\/\//, ''))) : null,
      state.hostProblem ? el('p', { className: 'bl-warn' }, state.hostProblem, ' ', button('Retry', start, 'nx-action-btn-quiet nx-btn-sm')) : null,
      url && isDraft(path) ? el('p', { className: 'bl-warn' }, "Draft pages aren't public. A printed code would open an error page.") : null,
    );
    if (!tokens.get()) {
      main.replaceChildren(header, tokenCard());
      return;
    }
    const campaign = el('select', { id: 'bl-campaign' }, el('option', { value: '' }, 'No campaign'), CAMPAIGNS.map((c, i) => el('option', { value: String(i) }, c.label)));
    const list = state.links.length
      ? el('ul', { className: 'bl-links' }, state.links.map(linkRow))
      : el('p', { className: 'bl-hint' }, 'No short links for this page yet.');
    main.replaceChildren(
      header,
      el(
        'section',
        {},
        el('h2', {}, 'New short link'),
        el('div', { className: 'bl-field' }, el('label', { htmlFor: 'bl-campaign' }, 'Campaign'), campaign),
        button(state.busy ? 'Creating…' : 'Create short link', () => create(CAMPAIGNS[campaign.value] ?? null), 'nx-btn-primary nx-btn-sm', { disabled: !state.origin || state.busy }),
      ),
      el('section', {}, el('h2', {}, 'Your short links for this page'), list),
      el(
        'details',
        { className: 'bl-settings' },
        el('summary', {}, 'Settings'),
        el('p', {}, 'Your Bitly token is saved in this browser.'),
        button('Remove token', () => {
          tokens.clear();
          setGroup('');
          state.links = [];
          state.selected = null;
          render();
        }, 'nx-action-btn-quiet nx-btn-sm'),
      ),
      el('p', { className: 'bl-hint' }, 'Uses Bitly. Short links and QR codes go through bit.ly.'),
    );
  }

  async function start() {
    state.hostProblem = null;
    say('Loading…');
    bitly = tokens.get() ? createBitly({ token: tokens.get(), fetch }) : null;
    try {
      const host = await site.host();
      state.origin = hostOrigin(host);
      if (!state.origin) state.hostProblem = "This site has no published domain set, so links can't be created. Ask a site admin to set cdn.prod.host.";
    } catch {
      state.origin = null;
      state.hostProblem = "Couldn't read this site's published domain.";
    }
    try {
      await loadLinks();
      say('');
    } catch (e) {
      fail(e);
    }
    render();
  }

  start();
  return () => {
    alive = false;
    disposeDrag?.();
  };
}
