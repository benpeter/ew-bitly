import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSettings, pageUrl, withCampaign, isSamePage, campaignOf, errorMessage,
} from '../tools/bitly/model.js';

const config = (rows) => ({
  ':names': ['data', 'bitly'],
  ':type': 'multi-sheet',
  data: { data: [{ key: '', value: '' }] },
  bitly: { data: rows },
});

describe('readSettings', () => {
  it('uses defaults without a bitly sheet', () => {
    const s = readSettings({ ':names': ['data'], data: { data: [] } });
    assert.equal(s.host, '');
    assert.equal(s.group, '');
    assert.equal(s.domain, 'bit.ly');
    assert.ok(s.campaigns.length > 0);
  });

  it('uses defaults for a missing or broken config', () => {
    assert.equal(readSettings(undefined).domain, 'bit.ly');
    assert.equal(readSettings('nope').domain, 'bit.ly');
  });

  it('reads host, group and domain, trimmed', () => {
    const s = readSettings(config([
      { key: 'host', value: ' schamdan.de ' },
      { key: 'group', value: 'Bk1abc' },
      { key: 'domain', value: 'go.example.com' },
      { key: 'unknown', value: 'x' },
    ]));
    assert.equal(s.host, 'schamdan.de');
    assert.equal(s.group, 'Bk1abc');
    assert.equal(s.domain, 'go.example.com');
  });

  it('accepts an https origin as host', () => {
    assert.equal(readSettings(config([{ key: 'host', value: 'https://schamdan.de/' }])).host, 'schamdan.de');
  });

  it('ignores an empty value', () => {
    assert.equal(readSettings(config([{ key: 'domain', value: '' }])).domain, 'bit.ly');
  });

  it('parses campaigns and skips bad entries', () => {
    const s = readSettings(config([
      { key: 'campaigns', value: 'Table card=table-card/print | broken | Flyer=flyer/ | Instagram=instagram/social' },
    ]));
    assert.deepEqual(s.campaigns, [
      { label: 'Table card', source: 'table-card', medium: 'print' },
      { label: 'Instagram', source: 'instagram', medium: 'social' },
    ]);
  });
});

describe('pageUrl', () => {
  const settings = readSettings(undefined);

  it('uses the configured host', () => {
    const r = pageUrl({ context: { org: 'o', repo: 's', path: '/speisekarte' }, settings: { ...settings, host: 'schamdan.de' } });
    assert.deepEqual(r, { url: 'https://schamdan.de/speisekarte', host: 'schamdan.de', hostSource: 'config' });
  });

  it('falls back to the aem.live host', () => {
    const r = pageUrl({ context: { org: 'benpeter', repo: 'da-schamdan', path: '/ueber-uns' }, settings });
    assert.equal(r.url, 'https://main--da-schamdan--benpeter.aem.live/ueber-uns');
    assert.equal(r.hostSource, 'default');
  });

  it('prefers site over repo', () => {
    const r = pageUrl({
      context: {
        org: 'o', site: 'a', repo: 'b', path: '/x',
      },
      settings,
    });
    assert.equal(r.host, 'main--a--o.aem.live');
  });

  it('maps .html and index paths', () => {
    const url = (path) => pageUrl({ context: { org: 'o', repo: 's', path }, settings: { ...settings, host: 'h.de' } }).url;
    assert.equal(url('/speisekarte.html'), 'https://h.de/speisekarte');
    assert.equal(url('/index'), 'https://h.de/');
    assert.equal(url('/index.html'), 'https://h.de/');
    assert.equal(url('/en/index'), 'https://h.de/en/');
    assert.equal(url('/'), 'https://h.de/');
    assert.equal(url(''), 'https://h.de/');
    assert.equal(url('drafts/benp/test'), 'https://h.de/drafts/benp/test');
  });

  it('returns null without org and site', () => {
    assert.equal(pageUrl({ context: {}, settings }), null);
  });
});

describe('withCampaign', () => {
  const campaign = { label: 'Flyer', source: 'flyer', medium: 'print' };

  it('adds utm parameters', () => {
    assert.equal(withCampaign('https://h.de/menu', campaign), 'https://h.de/menu?utm_source=flyer&utm_medium=print');
  });

  it('keeps other parameters and overwrites utm ones', () => {
    assert.equal(
      withCampaign('https://h.de/menu?a=1&utm_source=old', campaign),
      'https://h.de/menu?a=1&utm_source=flyer&utm_medium=print',
    );
  });

  it('leaves the url alone without a campaign', () => {
    assert.equal(withCampaign('https://h.de/menu', null), 'https://h.de/menu');
  });
});

describe('isSamePage', () => {
  const page = 'https://schamdan.de/speisekarte';

  it('matches with query, hash and trailing slash', () => {
    assert.equal(isSamePage('https://schamdan.de/speisekarte?utm_source=x#top', page), true);
    assert.equal(isSamePage('https://SCHAMDAN.de/speisekarte/', page), true);
    assert.equal(isSamePage('http://schamdan.de/speisekarte', page), true);
  });

  it('rejects other pages and hosts', () => {
    assert.equal(isSamePage('https://schamdan.de/speisekarte/getraenke', page), false);
    assert.equal(isSamePage('https://www.schamdan.de/speisekarte', page), false);
    assert.equal(isSamePage('not a url', page), false);
  });

  it('matches the root', () => {
    assert.equal(isSamePage('https://schamdan.de', 'https://schamdan.de/'), true);
  });
});

describe('campaignOf', () => {
  const campaigns = [{ label: 'Flyer', source: 'flyer', medium: 'print' }];

  it('names a known campaign', () => {
    assert.equal(campaignOf('https://h.de/?utm_source=flyer&utm_medium=print', campaigns), 'Flyer');
  });

  it('falls back to utm_source, then empty', () => {
    assert.equal(campaignOf('https://h.de/?utm_source=radio', campaigns), 'radio');
    assert.equal(campaignOf('https://h.de/', campaigns), '');
    assert.equal(campaignOf('nope', campaigns), '');
  });
});

describe('errorMessage', () => {
  it('maps common cases to plain words', () => {
    assert.match(errorMessage({ status: 0 }), /didn't answer/);
    assert.match(errorMessage({ status: 401 }), /token/);
    assert.match(errorMessage({ status: 403, body: { message: 'FORBIDDEN' } }), /token/);
    assert.match(errorMessage({ status: 429, body: { message: 'MONTHLY_LIMIT_EXCEEDED' } }), /monthly limit/);
    assert.match(errorMessage({ status: 429, body: { message: 'RATE_LIMIT_EXCEEDED' } }), /Wait a minute/);
    assert.match(errorMessage({ status: 400, body: { message: 'INVALID_ARG_LONG_URL' } }), /page URL/);
  });

  it('shows status and message otherwise', () => {
    assert.equal(errorMessage({ status: 500, body: { message: 'INTERNAL_ERROR' } }), 'Bitly returned an error (500: INTERNAL_ERROR).');
    assert.equal(errorMessage({ status: 502 }), 'Bitly returned an error (502).');
  });
});
