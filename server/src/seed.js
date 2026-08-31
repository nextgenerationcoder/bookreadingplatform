// On a brand-new (empty) database, loads the dictionary and book content
// that ship with the repo, so a fresh deployment isn't a blank app. Once the
// database has data, this is a no-op — it never overwrites anything a user
// has since edited (renamed a book, added pages, extended the dictionary).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { parseBookText, saveImportedBook } from './bookImporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DICTIONARY = path.join(__dirname, '..', 'data', 'dictionary.seed.json');
const SEED_CONTENT_DIR = path.join(__dirname, '..', 'content');
const WIKIDICT_SEED = path.join(__dirname, '..', 'data', 'wikidict-de-fa.json');

async function seedDictionary() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM dictionary').get();
  if (count > 0) return;

  let raw;
  try {
    raw = await fs.readFile(SEED_DICTIONARY, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const entries = Object.entries(JSON.parse(raw));
  const insert = db.prepare('INSERT OR IGNORE INTO dictionary (word, gloss) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [word, gloss] of entries) insert.run(word, gloss);
  });
  tx();
  console.log(`Seeded dictionary with ${entries.length} entries.`);
}

// Bulk-fills the dictionary from wikidict-de (German<->Persian pairs derived
// from Wikipedia interwiki links, see server/data/wikidict-de-fa.json). This
// runs once regardless of whether the dictionary already has data — unlike
// seedDictionary() above — but INSERT OR IGNORE means it never touches a
// word that's already there, so hand-added and auto-translated entries always
// win. Guarded by a source check so the (large) file isn't re-read on every
// boot once it's been imported.
async function seedWikidict() {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM dictionary WHERE source = 'wikidict'")
    .get();
  if (count > 0) return;

  let raw;
  try {
    raw = await fs.readFile(WIKIDICT_SEED, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const entries = Object.entries(JSON.parse(raw));
  const insert = db.prepare("INSERT OR IGNORE INTO dictionary (word, gloss, source) VALUES (?, ?, 'wikidict')");
  const tx = db.transaction(() => {
    for (const [word, gloss] of entries) insert.run(word, gloss);
  });
  tx();
  console.log(`Backfilled ${entries.length} dictionary entries from wikidict-de.`);
}

async function seedBooks() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM books').get();
  if (count > 0) return;

  let files;
  try {
    files = await fs.readdir(SEED_CONTENT_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const file of files.filter((f) => f.endsWith('.txt'))) {
    const text = await fs.readFile(path.join(SEED_CONTENT_DIR, file), 'utf-8');
    const book = parseBookText(text);
    saveImportedBook(book);
    console.log(`Seeded book "${book.title}" (${book.id}) from ${file}.`);
  }
}

export async function seedIfEmpty() {
  await seedDictionary();
  await seedWikidict();
  await seedBooks();
}
