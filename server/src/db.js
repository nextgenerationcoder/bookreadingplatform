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

// A course page is either the original bilingual sentence-pair shape
// (course_sentences rows, html left NULL) or a self-contained HTML page
// (html set, no course_sentences rows) - the same "upload your own HTML"
// feature worksheets.js offers, reused here so a course page can have the
// same clickable-word/"Notiz"/"Extract pattern" interactivity. Stored
// inline rather than on disk (unlike worksheets): course content is shared,
// already DB-resident content like books/sentences, not a private per-user
// upload.
const coursePageColumns = db.prepare('PRAGMA table_info(course_pages)').all().map((c) => c.name);
if (!coursePageColumns.includes('html')) {
  db.exec('ALTER TABLE course_pages ADD COLUMN html TEXT');
}
// An optional narration track (MP3) for a page - independent of whether
// the page itself is HTML or sentence-pairs, though in practice only the
// Sprechen worksheets have one so far. Stored as a BLOB the same way
// html is stored inline rather than on disk, for the same reason (shared,
// seeded content, not a private per-user upload) - served with HTTP Range
// support (see routes/courses.js) so the player can seek without
// downloading the whole file first.
if (!coursePageColumns.includes('audio')) {
  db.exec('ALTER TABLE course_pages ADD COLUMN audio BLOB');
}
// Shadowing-mode chunk boundaries for the page's own audio (see
// shadowingChunker.js) - a JSON array of {start, end, text}, computed once
// by running the audio through Groq's word-timestamp transcription (an
// account's own BYO key, like the mic button already uses) the first time
// anyone opens shadowing mode for this page, then cached here so every
// later learner gets it for free instead of re-transcribing the same file.
if (!coursePageColumns.includes('shadowing_chunks')) {
  db.exec('ALTER TABLE course_pages ADD COLUMN shadowing_chunks TEXT');
}

// Freely-placed notes a learner adds anywhere in an HTML course page via
// right-click -> "Notiz" - same feature and same block_index/char_offset
// meaning as worksheet_notes (see that table's comment), just keyed by
// (course_id, page_number) instead of a worksheet id, since a course page
// gets replaced (deleted + re-inserted) by course_pages.id whenever its
// content changes, but its page_number stays stable.
db.exec(`
  CREATE TABLE IF NOT EXISTS course_page_notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    block_index INTEGER NOT NULL,
    char_offset INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_course_page_notes_page ON course_page_notes(course_id, page_number, user_id);
`);

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
// Speech-to-text provider for the LessonPlayer mic button. Groq is the only
// provider (see server/src/asr.js) and needs the account's own key in
// asr_api_key_enc; NULL means the mic button isn't usable yet.
if (!userColumns.includes('asr_provider')) {
  db.exec('ALTER TABLE users ADD COLUMN asr_provider TEXT');
}
if (!userColumns.includes('asr_api_key_enc')) {
  db.exec('ALTER TABLE users ADD COLUMN asr_api_key_enc TEXT');
}

db.exec(`
  -- Interview-style lessons imported via the text format in
  -- interviewLessonImporter.js (Settings-page-free "Interview" section,
  -- see routes/interviewLessons.js) - steps_json holds the same shape
  -- LessonPlayer.js already renders for the static lesson files
  -- (client/src/lessons/*.js), just fetched over the API instead of
  -- bundled at build time.
  CREATE TABLE IF NOT EXISTS interview_lessons (
    course_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt_lang TEXT NOT NULL DEFAULT 'fa',
    steps_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Per-account mastery tracking for words/phrases taught across any
  -- LessonPlayer-based lesson (A1 or Interview) - see routes/vocab.js.
  -- Identity is (user_id, german): the same word taught in two different
  -- lessons is one row, one streak, not tracked separately per lesson.
  CREATE TABLE IF NOT EXISTS vocab_progress (
    user_id TEXT NOT NULL,
    german TEXT NOT NULL,
    persian TEXT NOT NULL,
    times_seen INTEGER NOT NULL DEFAULT 0,
    times_correct_total INTEGER NOT NULL DEFAULT 0,
    correct_streak INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'learning',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    learned_at TEXT,
    PRIMARY KEY (user_id, german),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Grammar lessons (rules/examples/common mistakes for a CEFR level+topic),
  -- seeded from server/data/grammar-lessons.seed.json - see seed.js. Used in
  -- the Grammar tab under Courses (client/src/views/grammar.js), the
  -- explain-mistake feature's grammar-lesson links (routes/grammar.js's
  -- /by-tag endpoint, error_tags is the link between a mistake and a
  -- lesson), and as the ranked grammar targets fed into practiceCourse-
  -- Generator.js's course generation (importance_rank).
  CREATE TABLE IF NOT EXISTS grammar_lessons (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    topic TEXT NOT NULL,
    summary TEXT NOT NULL,
    explanation TEXT NOT NULL,
    rules_json TEXT NOT NULL,
    examples_json TEXT NOT NULL,
    common_mistakes_json TEXT NOT NULL,
    error_tags_json TEXT NOT NULL,
    book_reference TEXT,
    importance_rank INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_grammar_lessons_level ON grammar_lessons(level, order_index);

  -- A personalized practice course generated for one account (see
  -- server/src/practiceCourseGenerator.js and routes/practice.js) - a
  -- multi-lesson course in the same {lessonId, title, steps} shape
  -- LessonPlayer.js already renders (client/src/lessons/*.js,
  -- interview_lessons), just scoped to a single user and produced by an AI
  -- call using that user's own known/learning vocabulary + grammar targets
  -- instead of hand-authored. lessons_json holds the whole array of
  -- lessons; there is no per-lesson row because a course is regenerated as
  -- a unit, not edited lesson-by-lesson.
  CREATE TABLE IF NOT EXISTS practice_courses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    prompt_lang TEXT NOT NULL DEFAULT 'fa',
    lessons_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_practice_courses_user ON practice_courses(user_id);

  -- German word frequency, from a Leipzig Corpora Collection word list (see
  -- scripts/import-word-frequency.js) - shared across all accounts, not
  -- per-user. Not wired into any feature yet; this is just the raw data
  -- brought in so frequency-based features (e.g. prioritizing which words
  -- to check for passive knowledge) can be built on top of it later.
  CREATE TABLE IF NOT EXISTS word_frequency (
    word TEXT PRIMARY KEY,
    rank INTEGER NOT NULL,
    frequency INTEGER NOT NULL
  );
`);

