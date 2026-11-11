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
const ICONS = new URL('./img/', import.meta.url).href;
const SVG = 'http://www.w3.org/2000/svg';

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `${ICONS}${name}.svg#icon`);
  svg.append(use);
  return svg;
}

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

const QUIET = 'nx-action-btn-quiet';
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
  showToast,
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
  root.replaceChildren(el('main', { className: 'bitly' }, main));
  // Problems and progress stay in the panel; confirmations go to DA's toast when it loaded.
  const say = (text, busy = false) => {
    status.replaceChildren(...(busy ? [el('span', { className: 'nx-loading-spinner', 'aria-hidden': 'true' })] : []), text);
  };
  const notify = (text) => {
    if (typeof showToast !== 'function') {
      say(text);
      return;
    }
    say('');
    showToast({ text });
  };

  // DA's shared components may not have loaded. Then help shows inline and the token
  // menu is a plain button.
  const hasPopover = !!customElements.get('nx-popover');
  const hasMenu = !!customElements.get('nx-menu');
  let menu = null;
  const openHelp = () => [...root.querySelectorAll('nx-popover.bl-help-popover')].find((p) => p.open);
  // One overlay at a time: popovers only close on outside clicks and Escape.
  const closeOverlays = () => {
    openHelp()?.close();
    menu?.close?.();
  };
  // The popover closes itself on Escape; focus goes back to its button.
  document.addEventListener('keydown', (event) => {
    const popover = event.key === 'Escape' && openHelp();
    if (popover) root.querySelector(`[aria-controls="${popover.id}"]`)?.focus();
  });

  // Explanations sit behind an info button that opens a text-only nx-popover (EW Style Guide).
  function help(topic, row, ...texts) {
    if (!hasPopover) {
      row.append(...texts.map((text) => el('p', { className: 'bl-inline-help' }, text)));
      return row;
    }
    // Stable ids, so render() can put focus back on the button.
    const id = `bl-help-${topic.replace(/\W+/g, '-')}`;
    const trigger = el('button', {
      type: 'button',
      id: `${id}-button`,
      className: 'nx-action-btn-icon nx-btn-sm bl-help',
      'aria-label': `About ${topic}`,
      'aria-expanded': 'false',
      'aria-controls': id,
    }, icon('s2-icon-infocircle-20-n'));
    const popover = el('nx-popover', { id, className: 'bl-help-popover' }, ...texts.map((text) => el('p', {}, text)));
    popover.scoped = true;
    trigger.addEventListener('click', () => {
      if (typeof popover.show !== 'function') return;
      if (popover.open) {
        popover.close();
        return;
      }
      closeOverlays();
      popover.show({ anchor: row, placement: 'auto' });
      trigger.setAttribute('aria-expanded', 'true');
    });
    popover.addEventListener('close', () => trigger.setAttribute('aria-expanded', 'false'));
    row.append(trigger, popover);
    return row;
  }
  const row = (...children) => el('div', { className: 'bl-row' }, ...children);

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
    say('Uploading the QR code…', true);
    try {
      const src = await site.upload(mediaPath(path, sel.prepared.file.name), sel.prepared.file);
      actions.sendHTML(imageHtml(src) + (sel.withLink ? linkHtml(sel.link) : ''));
      notify('Added to the page. Add alt text to the image in the editor.');
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
      notify('You already have this link.');
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
      notify(link.existed ? 'You already have this link.' : 'Short link created.');
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
          if (ok) notify('Added to the page. Add alt text to the image in the editor.');
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
      el('label', { className: 'nx-checkbox bl-check' }, el('input', {
        type: 'checkbox', id: 'bl-with-link', checked: sel.withLink, onchange: (e) => { sel.withLink = e.target.checked; },
      }), 'Add the link below the image'),
      help(
        'adding the QR code',
        row(
          button(state.inserting ? 'Inserting…' : 'Insert at cursor', insert, 'nx-form-btn-secondary', { id: 'bl-insert', disabled: state.inserting }),
          downloadControl(prepared),
        ),
        `Insert at cursor works in the Content view of the editor.${canDrag ? ' You can also drag the code into the page.' : ''}`,
        'The code opens the published page. Publish the page before you share the code. SVG stays sharp at any size.',
      ),
    );
  }

  // One "Download" button with a menu keeps the QR actions on one line.
  function downloadControl(prepared) {
    const svg = () => download(new Blob([prepared.svg], { type: 'image/svg+xml' }), prepared.file.name.replace(/\.png$/, '.svg'));
    const png = () => download(prepared.png, prepared.file.name);
    if (!hasMenu) {
      return [
        button('Download SVG', svg, 'nx-form-btn-secondary', { id: 'bl-svg' }),
        button('Download PNG', png, 'nx-form-btn-secondary', { id: 'bl-png' }),
      ];
    }
    const trigger = el('button', {
      type: 'button', slot: 'trigger', id: 'bl-download', className: 'nx-form-btn-secondary',
    }, 'Download');
    const control = el('nx-menu', { placement: 'auto' }, trigger);
    control.items = [
      { id: 'svg', label: 'SVG', description: 'Scales to any size' },
      { id: 'png', label: 'PNG', description: 'At least 1024 pixels wide' },
    ];
    control.addEventListener('select', (e) => (e.detail?.id === 'svg' ? svg : png)());
    return control;
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
        button('Copy link', () => navigator.clipboard.writeText(href).then(() => notify('Copied the link.'), () => say("Couldn't copy.")), QUIET, { id: `bl-copy-${link.id}`, 'aria-label': `Copy ${name}` }),
        button(isOpen ? 'Hide QR code' : 'QR code', () => select(link), QUIET, {
          id: `bl-qr-${link.id}`, 'aria-label': `QR code for ${name}`, 'aria-expanded': String(isOpen),
        }),
      ),
      isOpen && (state.selected.prepared ? qrView() : el('p', { className: 'bl-status', role: 'status' }, el('span', { className: 'nx-loading-spinner', 'aria-hidden': 'true' }), 'Making the QR code…')),
    );
  }

  function tokenCard() {
    const input = el('input', {
      type: 'password', id: 'bl-token', className: 'nx-input', autocomplete: 'off', spellcheck: 'false',
    });
    // A form, so Enter connects.
    const onsubmit = (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      tokens.set(input.value);
      groups.clear();
      start();
    };
    return el(
      'form',
      { className: 'bl-setup', onsubmit },
      help(
        'the Bitly token',
        row(el('h2', {}, 'Connect Bitly')),
        'Each author uses their own Bitly account and API token.',
        'The token stays in this browser. It goes to Bitly and nowhere else.',
      ),
      el('label', { className: 'nx-form-field' }, 'Bitly API token', input),
      !tokens.persistent && el('p', { className: 'bl-note' }, "This browser blocks storage, so you'll paste the token again next time."),
      row(
        el('button', { type: 'submit', id: 'bl-save', className: 'nx-form-btn-primary' }, 'Connect'),
        el('a', { href: TOKEN_HELP, target: '_blank', rel: 'noopener noreferrer' }, 'Get a token in Bitly'),
      ),
    );
  }

  function render() {
    if (!alive) return;
    // A button disabled while busy drops focus to <body>; keep the last id then.
    if (document.activeElement?.id) lastFocus = document.activeElement.id;
    const active = document.activeElement;
    const focused = root.contains(active) || active === document.body ? lastFocus : null;
    const removeToken = () => {
      tokens.clear();
      groups.clear();
      stopDrag();
      run += 1;
      state.links = [];
      state.selected = null;
      say('');
      render();
      document.getElementById('bl-token')?.focus();
    };
    // Removing the token is rare, so it sits in a menu, not next to the daily actions.
    let tokenControl = null;
    if (tokens.get()) {
      const trigger = el('button', {
        type: 'button', slot: 'trigger', id: 'bl-options', className: 'nx-action-btn-icon nx-btn-sm', 'aria-label': 'Bitly account options',
      }, icon('s2-icon-more-20-n'));
      if (hasMenu) {
        tokenControl = el('nx-menu', { placement: 'below-end' }, trigger);
        tokenControl.items = [{ id: 'remove', label: 'Remove Bitly token', description: 'Only from this browser. Your links stay in Bitly.' }];
        tokenControl.addEventListener('select', (e) => { if (e.detail?.id === 'remove') removeToken(); });
        // nx-menu doesn't return focus when it closes.
        const menuEl = tokenControl;
        menuEl.addEventListener('close', () => {
          const { activeElement } = document;
          const inside = activeElement === menuEl || menuEl.contains(activeElement);
          if (inside && document.hasFocus()) trigger.focus();
        });
        trigger.addEventListener('click', () => openHelp()?.close());
        menu = menuEl;
      } else {
        tokenControl = button('Remove Bitly token', removeToken, QUIET, { id: 'bl-remove' });
      }
    }
    const header = el(
      'section',
      { className: 'bl-page' },
      el('h1', { className: 'bl-vh' }, 'Short links'),
      el(
        'div',
        { className: 'bl-title' },
        state.url ? help(
          'these links',
          row(el('p', {}, 'Links open ', el('strong', {}, bare(state.url)))),
          "Short links point to this page on the site's published domain. A campaign adds utm_source and utm_medium, so your analytics can tell a table card from a flyer.",
          'Links and scans go through bit.ly, under your Bitly account.',
        ) : el('span'),
        tokenControl,
      ),
      state.problem && el('p', { className: 'bl-warn' }, state.problem, ' ', button('Retry', start, QUIET, { id: 'bl-retry-host' })),
      state.url && isDraft(path) && el('p', { className: 'bl-warn' }, "Draft pages aren't public. A shared code would open an error page."),
      status,
    );
    if (path === '/') {
      main.replaceChildren(el('p', {}, 'Open a page to make short links for it.'));
      return;
    }
    if (!tokens.get()) {
      main.replaceChildren(header, tokenCard());
      return;
    }
    const options = [{ value: '', label: 'No campaign' }, ...CAMPAIGNS.map((c, i) => ({ value: String(i), label: c.label }))];
    let campaign;
    if (customElements.get('nx-picker')) {
      // nx-picker has no label of its own; the group carries the visible label's text.
      campaign = el('nx-picker', { id: 'bl-campaign', variant: 'field', size: 'm' });
      campaign.items = options;
      campaign.value = state.campaign;
      campaign.addEventListener('change', (e) => { state.campaign = e.detail.value; });
    } else {
      campaign = el(
        'select',
        { id: 'bl-campaign', className: 'nx-input', onchange: (e) => { state.campaign = e.target.value; } },
        options.map((o) => el('option', { value: o.value }, o.label)),
      );
      campaign.value = state.campaign;
    }
    let list = state.url ? el('p', { className: 'bl-empty' }, 'No short links for this page yet.') : null;
    if (state.listFailed) list = el('p', { className: 'bl-warn' }, "Couldn't load your links. ", button('Retry', start, QUIET, { id: 'bl-retry-list' }));
    else if (state.links.length) list = el('ul', { className: 'bl-links' }, state.links.map(linkRow));
    main.replaceChildren(
      header,
      el(
        'section',
        {},
        help(
          'new short links',
          row(el('h2', {}, 'New short link')),
          'If this page already has a link for the campaign, you get that link instead of a new one.',
          'Each new link counts toward your Bitly plan\'s monthly links.',
        ),
        el('div', { className: 'nx-form-field', role: 'group', 'aria-labelledby': 'bl-campaign-label' }, el('span', { id: 'bl-campaign-label' }, 'Campaign'), campaign),
        button(state.creating ? 'Creating…' : 'Create short link', create, 'nx-form-btn-primary', {
          id: 'bl-create', disabled: !state.url || state.listFailed || state.creating,
        }),
      ),
      el(
        'section',
        {},
        help(
          'click counts',
          row(el('h2', {}, 'Short links for this page')),
          'QR code scans count as clicks. Bitly can take a few minutes to count a new one.',
        ),
        list,
      ),
    );
    if (focused) document.getElementById(focused)?.focus();
  }

  async function start() {
    run += 1;
    const current = run;
    stopDrag();
    state.problem = null;
    state.selected = null;
    say('Loading…', true);
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
