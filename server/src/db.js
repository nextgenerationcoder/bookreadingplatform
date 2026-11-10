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

// Textbook import module (private interactive-exercise textbooks - distinct
// from the plain bilingual-reading books/pages/sentences tables above: those
// are sentence-by-sentence reading text, these are structured exercises with
// instructions, questions/options, images, audio and transcripts). Prefixed
// tb_ throughout so it never collides with the reading-book tables. See
// server/src/textbookImporter.js.
db.exec(`
  CREATE TABLE IF NOT EXISTS tb_books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    level TEXT,
    publisher TEXT,
    isbn TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tb_lessons (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES tb_books(id) ON DELETE CASCADE,
    lesson_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_page INTEGER,
    end_page INTEGER,
    UNIQUE (book_id, lesson_number)
  );

  CREATE TABLE IF NOT EXISTS tb_sections (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES tb_lessons(id) ON DELETE CASCADE,
    section_letter TEXT NOT NULL,
    title TEXT,
    order_index INTEGER NOT NULL,
    UNIQUE (lesson_id, section_letter)
  );

  -- One row per exercise (or sub-question, via sub_number). content_json and
  -- answer_key_json hold the type-specific shape (questions/options/passage
  -- text/grammar-table cells) rather than a rigid relational shape - exercise
  -- types vary too much (matching vs fill-blank vs reading comprehension) for
  -- one fixed set of columns, matching how interview_lessons/practice_courses
  -- already store their step shape as JSON elsewhere in this file.
  --
  -- Idempotency: the natural key (book_id, lesson_id, section_id,
  -- exercise_number, sub_number) is enforced unique below, and the importer
  -- always upserts on that key (see upsertExercise in textbookImporter.js) -
  -- re-running an import after a failure updates the same rows instead of
  -- duplicating them. section_id is part of the key (and NOT NULL, never
  -- left out of it) because this textbook restarts exercise numbering within
  -- each lettered section (A/B/C/D each have their own "1, 2, 3...") - without
  -- it, exercise "2" in one section silently overwrote exercise "2" in
  -- another (a real bug the Lesson 2 demo import caught). Exercises before
  -- the first lettered section (the lesson-opener warm-up) get an implicit
  -- synthetic section (see UNNUMBERED_SECTION_LETTER in textbookImporter.js)
  -- rather than a null section_id, specifically so they still collide (and
  -- correctly update, not duplicate) on retry instead of NULL making every
  -- such row look unique to SQLite's UNIQUE constraint.
  CREATE TABLE IF NOT EXISTS tb_exercises (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES tb_books(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL REFERENCES tb_lessons(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES tb_sections(id) ON DELETE CASCADE,
    exercise_number TEXT NOT NULL,
    sub_number TEXT NOT NULL DEFAULT '',
    printed_page INTEGER,
    pdf_page_index INTEGER,
    exercise_type TEXT NOT NULL,
    instructions TEXT,
    content_json TEXT NOT NULL,
    answer_key_json TEXT,
    answer_key_verified INTEGER NOT NULL DEFAULT 0,
    extraction_confidence REAL,
    extraction_source TEXT NOT NULL DEFAULT 'ai',
    needs_review INTEGER NOT NULL DEFAULT 1,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (book_id, lesson_id, section_id, exercise_number, sub_number)
  );

  -- file_path is relative to TB_MEDIA_DIR (see textbookImporter.js) - never a
  -- web-servable path; only GET /api/textbooks/media/:id (requireAuth) reads it.
  CREATE TABLE IF NOT EXISTS tb_exercise_images (
    id TEXT PRIMARY KEY,
    exercise_id TEXT NOT NULL REFERENCES tb_exercises(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    caption TEXT,
    order_index INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tb_audio_files (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES tb_books(id) ON DELETE CASCADE,
    lesson_id TEXT REFERENCES tb_lessons(id) ON DELETE SET NULL,
    original_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    track_label TEXT,
    created_at TEXT NOT NULL
  );

  -- Many-to-many on purpose: one audio file (e.g. a single listening passage)
  -- is routinely the source for several exercises in the book (3, 4 and 6 all
  -- sharing one recording is the normal case, not an edge case).
  CREATE TABLE IF NOT EXISTS tb_exercise_audio (
    exercise_id TEXT NOT NULL REFERENCES tb_exercises(id) ON DELETE CASCADE,
    audio_id TEXT NOT NULL REFERENCES tb_audio_files(id) ON DELETE CASCADE,
    PRIMARY KEY (exercise_id, audio_id)
  );

  -- speaker_segments_json: [{speaker, text}, ...] - preserves speaker labels
  -- exactly as printed in the transcript PDF; never a merged/paraphrased blob.
  CREATE TABLE IF NOT EXISTS tb_transcripts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES tb_books(id) ON DELETE CASCADE,
    lesson_id TEXT REFERENCES tb_lessons(id) ON DELETE SET NULL,
    audio_id TEXT REFERENCES tb_audio_files(id) ON DELETE SET NULL,
    exercise_label TEXT,
    speaker_segments_json TEXT NOT NULL,
    source_pdf TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tb_exercise_transcripts (
    exercise_id TEXT NOT NULL REFERENCES tb_exercises(id) ON DELETE CASCADE,
    transcript_id TEXT NOT NULL REFERENCES tb_transcripts(id) ON DELETE CASCADE,
    PRIMARY KEY (exercise_id, transcript_id)
  );

  -- Resumable/idempotent import jobs, mirroring pdf_import_jobs's pattern
  -- (see routes/books.js): source_files_json keeps the uploaded files' paths
  -- so a resumed job (after a server restart) doesn't need them re-uploaded.
  CREATE TABLE IF NOT EXISTS tb_import_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    lesson_number INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    stage TEXT,
    current_page INTEGER NOT NULL DEFAULT 0,
    total_pages INTEGER,
    exercises_found INTEGER NOT NULL DEFAULT 0,
    errors_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    source_files_json TEXT NOT NULL DEFAULT '{}',
    cancelled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tb_lessons_book ON tb_lessons(book_id);
  CREATE INDEX IF NOT EXISTS idx_tb_exercises_lesson ON tb_exercises(lesson_id);
  CREATE INDEX IF NOT EXISTS idx_tb_exercises_needs_review ON tb_exercises(needs_review);
  CREATE INDEX IF NOT EXISTS idx_tb_exercise_images_exercise ON tb_exercise_images(exercise_id);
  CREATE INDEX IF NOT EXISTS idx_tb_audio_files_lesson ON tb_audio_files(lesson_id);
  CREATE INDEX IF NOT EXISTS idx_tb_import_jobs_user ON tb_import_jobs(user_id);
`);
