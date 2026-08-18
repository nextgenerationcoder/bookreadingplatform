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
  await seedBooks();
}
