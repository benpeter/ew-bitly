# bit.ly for Experience Workspace

A library plugin for [Adobe Experience Workspace](https://da.live) (DA) that makes
[Bitly](https://bitly.com) short links and QR codes for the page you are editing.
It is not made or endorsed by Bitly.

Authors use it for print and social: a QR code on a table card, a flyer or a poster,
a short link in an Instagram bio or a newsletter. Each link carries a campaign
(`utm_source` and `utm_medium`), so the site's analytics can tell the table card
from the flyer. The panel shows how often each link was clicked in the last 30 days.

## What authors can do

- See the short links for the open page, with the campaign and clicks in the last 30 days.
- Create a short link for the page, with or without a campaign. If the same link
  exists already, Bitly returns it and no new one is made.
- Copy a link.
- Show a QR code for a link, then:
  - insert it at the cursor, as an image and, optionally, the link below it,
  - drag it into the page,
  - download it as SVG (for print) or PNG.

The QR code encodes the `bit.ly` link and is drawn in the browser. It uses none of the
Bitly plan's QR codes, and scans count as clicks on the link.

## What authors need

- A Bitly account. Free accounts work, but the free plan has 5 links a month and no
  click counts. Core ($10 a month, billed yearly) has 100 links a month and 30 days of clicks.
- A Bitly API token (Bitly: Settings, API). Each author pastes their own token into
  the panel once. Bitly's terms don't allow sharing access credentials, so there is
  no site-wide token.

The token stays in the browser's local storage for the plugin's origin. The plugin
sends it only to `api-ssl.bitly.com`. It never goes to Adobe or into the site config.
Remove it any time under Settings in the panel.

## Set it up on a site

Add a row to the `library` sheet of the site config (`https://da.live/config#/{org}/{site}/`):

| title | path | icon |
|---|---|---|
| bit.ly | `https://main--ew-bitly--benpeter.preview.da.live/tools/bitly/bitly.html` | `https://main--ew-bitly--benpeter.preview.da.live/tools/bitly/icon.svg` |

Leave `experience` empty: the plugin runs in the side panel (`inline`).

The site needs its production domain (`cdn.prod.host`) set, because links point to
the published page, not to preview. Without it the panel shows a warning and
doesn't create links.

## Limits

- Use the document view to insert QR codes. The layout view places images differently.
- Pages under `/drafts/` aren't public. The panel warns before you make a code for one.
- Publish the page before you print the code.
- Sites on the new AEM API (Helix 6) are detected, but this version is tested on DA
  sites with the classic setup only.
- The inserted or dropped QR image has no alt text. Add it in the editor, the way your site handles alt text.

## Develop

```sh
npm ci
npm test
npm run lint
```

`test/fixtures/panel.html` runs the panel with a fake Workspace SDK and a fake Bitly.
Serve the repo root (for example `python3 -m http.server 6789`) and open
`/test/fixtures/panel.html`. Query parameters: `token=none`, `host=`, `host=fail`,
`path=/`, `bitly=monthly`.

To try a local copy in Workspace, add a library row with `ref` set to `local`,
run `aem up`, and open Workspace with `?ref=local`.

## Licenses

Apache-2.0, see [LICENSE](LICENSE). `tools/bitly/vendor/qrcode.js` is
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by
Kazuhiko Arase, MIT license, see [tools/bitly/vendor/LICENSE-qrcode](tools/bitly/vendor/LICENSE-qrcode).
Bitly is a trademark of Bitly, Inc.

## Marketplace

`marketplace/row.json` is the row for the Workspace marketplace sheet.
`marketplace/card.png` (1200x720) is made from `marketplace/card.html`:

```sh
python3 -m http.server 6789 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,720 \
  --virtual-time-budget=3000 --screenshot=marketplace/card.png \
  http://127.0.0.1:6789/marketplace/card.html
```

The QR code on the card opens this repository.