// grammar_lessons is created above (in the same db.exec as the rest of this
// second block), so this patch must come after it, not alongside the other
// column patches earlier in the file (those run right after the FIRST
// db.exec, before this table exists on a brand-new database).
const grammarLessonColumns = db.prepare('PRAGMA table_info(grammar_lessons)').all().map((c) => c.name);
if (!grammarLessonColumns.includes('importance_rank')) {
  db.exec('ALTER TABLE grammar_lessons ADD COLUMN importance_rank INTEGER');
}

// Worksheets: a learner uploads a self-contained HTML page (made by hand or
// by an AI) and the app just shows it back to them, unmodified - no parsing
// into exercises, no shared content, private per account. The file itself
// lives on disk (see worksheets.js's WORKSHEETS_DIR), never under a
// publicly-served path - only GET /api/worksheets/:id/view (requireAuth,
// and only for the uploading account) ever reads it.
db.exec(`
  CREATE TABLE IF NOT EXISTS worksheets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_worksheets_user ON worksheets(user_id);
`);

// Freely-placed notes a learner adds anywhere in a worksheet via right-click
// -> "Notiz" (see client/src/views/worksheets.js's splitBlockAndInsertNote),
// not tied to any one question the way the baked-in "+ Notiz" boxes are.
// block_index identifies WHICH text block (p/li/td/... - the same "leaf
// text-bearing element" list computeBlocks() builds, in document order)
// this note splits, and char_offset is the character position within that
// block's full text content where the split happens (0 = right before the
// block's own text; the block's full length = right after it) - both
// computed fresh from the pristine, unmodified worksheet HTML every time it
// loads, which is what makes the position reproducible across sessions
// without storing anything about the DOM itself.
db.exec(`
  CREATE TABLE IF NOT EXISTS worksheet_notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    worksheet_id TEXT NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
    block_index INTEGER NOT NULL,
    char_offset INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_worksheet_notes_worksheet ON worksheet_notes(worksheet_id, user_id);
`);

// Office roleplay game (see docs/office-game.md) - Step 2, the minimal
// playable loop only (no XP/boss-opinion/vocab/exercises yet, see that
// doc's "Planned mechanics"). state_json carries whatever persists ACROSS
// turns (currently just a short running summary of the story, fed back to
// the AI as context instead of replaying the whole history every turn -
// see game/prompt.js); pending_json is the CURRENT scene+choices waiting
// for the player's pick - the client is only ever sent this, and only
// ever sends back a choice INDEX, never scene content, so there's no way
// for a client-side bug or a tampered request to inject story text. turn
// counts from 1. status is unused in Step 2 (always 'active') - reserved
// for the later "boss opinion reaches 0 -> fired -> game over" mechanic.
// "Neu anfangen" doesn't delete the old session, it just starts a new row -
// GET /api/game/current always resolves to the most recently created one.
db.exec(`
  CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    state_json TEXT NOT NULL,
    pending_json TEXT,
    turn INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id, created_at);

  -- Full turn history, one row per turn of a session - scene_json is that
  -- turn's own {outcome, scene, choices} (the same shape pending_json held
  -- while it was current), choice_index is which of the two the player
  -- picked (NULL until they choose, e.g. for the latest/current turn),
  -- and effects_json is reserved for the later numeric-mechanics tasks
  -- (XP/boss-opinion deltas this turn caused) - NULL in Step 2.
  CREATE TABLE IF NOT EXISTS game_turns (
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    turn INTEGER NOT NULL,
    scene_json TEXT NOT NULL,
    choice_index INTEGER,
    effects_json TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, turn)
  );

  -- One row per request to an AI-calling game route (see game/rateLimit.js) -
  -- purely a sliding-window rate-limit counter, not a usage/history log.
  -- Rows older than the window are deleted by the limiter itself on every
  -- check, so this table never grows past "recent calls per active user".
  CREATE TABLE IF NOT EXISTS game_ai_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    called_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_game_ai_calls_user ON game_ai_calls(user_id, called_at);
`);

// game_sessions already existed in production before this column was added
// (unlike game_ai_calls above, a brand-new table) - same ALTER-if-missing
// pattern as every other column patch in this file. Counts CONSECUTIVE AI
// call failures for this session (see game/ai.js's runGameTurnWithFallback);
// reset to 0 on any successful turn, real or recovered-via-fallback.
const gameSessionColumns = db.prepare('PRAGMA table_info(game_sessions)').all().map((c) => c.name);
if (!gameSessionColumns.includes('ai_failure_count')) {
  db.exec('ALTER TABLE game_sessions ADD COLUMN ai_failure_count INTEGER NOT NULL DEFAULT 0');
}
