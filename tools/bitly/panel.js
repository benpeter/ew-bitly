/* eslint-disable no-use-before-define */
import { createBitly } from './api.js';
import createSite from './site.js';
import createTokenStore from './storage.js';
import keepPointerCapture from './capture.js';
import {
  CAMPAIGNS, hostOrigin, pageUrl, isDraft, withCampaign, isSamePage, findExisting, campaignOf,
  safeHref, qrFileName, mediaPath, imageHtml, linkHtml, errorMessage, bare,
} from './model.js';

const GROUP_KEY = 'ew-bitly:group';
const TOKEN_HELP = 'https://app.bitly.com/settings/api/';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
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
  context, actions, capabilities = {}, storage, fetch, site: siteOverride, qr: qrOverride,
}) {
  const tokens = createTokenStore(storage);
  const groups = createTokenStore(storage, GROUP_KEY);
  const site = siteOverride ?? createSite({
    org: context.org, site: context.site || context.repo, daFetch: actions.daFetch,
  });
  const path = context.path || '/';
  const canDrag = capabilities.dragDrop === 1 && typeof actions.makeDraggable === 'function';
  const state = {
    url: null,
    problem: null,
    listFailed: false,
    links: [],
    clicks: new Map(),
    selected: null,
    campaign: '',
    creating: false,
    inserting: false,
  };
  let bitly;
  let run = 0;
  let drag = { id: 0, dispose: null };
  let alive = true;
  let lastFocus = null;

  const status = el('p', { className: 'bl-status', role: 'status' });
  const main = el('div');
  root.replaceChildren(el('div', { className: 'bitly' }, main, status));
  const say = (text) => { status.textContent = text; };

  const stopDrag = () => {
    drag.dispose?.();
    drag = { id: drag.id + 1, dispose: null };
  };

  async function loadLinks(current) {
    state.links = [];
    state.clicks = new Map();
    state.listFailed = false;
    if (!bitly || !state.url) return;
    try {
      let group = groups.get();
      if (!group) {
        group = await bitly.defaultGroup();
        if (current !== run) return;
        groups.set(group);
      }
      const all = await bitly.listLinks({ group, hostPath: bare(state.url) });
      if (current !== run) return;
      state.links = all.filter((l) => isSamePage(l.long_url, state.url))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const clicks = await bitly.clicksFor(state.links.slice(0, 10).map((l) => l.id));
      if (current === run) state.clicks = clicks;
    } catch (e) {
      if (current !== run) return;
      state.listFailed = true;
      say(errorMessage(e));
    }
  }

  async function select(link) {
    stopDrag();
    if (state.selected?.id === link.id) {
      state.selected = null;
      render();
      return;
    }
    const href = safeHref(link.link);
    if (!href) return;
    state.selected = {
      id: link.id, link: href, withLink: true, prepared: null,
    };
    render();
    try {
      const { qrSvg, qrPng } = await (qrOverride ?? import('./qr.js'));
      const png = await qrPng(href);
      if (state.selected?.id !== link.id) return;
      state.selected.prepared = {
        svg: qrSvg(href),
        png,
        file: new File([png], qrFileName(href), { type: 'image/png' }),
      };
      render();
    } catch {
      say("Couldn't make the QR code.");
    }
  }

  async function insert() {
    const sel = state.selected;
    if (state.inserting || !sel?.prepared) return;
    state.inserting = true;
    render();
    say('Uploading the QR code…');
    try {
      const src = await site.upload(mediaPath(path, sel.prepared.file.name), sel.prepared.file);
      actions.sendHTML(imageHtml(src) + (sel.withLink ? linkHtml(sel.link) : ''));
      say('Sent to the page at the cursor.');
    } catch {
      say("Couldn't upload the QR code. Try again, or drag it into the page.");
    }
    state.inserting = false;
    render();
  }

  async function create() {
    const campaign = CAMPAIGNS[state.campaign] ?? null;
    const longUrl = withCampaign(state.url, campaign);
    const known = findExisting(state.links, longUrl);
    if (known) {
      say('You already have this link.');
      if (state.selected?.id !== known.id) select(known);
      return;
    }
    state.creating = true;
    render();
    try {
      const link = await bitly.createLink({
        longUrl,
        group: groups.get(),
        domain: 'bit.ly',
        title: campaign ? `${path} (${campaign.label})` : path,
      });
      if (!state.links.some((l) => l.id === link.id)) {
        state.links.unshift({ ...link, long_url: longUrl });
      }
      say(link.existed ? 'You already had this link.' : 'Short link created.');
      state.creating = false;
      select(link);
    } catch (e) {
      state.creating = false;
      render();
      say(errorMessage(e));
    }
  }

  function qrView() {
    const sel = state.selected;
    const { prepared } = sel;
    const preview = el('img', {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared.svg)}`,
      alt: `QR code for ${bare(sel.link)}`,
      width: 160,
      height: 160,
      draggable: false,
    });
    const handle = el('span', { className: `bl-code${canDrag ? ' bl-drag' : ''}`, title: canDrag ? 'Drag into the page' : null }, preview);
    if (canDrag) {
      stopDrag();
      const { id } = drag;
      actions.makeDraggable({
        element: keepPointerCapture(handle),
        getData: () => ({ files: [prepared.file] }),
        onResult: ({ ok, error }) => {
          if (ok) say('Added to the page.');
          else if (error !== 'cancelled') say("Couldn't add the QR code to the page.");
        },
      }).then((dispose) => {
        if (alive && id === drag.id) drag.dispose = dispose;
        else dispose();
      }, () => {});
    }
    return el(
      'div',
      { className: 'bl-qr' },
      handle,
      el(
        'div',
        { className: 'bl-check' },
        el('input', {
          type: 'checkbox', id: 'bl-with-link', checked: sel.withLink, onchange: (e) => { sel.withLink = e.target.checked; },
        }),
        el('label', { htmlFor: 'bl-with-link' }, 'Add the link below the image'),
      ),
      el(
        'div',
        { className: 'bl-actions' },
        button(state.inserting ? 'Inserting…' : 'Insert at cursor', insert, 'nx-btn-primary nx-btn-sm', { id: 'bl-insert', disabled: state.inserting }),
        button('Download SVG', () => download(new Blob([prepared.svg], { type: 'image/svg+xml' }), prepared.file.name.replace(/\.png$/, '.svg')), undefined, { id: 'bl-svg' }),
        button('Download PNG', () => download(prepared.png, prepared.file.name), undefined, { id: 'bl-png' }),
      ),
      el('p', { className: 'bl-hint' }, `Use the document view.${canDrag ? ' You can also drag the code into the page.' : ''} Publish the page before you print.`),
    );
  }

  function linkRow(link) {
    const href = safeHref(link.link);
    const clicks = state.clicks.get(link.id);
    const isOpen = state.selected?.id === link.id;
    const name = href ? bare(href) : link.id;
    const meta = [campaignOf(link.long_url) || 'No campaign'];
    if (typeof clicks === 'number') meta.push(`${clicks} click${clicks === 1 ? '' : 's'} in 30 days`);
    return el(
      'li',
      { className: 'bl-link' },
      el(
        'div',
        { className: 'bl-link-main' },
        href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, name) : el('span', {}, name),
        el('span', { className: 'bl-meta' }, meta.join(' · ')),
      ),
      href && el(
        'div',
        { className: 'bl-link-actions' },
        button('Copy link', () => navigator.clipboard.writeText(href).then(() => say('Copied the link.'), () => say("Couldn't copy.")), undefined, { 'aria-label': `Copy ${name}` }),
        button(isOpen ? 'Hide QR code' : 'QR code', () => select(link), undefined, {
          id: `bl-qr-${link.id}`, 'aria-label': `QR code for ${name}`, 'aria-expanded': String(isOpen),
        }),
      ),
      isOpen && (state.selected.prepared ? qrView() : el('p', { className: 'bl-hint' }, 'Making the QR code…')),
    );
  }

  function tokenCard() {
    const input = el('input', {
      type: 'password', id: 'bl-token', autocomplete: 'off', spellcheck: 'false',
    });
    const save = () => {
      if (!input.value.trim()) return;
      tokens.set(input.value);
      groups.clear();
      start();
    };
    return el(
      'section',
      { className: 'bl-setup' },
      el('h2', {}, 'Connect your Bitly account'),
      el('p', {}, 'Paste your Bitly API token. Create one in Bitly under ', el('a', { href: TOKEN_HELP, target: '_blank', rel: 'noopener noreferrer' }, 'Settings, API'), '.'),
      el('div', { className: 'bl-field' }, el('label', { htmlFor: 'bl-token' }, 'API token'), input),
      button('Save', save, 'nx-btn-primary nx-btn-sm', { id: 'bl-save' }),
      el('p', { className: 'bl-hint' }, tokens.persistent
        ? 'The token stays in this browser, for this panel only.'
        : "This browser blocks storage, so you'll paste the token again next time."),
    );
  }

  function render() {
    if (!alive) return;
    // A button disabled while busy drops focus to <body>; keep the last id then.
    if (document.activeElement?.id) lastFocus = document.activeElement.id;
    const active = document.activeElement;
    const focused = root.contains(active) || active === document.body ? lastFocus : null;
    const header = el(
      'section',
      { className: 'bl-page' },
      state.url && el('p', {}, 'Links open ', el('strong', {}, bare(state.url))),
      state.problem && el('p', { className: 'bl-warn' }, state.problem, ' ', button('Retry', start, 'nx-action-btn-quiet nx-btn-sm')),
      state.url && isDraft(path) && el('p', { className: 'bl-warn' }, "Draft pages aren't public. A printed code would open an error page."),
    );
    if (path === '/') {
      main.replaceChildren(el('p', {}, 'Open a page to make short links for it.'));
      return;
    }
    if (!tokens.get()) {
      main.replaceChildren(header, tokenCard());
      return;
    }
    const campaign = el(
      'select',
      { id: 'bl-campaign', onchange: (e) => { state.campaign = e.target.value; } },
      el('option', { value: '' }, 'No campaign'),
      CAMPAIGNS.map((c, i) => el('option', { value: String(i) }, c.label)),
    );
    campaign.value = state.campaign;
    let list = el('p', { className: 'bl-hint' }, state.url ? 'No short links for this page yet.' : '');
    if (state.listFailed) list = el('p', { className: 'bl-warn' }, "Couldn't load your links. ", button('Retry', start, 'nx-action-btn-quiet nx-btn-sm'));
    else if (state.links.length) list = el('ul', { className: 'bl-links' }, state.links.map(linkRow));
    main.replaceChildren(
      header,
      el(
        'section',
        {},
        el('h2', {}, 'New short link'),
        el('div', { className: 'bl-field' }, el('label', { htmlFor: 'bl-campaign' }, 'Campaign'), campaign),
        button(state.creating ? 'Creating…' : 'Create short link', create, 'nx-btn-primary nx-btn-sm', {
          id: 'bl-create', disabled: !state.url || state.listFailed || state.creating,
        }),
      ),
      el('section', {}, el('h2', {}, 'Your short links for this page'), list),
      el(
        'details',
        { className: 'bl-settings' },
        el('summary', {}, 'Settings'),
        el('p', {}, tokens.persistent ? 'Your Bitly token is saved in this browser.' : 'Your Bitly token is kept until you close this panel.'),
        button('Remove token', () => {
          tokens.clear();
          groups.clear();
          stopDrag();
          run += 1;
          state.links = [];
          state.selected = null;
          say('');
          render();
        }, 'nx-action-btn-quiet nx-btn-sm', { id: 'bl-remove' }),
      ),
      el('p', { className: 'bl-hint' }, 'Uses Bitly. Short links and scans go through bit.ly.'),
    );
    if (focused) document.getElementById(focused)?.focus();
  }

  async function start() {
    run += 1;
    const current = run;
    stopDrag();
    state.problem = null;
    state.selected = null;
    say('Loading…');
    render();
    bitly = tokens.get() ? createBitly({ token: tokens.get(), fetch }) : null;
    try {
      const origin = hostOrigin(await site.host());
      if (current !== run) return;
      state.url = origin && pageUrl(origin, path);
      if (!origin) state.problem = "This site has no published domain set, so links can't be created. Ask a site admin to set cdn.prod.host.";
    } catch {
      if (current !== run) return;
      state.url = null;
      state.problem = "Couldn't read this site's published domain. If Workspace signed you out, reload the page.";
    }
    say('');
    await loadLinks(current);
    if (current === run) render();
  }

  if (path !== '/') start();
  else render();
  return () => {
    alive = false;
    run += 1;
    stopDrag();
  };
}
