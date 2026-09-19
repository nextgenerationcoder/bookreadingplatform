# Reading Mode Chrome extension

Turns any webpage into German reading practice against your Book Reading
Platform account. Click a word you don't know → it's saved as a **learning**
word; everything else you've read past → saved as **passive** vocabulary.
Same distinction and the same `POST /api/vocab/reading-page` endpoint the
website's own reader uses (see `server/src/routes/vocab.js`), so words show
up in "My Words" identically whether they came from a book page or a random
webpage.

Titles, navigation, headers/footers and similar boilerplate are never
touched at all (excluded entirely, not just left uncolored) - and passive
credit only ever covers the paragraph you've actually clicked through, up
to your last click in it, exactly like the website's own reader (see
"How passive words get picked" below). Reading Mode never assumes you've
read the whole page just because it's open.

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
   **Start Reading Mode**. Every German-looking word in the page's actual
   content gets colored (gray = new, orange = learning, green =
   known/learned) using your account's real vocab status, exactly like the
   website's reader - titles, nav, headers/footers etc. are left alone
   entirely, not wrapped or colored at all.
3. Click a word to see its gloss and mark it as a learning word (turns
   orange immediately). This also marks everything *between your previous
   click and this one, within the same paragraph*, as passively known
   (green) - reading through a paragraph and clicking the words you don't
   know credits the rest of that paragraph as passive, same as the website.
   It never jumps to other paragraphs and never assumes you've read
   anything you haven't actually clicked through.
4. Reading Mode auto-syncs to your account a few seconds after your last
   click, and again when you press **Stop** or navigate away - so you don't
   need to remember to save. The floating "Reading Mode" widget
   (bottom-right of the page) also has a **Sync words** button for an
   immediate sync, and shows a live "N to learn queued" status.
5. Press **Stop** on the widget (or toggle from the popup) to unwrap the
   page and remove the widget - this also flushes any not-yet-synced words.

### How passive words get picked

Passive credit is scoped tightly on purpose, so Reading Mode never claims
you understood text you didn't actually read:

- **Paragraph-scoped**: each `<p>` (or `<li>`/`<blockquote>`/`<div>`/etc.
  that's acting as one) tracks its own "read up to here" position,
  independently of every other paragraph on the page.
- **Click-driven, forward-only**: within a paragraph, clicking a word
  commits every word between the last click and this one (inclusive) as
  passive. Nothing past your last click, and nothing in a paragraph you
  haven't clicked in at all, is ever marked passive or synced.
- **Never auto-completes a page**: unlike the website's "Finish Page"
  button, there's no "I'm done" signal on an arbitrary webpage, so Reading
  Mode never assumes you finished reading just because you stopped or
  navigated away - only what you actually clicked through gets synced.

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
