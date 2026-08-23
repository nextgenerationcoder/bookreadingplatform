import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH lets deployments point at a mounted volume (e.g. Docker) so data
// survives container rebuilds; defaults to a local file for plain dev use.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

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
