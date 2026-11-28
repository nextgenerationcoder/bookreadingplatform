// On a brand-new (empty) database, loads the dictionary and book content
// that ship with the repo, so a fresh deployment isn't a blank app. Once the
// database has data, this is a no-op — it never overwrites anything a user
// has since edited (renamed a book, added pages, extended the dictionary).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { parseBookText, saveImportedBook } from './bookImporter.js';
import {
  createCourseFromHtml,
  addHtmlPageToCourse,
  setCoursePageAudio,
  setCoursePageShadowingAudio,
} from './courseImporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DICTIONARY = path.join(__dirname, '..', 'data', 'dictionary.seed.json');
const SEED_CONTENT_DIR = path.join(__dirname, '..', 'content');
const WIKIDICT_SEED = path.join(__dirname, '..', 'data', 'wikidict-de-fa.json');
const WORD_FREQUENCY_SEED = path.join(__dirname, '..', 'data', 'word-frequency.seed.json');
const GRAMMAR_LESSONS_SEED = path.join(__dirname, '..', 'data', 'grammar-lessons.seed.json');
const SPRECHEN_B1_TEIL1_DIR = path.join(__dirname, '..', 'content-courses', 'sprechen-b1-teil1');
const SPRECHEN_B1_AUDIO_DIR = path.join(SPRECHEN_B1_TEIL1_DIR, 'audio');
const HOEREN_B1_DIR = path.join(__dirname, '..', 'content-courses', 'hoeren-b1');

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
  { id: 'deutsch-almani-lektion-8', title: 'Lektion 8 – Trennbare Verben, Bewegung, Um ... zu und Dass' },
  { id: 'deutsch-almani-lektion-9', title: 'Lektion 9 – Du-Form, Perfekt, Noch und Vergangenheit' },
  { id: 'deutsch-almani-lektion-10', title: 'Lektion 10 – Perfekt, Reisen, Kommunikation und persönliche Angaben' },
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

// B1's four skill sections (Hören/Reden/Sprechen/Schreiben) are each their
// own course row, not a new taxonomy column - simplest fit for the
// existing courses/course_pages schema, and each shows up as its own card
// on the B1 course list. Guarded per-id (not just "table is empty" like
// seedBooks above) so re-running this after a user has edited one of these
// courses (renamed it, added/replaced pages) never overwrites that work -
// it only ever fills in whichever of the four doesn't exist yet.
const B1_SKILL_PLACEHOLDER_COURSES = [
  { id: 'b1-hoeren', title: 'Hören' },
  { id: 'b1-reden', title: 'Reden' },
  { id: 'b1-schreiben', title: 'Schreiben' },
];

