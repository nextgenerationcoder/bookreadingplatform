# Reading Mode Chrome extension

Turns any webpage into German reading practice against your Book Reading
Platform account. Click a word you don't know → it's saved as a **learning**
word; everything else the scan touches → saved as **passive** vocabulary.
Same distinction and the same `POST /api/vocab/reading-page` endpoint the
website's own reader uses (see `server/src/routes/vocab.js`), so words show
up in "My Words" identically whether they came from a book page or a random
webpage.

## Load it (development / unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the extension (puzzle-piece icon in the toolbar → pin).

No build step - it's plain JS/HTML/CSS, loaded as-is.

## Using it

1. Click the extension icon and log in with your Book Reading Platform
   account email/password.
2. Open any webpage with German text, click the icon, and press
   **Start Reading Mode**. Every German-looking word on the page gets
   colored (gray = new, orange = learning, green = known/learned) using your
   account's real vocab status, exactly like the website's reader.
3. Click a word to see its gloss and mark it as a learning word.
4. Press **Sync words** on the floating "Reading Mode" widget (bottom-right
   of the page) to save everything to your account: clicked words as
   learning, everything else the scan touched as passive. Press it again
   any time - already-synced words reset and only new activity is sent on
   each sync.
5. Press **Stop** on the widget (or toggle from the popup) to unwrap the
   page and remove the widget.

### Highlight colors

Click **Highlight colors…** in the popup to open the options page and pick
your own colors for known/learning/new words (defaults match the website).
New colors apply the next time you start Reading Mode on a page.

## How auth works

The extension can't use the website's httpOnly session cookie (a Chrome
extension's background/content scripts have no access to it, and it's
cross-site from the page's point of view anyway). Logging in via the popup
calls the same `POST /api/auth/login` the website uses, but the server also
returns the raw session token in the response body - the extension's
background service worker stores that in `chrome.storage.local` and sends
it back as `Authorization: Bearer <token>` on every request. `requireAuth`
server-side (see `server/src/auth.js`) accepts either the cookie or this
header, so it's the exact same session mechanism, just carried a different
way. See `server/src/routes/auth.js`.

All network requests are made from `background.js`, never from
`content.js` - content scripts run inside arbitrary third-party pages and
would be subject to that page's Content-Security-Policy (many sites block
cross-origin `connect-src`), which the background service worker isn't
bound by. `content.js` only ever talks to `background.js` via
`chrome.runtime.sendMessage`.

## Files

- `manifest.json` - MV3 manifest. `content_scripts` loads `content.js` on
  every `http(s)` page except the platform's own site (dormant until
  toggled on).
- `background.js` - service worker; owns the session token and all API
  calls (`fetch` to `https://book.amirseyti.de`).
- `content.js` - Reading Mode itself: wraps words in spans, colors them by
  vocab status, shows a gloss popup on click, and the floating
  Sync/Stop widget.
- `popup.html` / `popup.js` - login form + Reading Mode toggle for the
  active tab.
- `options.html` / `options.js` - highlight-color picker
  (`chrome.storage.sync`).
- `icons/` - toolbar/store icons.

## Publishing

To package for the Chrome Web Store: zip the contents of this folder
(not the folder itself) and upload. Update `API_BASE` in `background.js`
and the `host_permissions`/`content_scripts.exclude_matches` entries in
`manifest.json` first if the platform's domain ever changes.
