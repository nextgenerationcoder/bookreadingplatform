// Text ingestion format for "Interview" lessons - mirrors courseImporter.js's
// header+body approach, but the body is step blocks instead of page/sentence
// pairs, matching how LessonPlayer.js (client/src/components/LessonPlayer.js)
// already renders lessons (same `steps` shape as the static lesson files
// under client/src/lessons/*.js).
//
//   LESSON: tuv-nord-lektion-2
//   TITLE: TÜV NORD Interview – Teil 2
//   PROMPT_LANG: en                    (optional, "en" or "fa" - default "fa")
//
//   ### STEP
//   NOTE: optional grammar note, in PROMPT_LANG - shown as a hint under the prompt
//   WORD: german = translation         (repeatable - new vocab this step,
//                                        translation in PROMPT_LANG)
//   SAY: what the learner should produce, in PROMPT_LANG
//   ANSWER: the correct German sentence
//
//   ### STEP
//   WORD: german = translation
//   (no SAY:/ANSWER: - a teach-only step, just shows the word(s))
//
// PROMPT_LANG controls the language of everything shown to the learner for
// this lesson - SAY, NOTE, WORD's translation half, and the player's own UI
// text (buttons/instructions/feedback, see LessonPlayer.js's UI_STRINGS) -
// not just the SAY prompt. A German-Persian lesson (PROMPT_LANG: fa, or
// omitted) and a German-English lesson (PROMPT_LANG: en) each stay
// consistently one language throughout, never a mix.
//
// Deliberately close to the Teacher:/Say:/Student: dialogue style already
// used to draft lessons by hand (see the TÜV NORD Food GPT lesson) - WORD/
// NOTE/SAY/ANSWER are just that same content with explicit tags, so it
// parses deterministically instead of guessing at loosely-structured prose.

import { db } from './db.js';

const PROMPT_LANGS = ['en', 'fa'];

// Forgiving of markdown bold left over from drafting in a chat-style tool -
// stripped so it doesn't end up literally in the rendered lesson.
function stripMarkup(str) {
  return str.trim().replace(/\*\*/g, '').trim();
}

// Copying lesson text out of a chat UI or word processor and into the
// textarea often collapses real line breaks into plain spaces (this has
// bitten real drafts - a whole ~50-step lesson pasted as one paragraph).
// Since every tag this format recognizes is a unique, unambiguous token,
// reinsert a newline before each one wherever it shows up, so the
// line-based parser below works the same whether the source text kept its
// line breaks or not.
const TAG_TOKEN_RE = /(^|\s)(#{2,3}\s*STEP\b|LESSON:|TITLE:|PROMPT_LANG:|NOTE:|WORD:|SAY:|ANSWER:)/gi;
function reflowTags(text) {
  return text.replace(TAG_TOKEN_RE, (_match, _lead, tag) => `\n${tag}`);
}

export function parseInterviewLessonText(text) {
  const lines = reflowTags(text).split(/\r?\n/);
  let courseId = null;
  let title = null;
  let promptLang = 'fa';

  const steps = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const hasSay = current.say !== null;
    const hasAnswer = current.answer !== null;
    if (hasSay !== hasAnswer) {
      throw new Error(`Step ${steps.length + 1}: SAY and ANSWER must both be present, or both absent (teach-only step)`);
    }
    steps.push({
      id: steps.length + 1,
      software: current.words,
      promptFa: hasSay ? current.say : null,
      expectedAnswer: hasAnswer ? current.answer : null,
      ...(current.note ? { noteFa: current.note } : {}),
    });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^###\s*STEP$/i.test(line)) {
      pushCurrent();
      current = { words: [], say: null, answer: null, note: null };
      continue;
    }

    if (!current) {
      // Header section, before the first ### STEP.
      const lessonMatch = line.match(/^LESSON:\s*(.+)$/i);
      if (lessonMatch) {
        courseId = lessonMatch[1].trim();
        continue;
      }
      const titleMatch = line.match(/^TITLE:\s*(.+)$/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
        continue;
      }
      const promptLangMatch = line.match(/^PROMPT_LANG:\s*(\w+)$/i);
      if (promptLangMatch) {
        promptLang = promptLangMatch[1].trim().toLowerCase();
        continue;
      }
      throw new Error(`Unrecognized header line before the first "### STEP": "${rawLine}"`);
    }

    const wordMatch = line.match(/^WORD:\s*(.+?)\s*=\s*(.+)$/i);
    if (wordMatch) {
      current.words.push({ german: stripMarkup(wordMatch[1]), persian: stripMarkup(wordMatch[2]) });
      continue;
    }
    const noteMatch = line.match(/^NOTE:\s*(.+)$/i);
    if (noteMatch) {
      const note = stripMarkup(noteMatch[1]);
      current.note = current.note ? `${current.note} ${note}` : note;
      continue;
    }
    const sayMatch = line.match(/^SAY:\s*(.+)$/i);
    if (sayMatch) {
      current.say = stripMarkup(sayMatch[1]).replace(/^["“]|["”]$/g, '');
      continue;
    }
    const answerMatch = line.match(/^ANSWER:\s*(.+)$/i);
    if (answerMatch) {
      current.answer = stripMarkup(answerMatch[1]);
      continue;
    }
    throw new Error(`Unrecognized line inside a step: "${rawLine}"`);
  }
  pushCurrent();

  if (!courseId) throw new Error('Ingestion text is missing a LESSON: id');
  if (!PROMPT_LANGS.includes(promptLang)) {
    throw new Error(`PROMPT_LANG must be one of: ${PROMPT_LANGS.join(', ')}`);
  }
  if (!steps.length) throw new Error('Ingestion text has no "### STEP" blocks');

  return { courseId, title: title || courseId, promptLang, steps };
}

function lessonMeta(row) {
  if (!row) return null;
  const steps = JSON.parse(row.steps_json);
  return {
    courseId: row.course_id,
    title: row.title,
    promptLang: row.prompt_lang,
    stepCount: steps.length,
    updatedAt: row.updated_at,
  };
}

export function saveImportedInterviewLesson(lesson) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO interview_lessons (course_id, title, prompt_lang, steps_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(course_id) DO UPDATE SET
       title = excluded.title, prompt_lang = excluded.prompt_lang, steps_json = excluded.steps_json, updated_at = excluded.updated_at`
  ).run(lesson.courseId, lesson.title, lesson.promptLang, JSON.stringify(lesson.steps), now, now);
  return lessonMeta(db.prepare('SELECT * FROM interview_lessons WHERE course_id = ?').get(lesson.courseId));
}

export function listInterviewLessons() {
  const rows = db.prepare('SELECT * FROM interview_lessons ORDER BY created_at').all();
  return rows.map(lessonMeta);
}

export function getInterviewLesson(courseId) {
  const row = db.prepare('SELECT * FROM interview_lessons WHERE course_id = ?').get(courseId);
  if (!row) return null;
  return {
    id: row.course_id,
    courseId: row.course_id,
    title: row.title,
    promptLang: row.prompt_lang,
    steps: JSON.parse(row.steps_json),
  };
}

export function deleteInterviewLesson(courseId) {
  const result = db.prepare('DELETE FROM interview_lessons WHERE course_id = ?').run(courseId);
  if (result.changes === 0) throw new Error(`Interview lesson "${courseId}" not found`);
}