function placeholderSkillHtml(title) {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · B1</title><style>body{background:#f0f6f7;color:#213841;font:16px/1.7 system-ui,Tahoma,sans-serif;max-width:650px;margin:auto;padding:40px 20px;text-align:center}h1{color:#075c70}</style></head><body><h1>${title}</h1><p>این بخش هنوز محتوایی ندارد - به‌زودی تکمیل می‌شود.</p></body></html>`;
}

async function seedB1SkillSections() {
  for (const { id, title } of B1_SKILL_PLACEHOLDER_COURSES) {
    const exists = db.prepare('SELECT 1 FROM courses WHERE id = ?').get(id);
    if (exists) continue;
    createCourseFromHtml({
      courseId: id,
      title,
      level: 'B1',
      lang: { source: 'de', target: 'fa' },
      pageNumber: 1,
      chapter: null,
      html: placeholderSkillHtml(title),
    });
    console.log(`Seeded B1 skill section "${title}" (${id}).`);
  }
}

// Sprechen Teil 1: 10 curated, self-contained HTML worksheets (one per
// exam topic, each with its own embedded clickable-word/translation/
// Struktur-pattern UI - see server/content-courses/sprechen-b1-teil1/ and
// its own REVIEW_FIRST10_FA.md for how they were curated) - one page per
// topic, in the exam booklet's own order, all under chapter "Teil 1".
// Guarded on the course id already existing (same reasoning as the
// placeholders above): never re-imports over a "b1-sprechen" a user has
// since edited.
const SPRECHEN_B1_TEIL1_TOPICS = [
  'auswanderung',
  'bio-essen',
  'computer-fur-jeden-kursraum',
  'computerspiele-sollte-man-computerspiele-spielen',
  'online-einkauf-einkaufen-im-internet',
  'einkaufszentrum-was-denken-sie-daruber',
  'englisch-soll-man-englisch-lernen',
  'extreme-sport-soll-man-extreme-sport-treiben',
  'fertiggerichte-fertigessen-fastfood',
  'mehrere-fremdsprachen-lernen',
];

async function seedSprechenB1Teil1() {
  const exists = db.prepare('SELECT 1 FROM courses WHERE id = ?').get('b1-sprechen');
  if (exists) return;

  let html;
  try {
    html = await fs.readFile(path.join(SPRECHEN_B1_TEIL1_DIR, `${SPRECHEN_B1_TEIL1_TOPICS[0]}.html`), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  createCourseFromHtml({
    courseId: 'b1-sprechen',
    title: 'Sprechen',
    level: 'B1',
    lang: { source: 'de', target: 'fa' },
    pageNumber: 1,
    chapter: 'Teil 1',
    html,
  });
  for (let i = 1; i < SPRECHEN_B1_TEIL1_TOPICS.length; i++) {
    const pageHtml = await fs.readFile(path.join(SPRECHEN_B1_TEIL1_DIR, `${SPRECHEN_B1_TEIL1_TOPICS[i]}.html`), 'utf-8');
    addHtmlPageToCourse('b1-sprechen', { pageNumber: i + 1, chapter: 'Teil 1', html: pageHtml });
  }
  console.log(`Seeded "Sprechen" (b1-sprechen) with ${SPRECHEN_B1_TEIL1_TOPICS.length} Teil 1 pages.`);
}

// Attaches a narration MP3 to any b1-sprechen page that doesn't have one
// yet (matching SPRECHEN_B1_TEIL1_TOPICS[pageNumber-1] to a file under
// SPRECHEN_B1_AUDIO_DIR) - not every topic has a recording, so a missing
// file is skipped, not an error. Unlike seedSprechenB1Teil1 above (gated
// on the course not existing yet, since it creates it), this runs
// whenever the course DOES exist and just fills in whichever pages are
// still missing audio - so it also reaches a b1-sprechen that was already
// seeded (without audio) by an earlier deploy, and picks up a later
// topic's recording the moment its .mp3 is added here, without needing to
// touch that topic's own HTML again.
async function seedSprechenB1Audio() {
  const course = db.prepare('SELECT 1 FROM courses WHERE id = ?').get('b1-sprechen');
  if (!course) return;

  for (let i = 0; i < SPRECHEN_B1_TEIL1_TOPICS.length; i++) {
    const pageNumber = i + 1;
    const page = db
      .prepare('SELECT (audio IS NOT NULL) AS has_audio FROM course_pages WHERE course_id = ? AND page_number = ?')
      .get('b1-sprechen', pageNumber);
    if (!page || page.has_audio) continue;

    let buffer;
    try {
      buffer = await fs.readFile(path.join(SPRECHEN_B1_AUDIO_DIR, `${SPRECHEN_B1_TEIL1_TOPICS[i]}.mp3`));
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    setCoursePageAudio('b1-sprechen', pageNumber, buffer);
    console.log(`Attached narration audio to b1-sprechen page ${pageNumber} (${SPRECHEN_B1_TEIL1_TOPICS[i]}).`);
  }
}

// Real Hören lessons (word-timing/chunk data baked straight into each
// page's own HTML as data-start/data-end attributes - see
// server/src/hoerenChunker.js - no separate DB column needed for that
// part). Unlike every other seed function here, these keep SYNCING their
// checked-in files on every boot (skipping a file once the DB already has
// it byte-for-byte) rather than seeding once and never touching it again -
// these lessons are still under active development (real bugs - doubled
// spacing, a stale concatenated-MP3 decode error - were already found and
// fixed after earlier deploys), so the checked-in files staying
// authoritative is more useful right now than the "never clobber a user's
// own edit" guarantee every other seed gives. Once a given lesson is
// stable, it should move to a seed-once guard like the rest, or risks
// being overwritten if someone edits it by hand in-app.
//
// `shadowingAudioFile` is optional and, when a lesson has no separate
// clean narration track (only the user's own pipeline's already-rendered
// Shadowing MP3 was provided for it - see Lektion 1's own comment where
// it's built), can be left unset: the lesson then uses `audioFile` for
// both normal playback AND Shadowing, same single track either way.
const HOEREN_B1_LESSONS = [
  { pageNumber: 1, chapter: 'Lektion 2', htmlFile: 'lektion2-aufgabe3.html', audioFile: 'lektion2-aufgabe3.mp3', shadowingAudioFile: 'lektion2-aufgabe3-shadowing.mp3' },
  { pageNumber: 2, chapter: 'Lektion 1', htmlFile: 'lektion1-aufgabe23.html', audioFile: 'lektion1-aufgabe23.mp3' },
];

async function seedHoerenB1Lessons() {
  if (!db.prepare("SELECT 1 FROM courses WHERE id = 'b1-hoeren'").get()) return; // seedB1SkillSections runs first and creates it

  for (const lesson of HOEREN_B1_LESSONS) {
    // A page this lesson hasn't been added for yet (e.g. a brand new
    // lesson number) gets created fresh here, not skipped - only the
    // COURSE itself needs to already exist, each individual page doesn't.
    const page = db
      .prepare('SELECT html, audio FROM course_pages WHERE course_id = ? AND page_number = ?')
      .get('b1-hoeren', lesson.pageNumber) || { html: null, audio: null };

    let html;
    try {
      html = await fs.readFile(path.join(HOEREN_B1_DIR, lesson.htmlFile), 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    // HTML and audio are checked independently (not "does the whole page
    // match") so trimming just one file re-syncs without needing an
    // unrelated change to the other too (this happened once already, for
    // Lektion 2's own audio - the first upload carried all 3 textbook
    // exercises, not only Aufgabe 3).
    if (page.html !== html) {
      addHtmlPageToCourse('b1-hoeren', { pageNumber: lesson.pageNumber, chapter: lesson.chapter, html });
      console.log(`Synced "Hören" (b1-hoeren) page ${lesson.pageNumber} HTML.`);
    }

    let audio = null;
    try {
      audio = await fs.readFile(path.join(HOEREN_B1_DIR, 'audio', lesson.audioFile));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (audio && (!page.audio || !audio.equals(page.audio))) {
      setCoursePageAudio('b1-hoeren', lesson.pageNumber, audio);
      console.log(`Synced "Hören" (b1-hoeren) page ${lesson.pageNumber} audio.`);
    }

    // The real, pre-rendered Shadowing-practice MP3 - built by the user's
    // own shadowing_pipeline.py (real silence + real time-stretched short
    // chunks baked in via ffmpeg) rather than computed here, so Shadowing
    // works without needing anyone's live Groq key. Falls back to the
    // normal narration file when a lesson has no separate one (see this
    // list's own comment above). Read fresh (not from the `page` snapshot
    // above) since setCoursePageAudio just now may have cleared this
    // column as a side effect of the narration sync right above.
    let shadowingAudio = null;
    try {
      shadowingAudio = await fs.readFile(path.join(HOEREN_B1_DIR, 'audio', lesson.shadowingAudioFile || lesson.audioFile));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (shadowingAudio) {
      const current = db
        .prepare('SELECT shadowing_audio FROM course_pages WHERE course_id = ? AND page_number = ?')
        .get('b1-hoeren', lesson.pageNumber);
      if (!current.shadowing_audio || !shadowingAudio.equals(current.shadowing_audio)) {
        setCoursePageShadowingAudio('b1-hoeren', lesson.pageNumber, shadowingAudio);
        console.log(`Synced "Hören" (b1-hoeren) page ${lesson.pageNumber} Shadowing-practice audio.`);
      }
    }
  }
}

export async function seedIfEmpty() {
  await seedDictionary();
  await seedWikidict();
  await seedWordFrequency();
  await seedGrammarLessons();
  await seedBooks();
  cleanupOldA1Lektionen();
  await seedB1SkillSections();
  await seedSprechenB1Teil1();
  await seedSprechenB1Audio();
  await seedHoerenB1Lessons();
}
