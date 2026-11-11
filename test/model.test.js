import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGNS, hostOrigin, pageUrl, isDraft, withCampaign, isSamePage, findExisting, campaignOf,
  safeHref, qrFileName, mediaPath, imageHtml, linkHtml, errorMessage,
} from '../tools/bitly/model.js';

describe('CAMPAIGNS', () => {
  it('has the demo presets', () => {
    assert.deepEqual(CAMPAIGNS.map((c) => c.label), ['Table card', 'Flyer', 'Instagram', 'Newsletter']);
    assert.deepEqual(CAMPAIGNS[0], { label: 'Table card', source: 'table-card', medium: 'print' });
  });
});

describe('hostOrigin', () => {
  it('accepts a bare host or an https origin', () => {
    assert.equal(hostOrigin('schamdan.de'), 'https://schamdan.de');
    assert.equal(hostOrigin('https://www.schamdan.de/'), 'https://www.schamdan.de');
    assert.equal(hostOrigin('main--site--org.aem.live'), 'https://main--site--org.aem.live');
  });

  it('rejects anything else', () => {
    ['', undefined, 42, 'http://schamdan.de', 'schamdan.de:8080', 'schamdan.de/menu',
      'user@schamdan.de', 'localhost', 'main--site--org.aem.page', 'x.hlx.page', 'schamdan.de?x=1']
      .forEach((host) => assert.equal(hostOrigin(host), null, String(host)));
  });
});

describe('pageUrl', () => {
  it('maps editor paths to production URLs', () => {
    const url = (path) => pageUrl('https://h.de', path);
    assert.equal(url('/speisekarte'), 'https://h.de/speisekarte');
    assert.equal(url('/speisekarte.html'), 'https://h.de/speisekarte');
    assert.equal(url('/index'), 'https://h.de/');
    assert.equal(url('/en/index'), 'https://h.de/en/');
    assert.equal(url('/'), 'https://h.de/');
    assert.equal(url('drafts/benp/test'), 'https://h.de/drafts/benp/test');
  });
});

describe('isDraft', () => {
  it('flags paths under /drafts/', () => {
    assert.equal(isDraft('/drafts/benp/test'), true);
    assert.equal(isDraft('/speisekarte'), false);
    assert.equal(isDraft('/news/drafts'), false);
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

  it('ignores query, hash, scheme and host case', () => {
    assert.equal(isSamePage('https://schamdan.de/speisekarte?utm_source=x#top', page), true);
    assert.equal(isSamePage('http://SCHAMDAN.de/speisekarte', page), true);
  });

  it('rejects other pages, a trailing slash and other hosts', () => {
    assert.equal(isSamePage('https://schamdan.de/speisekarte/', page), false);
    assert.equal(isSamePage('https://schamdan.de/speisekarte/getraenke', page), false);
    assert.equal(isSamePage('https://www.schamdan.de/speisekarte', page), false);
    assert.equal(isSamePage('not a url', page), false);
  });

  it('matches the root with or without a slash', () => {
    assert.equal(isSamePage('https://schamdan.de', 'https://schamdan.de/'), true);
  });
});

describe('findExisting', () => {
  const links = [
    { id: 'bit.ly/a', long_url: 'https://h.de/menu?utm_source=flyer&utm_medium=print' },
    { id: 'bit.ly/b', long_url: 'https://h.de/menu' },
  ];

  it('finds a link with the exact same long URL', () => {
    assert.equal(findExisting(links, 'https://h.de/menu').id, 'bit.ly/b');
    assert.equal(findExisting(links, 'https://h.de/menu?utm_source=flyer&utm_medium=print').id, 'bit.ly/a');
  });

  it('returns undefined otherwise', () => {
    assert.equal(findExisting(links, 'https://h.de/menu?utm_source=qr&utm_medium=print'), undefined);
  });
});

describe('campaignOf', () => {
  it('names a known campaign, else utm_source, else empty', () => {
    assert.equal(campaignOf('https://h.de/?utm_source=flyer&utm_medium=print'), 'Flyer');
    assert.equal(campaignOf('https://h.de/?utm_source=radio'), 'radio');
    assert.equal(campaignOf('https://h.de/'), '');
    assert.equal(campaignOf('nope'), '');
  });
});

describe('safeHref', () => {
  it('allows https links only', () => {
    assert.equal(safeHref('https://bit.ly/abc'), 'https://bit.ly/abc');
    // eslint-disable-next-line no-script-url
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.equal(safeHref('http://bit.ly/abc'), null);
    assert.equal(safeHref(undefined), null);
  });
});

describe('qrFileName', () => {
  it('is unique per link and uses safe characters', () => {
    assert.equal(qrFileName('https://bit.ly/3XyZabc'), 'qr-bit-ly-3XyZabc.png');
    assert.notEqual(qrFileName('https://bit.ly/3XyZabc'), qrFileName('https://bit.ly/3XyZabd'));
    assert.match(qrFileName('https://go.example.com/a/b?c'), /^qr-[A-Za-z0-9-]+\.png$/);
  });
});

describe('mediaPath', () => {
  it('puts media next to the page like the editor does', () => {
    assert.equal(mediaPath('/speisekarte', 'qr.png'), '/.speisekarte/qr.png');
    assert.equal(mediaPath('/drafts/benp/test', 'qr.png'), '/drafts/benp/.test/qr.png');
    assert.equal(mediaPath('/drafts/benp/test.html', 'qr.png'), '/drafts/benp/.test/qr.png');
    assert.equal(mediaPath('/', 'qr.png'), '/.index/qr.png');
    assert.equal(mediaPath('/en/', 'qr.png'), '/en/.index/qr.png');
  });
});

describe('imageHtml and linkHtml', () => {
  it('builds escaped markup', () => {
    assert.equal(
      imageHtml({ src: 'https://content.da.live/o/s/.p/qr.png', alt: 'QR code: "Menü" <b>' }),
      '<p><img src="https://content.da.live/o/s/.p/qr.png" alt="QR code: &quot;Menü&quot; &lt;b&gt;"></p>',
    );
    assert.equal(linkHtml('https://bit.ly/abc'), '<p><a href="https://bit.ly/abc">bit.ly/abc</a></p>');
  });
});

describe('errorMessage', () => {
  it('maps common cases to plain words', () => {
    assert.match(errorMessage({ status: 0 }), /didn't answer/);
    assert.match(errorMessage({ status: 401 }), /token/);
    assert.match(errorMessage({ status: 403, body: { message: 'FORBIDDEN' } }), /token/);
    assert.match(errorMessage({ status: 429, body: { message: 'MONTHLY_LIMIT_EXCEEDED' } }), /monthly limit/);
    assert.match(errorMessage({ status: 429, body: { message: 'API_USAGE_LIMIT_EXCEEDED' } }), /monthly limit/);
    assert.match(errorMessage({ status: 429, body: { message: 'RATE_LIMIT_EXCEEDED' } }), /Wait a minute/);
    assert.match(errorMessage({ status: 400, body: { message: 'INVALID_ARG_LONG_URL' } }), /page URL/);
  });

  it('shows status and message otherwise', () => {
    assert.equal(errorMessage({ status: 500, body: { message: 'INTERNAL_ERROR' } }), 'Bitly returned an error (500: INTERNAL_ERROR).');
    assert.equal(errorMessage({ status: 502 }), 'Bitly returned an error (502).');
  });
});
