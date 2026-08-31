import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH lets deployments point at a mounted volume (e.g. Docker) so data
// survives container rebuilds; defaults to a local file for plain dev use.
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

await fs.mkdir(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    chapter TEXT,
    UNIQUE (book_id, page_number)
  );

  CREATE TABLE IF NOT EXISTS sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    num INTEGER NOT NULL,
    de TEXT NOT NULL,
    fa TEXT NOT NULL,
    chapter TEXT
  );

  CREATE TABLE IF NOT EXISTS dictionary (
    word TEXT PRIMARY KEY,
    gloss TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual'
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, book_id)
  );

  CREATE TABLE IF NOT EXISTS word_clicks (
    user_id TEXT NOT NULL,
    word TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    first_clicked_at TEXT NOT NULL,
    last_clicked_at TEXT NOT NULL,
    PRIMARY KEY (user_id, word)
  );

  CREATE TABLE IF NOT EXISTS word_click_books (
    user_id TEXT NOT NULL,
    word TEXT NOT NULL,
    book_id TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, word, book_id)
  );

  CREATE TABLE IF NOT EXISTS word_click_pages (
    user_id TEXT NOT NULL,
    word TEXT NOT NULL,
    book_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, word, book_id, page)
  );

  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    title TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS course_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    chapter TEXT,
    UNIQUE (course_id, page_number)
  );

  CREATE TABLE IF NOT EXISTS course_sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES course_pages(id) ON DELETE CASCADE,
    num INTEGER NOT NULL,
    de TEXT NOT NULL,
    fa TEXT NOT NULL,
    chapter TEXT
  );

  -- Tracks whole-book PDF import jobs so an in-progress import (which can
  -- take a long time - one AI call per page) survives a server restart:
  -- the uploaded PDF is split into 10-page chunk files on disk (pdf_path
  -- holds that chunk directory, not a single file - see pdfSplit.js) and
  -- progress is persisted here on every page, so a "running" job found at
  -- startup can be resumed from where it left off instead of being lost.
  CREATE TABLE IF NOT EXISTS pdf_import_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    title TEXT,
    chapter TEXT,
    start_page INTEGER NOT NULL,
    pdf_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    current_page INTEGER NOT NULL DEFAULT 0,
    total_pages INTEGER,
    pages_found INTEGER NOT NULL DEFAULT 0,
    errors_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );

  -- Interactive lesson courses (e.g. TÜV NORD interview prep) - a different
  -- shape from the books/courses tables above (which are static bilingual
  -- reading text): this is a stepped lesson player with per-account learner
  -- state that evolves according to the lesson-generator spec's promotion
  -- rules (see server/src/learningEngine/). One row per account+course.
  CREATE TABLE IF NOT EXISTS learner_course_state (
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    state_json TEXT NOT NULL,
    phase INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, course_id)
  );

  -- One row per account+course+lesson: current step, saved step responses,
  -- exit-check and retrieval-challenge results. status is 'in_progress' or
  -- 'completed' - a lesson is only 'completed' once its exit check has been
  -- attempted (see routes/learning.js), matching the spec's rule that a
  -- lesson's moves only promote to supported after real production, not
  -- just clicking through the steps.
  CREATE TABLE IF NOT EXISTS lesson_progress (
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    current_step_index INTEGER NOT NULL DEFAULT 0,
    step_responses_json TEXT NOT NULL DEFAULT '{}',
    exit_check_json TEXT,
    retrieval_challenge_json TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, course_id, lesson_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pages_book ON pages(book_id);
  CREATE INDEX IF NOT EXISTS idx_sentences_page ON sentences(page_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_course_pages_course ON course_pages(course_id);
  CREATE INDEX IF NOT EXISTS idx_course_sentences_page ON course_sentences(page_id);
  CREATE INDEX IF NOT EXISTS idx_courses_level ON courses(level);
`);

// CREATE TABLE IF NOT EXISTS doesn't add new columns to a table that already
// exists from before this column was introduced, so patch it in by hand.
const dictionaryColumns = db.prepare('PRAGMA table_info(dictionary)').all().map((c) => c.name);
if (!dictionaryColumns.includes('source')) {
  db.exec("ALTER TABLE dictionary ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
}

const pdfImportJobColumns = db.prepare('PRAGMA table_info(pdf_import_jobs)').all().map((c) => c.name);
if (!pdfImportJobColumns.includes('finished_at')) {
  db.exec('ALTER TABLE pdf_import_jobs ADD COLUMN finished_at TEXT');
}

const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('llm_provider')) {
  db.exec('ALTER TABLE users ADD COLUMN llm_provider TEXT');
}
if (!userColumns.includes('llm_api_key_enc')) {
  db.exec('ALTER TABLE users ADD COLUMN llm_api_key_enc TEXT');
}
if (!userColumns.includes('voice_id')) {
  db.exec('ALTER TABLE users ADD COLUMN voice_id TEXT');
}
if (!userColumns.includes('speech_rate')) {
  db.exec('ALTER TABLE users ADD COLUMN speech_rate REAL');
}
// Separate from llm_provider/llm_api_key_enc (the text/translation key,
// used by the PDF pipeline's translate step): a vision-capable key, used to
// read photos/scanned pages directly (photo batch upload, and OCR for PDF
// pages with no extractable text layer). Independent since the cheapest
// good text model (e.g. DeepSeek) often isn't vision-capable at all.
if (!userColumns.includes('vision_provider')) {
  db.exec('ALTER TABLE users ADD COLUMN vision_provider TEXT');
}
if (!userColumns.includes('vision_api_key_enc')) {
  db.exec('ALTER TABLE users ADD COLUMN vision_api_key_enc TEXT');
}
