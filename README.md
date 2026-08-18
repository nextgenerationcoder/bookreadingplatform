# bookreadingplatform

An interactive German→Persian reading platform: click any German word to see its
gloss, page through a book, and have the app automatically remember which words
you clicked on (and how often) as a signal for future review/learning features.

## Architecture

- **server/** — Node/Express API, storing data as JSON files under `server/data/`:
  - `books/<id>.json` — a book's pages/sentences (DE + FA text)
  - `dictionary.json` — global word → Persian gloss lookup, applied automatically
    when rendering any sentence (no per-word manual markup needed)
  - `progress.json` — last-read page per user, per book
  - `wordClicks.json` — every word a user has clicked, with counts and
    per-book/per-page breakdown — this is the "what is this person learning"
    signal the rest of the platform can build on later
- **client/** — Vite + vanilla JS frontend that renders pages, tokenizes German
  sentences, looks up glosses from the dictionary, and calls the API to record
  clicks/progress automatically (no manual save button).

Users are anonymous for now: the client generates a UUID on first visit and
stores it in `localStorage`, sent as `userId` on every API call. Swapping this
for real accounts later just means replacing that one ID with an authenticated
user id — the storage shape already supports it.

## Adding book content

Content is authored as plain text and imported into the JSON book format —
you don't hand-write per-word markup. See `server/content/laurie-saunders.txt`
for the format:

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

Import/update a book with:

```bash
cd server
node scripts/import-book.js content/<file>.txt
```

This (re)writes `data/books/<id>.json` and updates `data/books/index.json`.
Word-by-word glosses come from `data/dictionary.json` — add new words there as
you add books; any word not yet in the dictionary shows a "not yet translated"
placeholder in the UI instead of blocking the import.

## Running locally

```bash
npm install          # installs both workspaces
npm run dev:server    # http://localhost:4000
npm run dev:client    # http://localhost:5173 (proxies /api to the server)
```

Open http://localhost:5173.
