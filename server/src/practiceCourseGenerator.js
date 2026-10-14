// Generates a personalized practice course for one account, following the
// german-course-generator skill (server/data/practice-course-generator-
// skill.md): known material -> one new element -> active recall ->
// expansion -> combination -> transfer -> later review. The skill is a
// prompt, not app logic - this module's job is everything around that
// call: gathering the learner's real data into the input shape the skill
// expects, running the AI call (see llm.js's generatePracticeCourse), and
// converting its output into the same {software, promptFa, expectedAnswer,
// noteFa} step shape LessonPlayer.js already renders for every other
// lesson in the app, so no new player UI was needed.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { generatePracticeCourse } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.join(__dirname, '..', 'data', 'practice-course-generator-skill.md');

let cachedSkillText = null;
async function loadSkillText() {
  if (cachedSkillText) return cachedSkillText;
  cachedSkillText = await fs.readFile(SKILL_PATH, 'utf-8');
  return cachedSkillText;
}

async function buildSystemPrompt() {
  const skillText = await loadSkillText();
  return [
    skillText,
    '',
    '---',
    '',
    'You will receive the learner input described above as a single JSON object in the user message.',
    'Respond with ONLY the course JSON object described in "Required Course JSON Output" - no markdown',
    'fences, no commentary before or after it. The response must be valid JSON.',
  ].join('\n');
}

// Keeps a first-generation course small enough to reliably fit within one
// AI response (see llm.js's COURSE_MAX_TOKENS) - a learner can always
// generate another course once this one is done.
const DEFAULT_SETTINGS = {
  prompt_lang: 'fa',
  target_language: 'de',
  learner_native_language: 'fa',
  lesson_count: 5,
  max_new_words_per_lesson: 5,
  max_primary_grammar_targets_per_lesson: 1,
  steps_per_lesson: 14,
};

function buildLearnerInput(userId, courseId, title) {
  const knownRows = db
    .prepare(
      `SELECT vp.german, vp.persian, wf.rank AS frequency_rank
       FROM vocab_progress vp
       LEFT JOIN word_frequency wf ON wf.word = vp.german
       WHERE vp.user_id = ? AND vp.status IN ('learned', 'passive')`
    )
    .all(userId);
  const learningRows = db
    .prepare(
      `SELECT vp.german, vp.persian, wf.rank AS frequency_rank
       FROM vocab_progress vp
       LEFT JOIN word_frequency wf ON wf.word = vp.german
       WHERE vp.user_id = ? AND vp.status = 'learning'`
    )
    .all(userId);
  const grammarRows = db
    .prepare(
      `SELECT id, topic, level, COALESCE(importance_rank, 9000 + order_index) AS importance_rank
       FROM grammar_lessons
       ORDER BY importance_rank ASC`
    )
    .all();

  const toWord = (r) => {
    const word = { german: r.german, translation: r.persian };
    if (Number.isInteger(r.frequency_rank)) word.frequency_rank = r.frequency_rank;
    return word;
  };

  return {
    known_words: knownRows.map(toWord),
    learning_words: learningRows.map(toWord),
    grammar: grammarRows.map((g) => ({
      id: g.id,
      name: g.topic,
      cefr: g.level,
      importance_rank: g.importance_rank,
    })),
    settings: { ...DEFAULT_SETTINGS, course_id: courseId, title },
  };
}

function isValidVocabStep(step) {
  return Array.isArray(step.words) && step.words.length > 0 && !step.say && !step.answer;
}

function isValidPracticeStep(step) {
  return typeof step.say === 'string' && step.say.trim() && typeof step.answer === 'string' && step.answer.trim();
}

function convertWords(words) {
  return (Array.isArray(words) ? words : [])
    .filter((w) => w && typeof w.german === 'string' && w.german.trim() && typeof w.translation === 'string' && w.translation.trim())
    .map((w) => ({ german: w.german.trim(), persian: w.translation.trim() }));
}

// Converts one raw generated step into LessonPlayer's step shape, or null
// if it doesn't match either valid step type (see the skill's "Step Types"
// section) - dropped rather than failing the whole course over one
// malformed step from the AI.
function convertStep(rawStep) {
  if (!rawStep || typeof rawStep !== 'object') return null;
  const software = convertWords(rawStep.words);
  if (isValidPracticeStep(rawStep)) {
    return { software, promptFa: rawStep.say.trim(), expectedAnswer: rawStep.answer.trim(), noteFa: rawStep.note || null };
  }
  if (isValidVocabStep(rawStep) && software.length) {
    return { software, promptFa: null, expectedAnswer: null, noteFa: rawStep.note || null };
  }
  return null;
}

function convertCourse(raw) {
  if (!raw || !Array.isArray(raw.lessons)) {
    throw new Error('AI response was not in the expected {lessons: [...]} shape');
  }
  const lessons = raw.lessons
    .map((lesson, i) => {
      const steps = (Array.isArray(lesson?.steps) ? lesson.steps : []).map(convertStep).filter(Boolean);
      if (!steps.length) return null;
      return {
        lessonId: typeof lesson.lesson_id === 'string' && lesson.lesson_id.trim() ? lesson.lesson_id.trim() : `lesson-${i + 1}`,
        title: typeof lesson.title === 'string' && lesson.title.trim() ? lesson.title.trim() : `Lesson ${i + 1}`,
        cefrFocus: Array.isArray(lesson.cefr_focus) ? lesson.cefr_focus : [],
        steps,
      };
    })
    .filter(Boolean);

  if (!lessons.length) {
    throw new Error('AI response had no usable lessons after validation');
  }
  return lessons;
}

// Generates and saves a new practice course for this account. Throws on
// AI/network failure or an unusable response - the route handler turns
// that into a clean error for the client rather than saving a broken
// course.
export async function generatePracticeCourseForUser({ userId, provider, apiKey, title }) {
  const courseId = randomUUID();
  const courseTitle = title?.trim() || 'My Practice Course';
  const learnerInput = buildLearnerInput(userId, courseId, courseTitle);
  const systemPrompt = await buildSystemPrompt();

  const raw = await generatePracticeCourse({ provider, apiKey, systemPrompt, learnerInput });
  const lessons = convertCourse(raw);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO practice_courses (id, user_id, title, prompt_lang, lessons_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(courseId, userId, courseTitle, learnerInput.settings.prompt_lang, JSON.stringify(lessons), now, now);

  return { id: courseId, title: courseTitle, promptLang: learnerInput.settings.prompt_lang, lessonCount: lessons.length, createdAt: now };
}

export function listPracticeCoursesForUser(userId) {
  const rows = db
    .prepare('SELECT id, title, prompt_lang, lessons_json, created_at FROM practice_courses WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    promptLang: r.prompt_lang,
    lessonCount: JSON.parse(r.lessons_json).length,
    createdAt: r.created_at,
  }));
}

export function getPracticeCourseForUser(userId, courseId) {
  const row = db.prepare('SELECT * FROM practice_courses WHERE id = ? AND user_id = ?').get(courseId, userId);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    promptLang: row.prompt_lang,
    lessons: JSON.parse(row.lessons_json),
    createdAt: row.created_at,
  };
}
