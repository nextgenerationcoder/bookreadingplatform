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
const WORD_FREQUENCY_SEED = path.join(__dirname, '..', 'data', 'word-frequency.seed.json');
const GRAMMAR_LESSONS_SEED = path.join(__dirname, '..', 'data', 'grammar-lessons.seed.json');

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

// Bulk-fills word_frequency from a generated word-frequency list (see
// scripts/import-word-frequency.js) - shared across all accounts, not
// per-user, so this only ever needs to run once against an empty table
// rather than per-word INSERT OR IGNORE like the dictionary seeds above.
async function seedWordFrequency() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM word_frequency').get();
  if (count > 0) return;

  let raw;
  try {
    raw = await fs.readFile(WORD_FREQUENCY_SEED, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  // The source file is already sorted by frequency descending, so object
  // key order (preserved by JSON.parse for string keys) doubles as rank.
  const entries = Object.entries(JSON.parse(raw));
  const insert = db.prepare('INSERT OR IGNORE INTO word_frequency (word, rank, frequency) VALUES (?, ?, ?)');
  const tx = db.transaction(() => {
    entries.forEach(([word, frequency], i) => insert.run(word, i + 1, frequency));
  });
  tx();
  console.log(`Seeded ${entries.length} word-frequency entries.`);
}

// Unlike the other seed functions above, this one always runs (no "table
// already has data" early return) and upserts by id instead of plain
// INSERT - grammar_lessons is static reference content with no user-editable
// path anywhere in the app, so the seed file is the single source of truth
// and re-running it (e.g. after adding a new CEFR level's lessons to
// grammar-lessons.seed.json) should always bring the table in line with it,
// not silently no-op just because A1 was already seeded from an earlier
// deploy.
async function seedGrammarLessons() {
  let raw;
  try {
    raw = await fs.readFile(GRAMMAR_LESSONS_SEED, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const lessons = JSON.parse(raw);
  const upsert = db.prepare(`
    INSERT INTO grammar_lessons
      (id, level, order_index, topic, summary, explanation, rules_json, examples_json, common_mistakes_json, error_tags_json, book_reference, importance_rank)
    VALUES (@id, @level, @orderIndex, @topic, @summary, @explanation, @rules, @examples, @commonMistakes, @errorTags, @bookReference, @importanceRank)
    ON CONFLICT(id) DO UPDATE SET
      level = excluded.level,
      order_index = excluded.order_index,
      topic = excluded.topic,
      summary = excluded.summary,
      explanation = excluded.explanation,
      rules_json = excluded.rules_json,
      examples_json = excluded.examples_json,
      common_mistakes_json = excluded.common_mistakes_json,
      error_tags_json = excluded.error_tags_json,
      book_reference = excluded.book_reference,
      importance_rank = excluded.importance_rank
  `);
  const tx = db.transaction(() => {
    for (const lesson of lessons) {
      upsert.run({
        id: lesson.id,
        level: lesson.level,
        orderIndex: lesson.orderIndex,
        topic: lesson.topic,
        summary: lesson.summary,
        explanation: lesson.explanation,
        rules: JSON.stringify(lesson.rules),
        examples: JSON.stringify(lesson.examples),
        commonMistakes: JSON.stringify(lesson.commonMistakes),
        errorTags: JSON.stringify(lesson.errorTags),
        bookReference: lesson.bookReference || null,
        importanceRank: Number.isInteger(lesson.importanceRank) ? lesson.importanceRank : null,
      });
    }
  });
  tx();
  console.log(`Seeded/updated ${lessons.length} grammar lessons.`);
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

// One-time content cleanup, not a seed: the A1 "Speaking" course is being
// rebuilt lesson-by-lesson as interactive LessonPlayer content (same
// pattern as client/src/lessons/lesson1.js/lektion2.js, intercepted via
// main.js's INTERACTIVE_LESSONS map) instead of the old plain-reading
// pages (server/content/deutsch-almani-lektionen/lektion-{2..10}.txt,
// still on disk as reference material but no longer seeded/linked to
// anything). Deletes those old course rows outright (cascades to their
// pages/sentences) so the Courses grid doesn't show stale page counts for
// content nobody can actually reach anymore, then re-creates a fresh,
// contentless row for each Lektion that already has a new interactive
// version, so it reappears as a card. Runs unconditionally on every boot,
// not just against an empty database - a no-op once done, since the
// DELETE simply matches nothing on the next run.
const OLD_A1_LEKTIONEN_TO_REMOVE = [
  'deutsch-almani-lektion-2',
  'deutsch-almani-lektion-3',
  'deutsch-almani-lektion-4',
  'deutsch-almani-lektion-5',
  'deutsch-almani-lektion-6',
  'deutsch-almani-lektion-7',
  'deutsch-almani-lektion-8',
  'deutsch-almani-lektion-9',
  'deutsch-almani-lektion-10',
];
// Lektionen from the list above that already have a new interactive
// version (see main.js's INTERACTIVE_LESSONS) - re-added as an empty
// course row (title/level only) purely so they show up as a card again.
const REBUILT_A1_LEKTIONEN = [
  { id: 'deutsch-almani-lektion-2', title: 'Lektion 2 – Haben, Bringen, Brauchen und Zukunft' },
  { id: 'deutsch-almani-lektion-3', title: 'Lektion 3 – Wohin, Warten, Imperativ und Zukunft' },
  { id: 'deutsch-almani-lektion-4', title: 'Lektion 4 – Möchte, Gern, Wissen und Weil' },
  { id: 'deutsch-almani-lektion-5', title: 'Lektion 5 – Fragen, Reflexive Verben, Interesse und zu + Infinitiv' },
  { id: 'deutsch-almani-lektion-6', title: 'Lektion 6 – Telefonieren, Sprechen, Würde, Ob und Seit' },
  { id: 'deutsch-almani-lektion-7', title: 'Lektion 7 – Vergangenheit, Könnten, Dürfen und Lassen' },
];

function cleanupOldA1Lektionen() {
  const del = db.prepare('DELETE FROM courses WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO courses (id, level, title, source_lang, target_lang) VALUES (?, 'A1', ?, 'de', 'fa')
     ON CONFLICT(id) DO UPDATE SET title = excluded.title`
  );
  const tx = db.transaction(() => {
    for (const id of OLD_A1_LEKTIONEN_TO_REMOVE) del.run(id);
    for (const { id, title } of REBUILT_A1_LEKTIONEN) insert.run(id, title);
  });
  tx();
}

export async function seedIfEmpty() {
  await seedDictionary();
  await seedWikidict();
  await seedWordFrequency();
  await seedGrammarLessons();
  await seedBooks();
  cleanupOldA1Lektionen();
}
