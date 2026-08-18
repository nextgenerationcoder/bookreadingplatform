# bookreadingplatform

An interactive German→Persian reading platform: click any German word to see its
gloss, page through a book, and have the app automatically remember which words
you clicked on (and how often) as a signal for future review/learning features.

## Architecture

- **server/** — Node/Express API, storing data in a SQLite database
  (`server/data/app.db`, path overridable via `DB_PATH`):
  - `books` / `pages` / `sentences` — each book's content (DE + FA text)
  - `dictionary` — global word → Persian gloss lookup, applied automatically
    when rendering any sentence (no per-word manual markup needed)
  - `progress` — last-read page per user, per book
  - `word_clicks` / `word_click_books` / `word_click_pages` — every word a
    user has clicked, with counts and per-book/per-page breakdown — this is
    the "what is this person learning" signal the rest of the platform can
    build on later
  - In production the server also serves the built client (`client/dist`) as
    static files, so the whole app is one process on one port.
- **client/** — Vite + vanilla JS frontend (library / reader / add book / add
  pages / my words) that renders pages, tokenizes German sentences (including
  recognizing split separable-prefix verbs like "teilte ... aus" = austeilen
  as one word — see `client/src/separableVerbs.js`), looks up glosses, and
  calls the API to record clicks/progress automatically.

Users are anonymous for now: the client generates a UUID on first visit and
stores it in `localStorage`, sent as `userId` on every API call. Swapping this
for real accounts later just means replacing that one ID with an authenticated
user id — the storage shape already supports it.

## Adding book content

Content is authored as plain text and imported — you don't hand-write
per-word markup. See `server/content/laurie-saunders.txt` for the format:

```
BOOK: <book-id>
TITLE: <display title>
LANG: de -> fa

PAGE 7
CHAPTER: Kapitel 1
1: <German sentence>
<Persian translation>
2: <German sentence>
<Persian translation>
```

Import/update a book from the CLI:

```bash
cd server
node scripts/import-book.js content/<file>.txt
```

Word-by-word glosses come from `server/data/dictionary.seed.json` — add new
words there as you add books; any word not yet in the dictionary shows a "not
yet translated" placeholder in the UI instead of blocking the import.

All of this is also available from the app itself once it's running: the
library page has "+ افزودن کتاب" (add a book), "+ افزودن صفحه" on each book
card (append more pages to an existing book), and "✏️ ویرایش نام" (rename).

## Running locally

```bash
npm install          # installs both workspaces
npm run dev:server    # http://localhost:4000
npm run dev:client    # http://localhost:5173 (proxies /api to the server)
```

Open http://localhost:5173. On first run against an empty database, the
server auto-seeds itself from `server/data/dictionary.seed.json` and every
`.txt` file in `server/content/` — after that, seeding is a no-op, so nothing
you add/rename/edit through the app ever gets overwritten.

## Deploying (Docker)

The repo root has a `Dockerfile` (builds the client, installs server deps
including the native `better-sqlite3` module, ships a single image that runs
`node server/src/index.js`) and a `docker-compose.yml` set up to run behind
an existing Traefik reverse proxy (the same pattern used for n8n on this
project's server) — it joins Traefik's Docker network as `external` and
carries the labels Traefik needs to route a subdomain to it with automatic
Let's Encrypt HTTPS, no separate Nginx/Apache needed.

To deploy or update on the server:

```bash
git pull
docker compose up -d --build
```

The SQLite database lives in a named Docker volume (`app_data`), so it
survives rebuilds/redeploys. To point this at a different subdomain or
Traefik cert resolver, edit the `labels:` block in `docker-compose.yml`.
