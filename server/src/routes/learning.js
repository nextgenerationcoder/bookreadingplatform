// Interactive lesson courses (TÜV NORD interview prep). Distinct from
// routes/books.js and routes/courses.js, which serve static bilingual
// reading text - this is a stepped lesson player with per-account learner
// state that evolves per learningEngine/stateTransition.js.

import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { db, DB_PATH } from '../db.js';
import { course, COURSE_ID, getLessonContent } from '../content/tuvNordInterview/course.js';
import { defaultLearnerState, loadLearnerState } from '../learningEngine/learnerState.js';
import { applyLessonStateUpdate } from '../learningEngine/stateTransition.js';
import { computeLessonStatuses } from '../learningEngine/lessonProgress.js';

const router = Router();

const RECORDINGS_DIR = path.join(path.dirname(DB_PATH), 'recordings');
await fs.mkdir(RECORDINGS_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function getLearnerState(userId, courseId) {
  const row = db.prepare('SELECT * FROM learner_course_state WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  return loadLearnerState(row);
}

function saveLearnerState(userId, courseId, state) {
  const { phase, ...rest } = state;
  db.prepare(
    `INSERT INTO learner_course_state (user_id, course_id, state_json, phase, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_id) DO UPDATE SET state_json = excluded.state_json, phase = excluded.phase, updated_at = excluded.updated_at`
  ).run(userId, courseId, JSON.stringify(rest), phase, new Date().toISOString());
}

function getProgressRow(userId, courseId, lessonId) {
  return db
    .prepare('SELECT * FROM lesson_progress WHERE user_id = ? AND course_id = ? AND lesson_id = ?')
    .get(userId, courseId, lessonId);
}

function getAllProgressRows(userId, courseId) {
  return db.prepare('SELECT * FROM lesson_progress WHERE user_id = ? AND course_id = ?').all(userId, courseId);
}

function upsertProgress(userId, courseId, lessonId, patch) {
  const existing = getProgressRow(userId, courseId, lessonId);
  const now = new Date().toISOString();
  const merged = {
    status: patch.status ?? existing?.status ?? 'in_progress',
    current_step_index: patch.currentStepIndex ?? existing?.current_step_index ?? 0,
    step_responses_json: patch.stepResponsesJson ?? existing?.step_responses_json ?? '{}',
    exit_check_json: patch.exitCheckJson ?? existing?.exit_check_json ?? null,
    retrieval_challenge_json: patch.retrievalChallengeJson ?? existing?.retrieval_challenge_json ?? null,
    completed_at: patch.completedAt ?? existing?.completed_at ?? null,
  };
  db.prepare(
    `INSERT INTO lesson_progress
       (user_id, course_id, lesson_id, status, current_step_index, step_responses_json, exit_check_json, retrieval_challenge_json, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_id, lesson_id) DO UPDATE SET
       status = excluded.status,
       current_step_index = excluded.current_step_index,
       step_responses_json = excluded.step_responses_json,
       exit_check_json = excluded.exit_check_json,
       retrieval_challenge_json = excluded.retrieval_challenge_json,
       completed_at = excluded.completed_at,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    courseId,
    lessonId,
    merged.status,
    merged.current_step_index,
    merged.step_responses_json,
    merged.exit_check_json,
    merged.retrieval_challenge_json,
    merged.completed_at,
    now
  );
  return getProgressRow(userId, courseId, lessonId);
}

// GET /api/learning/courses — course cards for the learning section.
router.get('/courses', (req, res) => {
  const state = getLearnerState(req.userId, COURSE_ID);
  const progressRows = getAllProgressRows(req.userId, COURSE_ID);
  const completedCount = progressRows.filter((r) => r.status === 'completed').length;
  res.json([
    {
      id: course.id,
      title: course.title,
      subtitle: course.subtitle,
      description: course.description,
      lessonCount: course.lessonCount,
      phaseCount: course.phaseCount,
      speakingFocused: course.speakingFocused,
      phase: state.phase,
      lessonsCompleted: completedCount,
    },
  ]);
});

// GET /api/learning/courses/:courseId — overview with per-lesson lock state.
router.get('/courses/:courseId', (req, res) => {
  if (req.params.courseId !== COURSE_ID) return res.status(404).json({ error: 'course not found' });
  const progressRows = getAllProgressRows(req.userId, COURSE_ID);
  const state = getLearnerState(req.userId, COURSE_ID);
  const lessons = computeLessonStatuses(course.lessons, progressRows);
  res.json({
    id: course.id,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    phases: course.phases,
    lessons,
    learnerPhase: state.phase,
  });
});

// GET /api/learning/courses/:courseId/lessons/:lessonId — lesson content +
// this account's saved progress, for the player to render/resume from.
router.get('/courses/:courseId/lessons/:lessonId', (req, res) => {
  if (req.params.courseId !== COURSE_ID) return res.status(404).json({ error: 'course not found' });
  const { lessonId } = req.params;
  const progressRows = getAllProgressRows(req.userId, COURSE_ID);
  const [status] = computeLessonStatuses(course.lessons, progressRows).filter((l) => l.id === lessonId);
  if (!status) return res.status(404).json({ error: 'lesson not found' });
  if (status.status === 'locked') return res.status(403).json({ error: 'lesson is locked - complete its prerequisites first' });

  const content = getLessonContent(lessonId);
  if (!content) return res.status(404).json({ error: 'lesson content not available yet' });

  const progressRow = getProgressRow(req.userId, COURSE_ID, lessonId);
  res.json({
    lesson: content,
    progress: {
      status: progressRow?.status || 'not_started',
      currentStepIndex: progressRow?.current_step_index || 0,
      stepResponses: progressRow ? JSON.parse(progressRow.step_responses_json) : {},
      exitCheck: progressRow?.exit_check_json ? JSON.parse(progressRow.exit_check_json) : null,
      retrievalChallenge: progressRow?.retrieval_challenge_json ? JSON.parse(progressRow.retrieval_challenge_json) : null,
    },
  });
});

// POST /api/learning/courses/:courseId/lessons/:lessonId/progress
// { stepIndex, stepId, response } — saves one step's response and/or
// advances the current step. Cannot itself mark a lesson "completed" -
// that only happens via the exit-check endpoint below, since completion
// requires real production, not just clicking through steps.
router.post('/courses/:courseId/lessons/:lessonId/progress', (req, res) => {
  if (req.params.courseId !== COURSE_ID) return res.status(404).json({ error: 'course not found' });
  const { lessonId } = req.params;
  if (!getLessonContent(lessonId)) return res.status(404).json({ error: 'lesson content not available yet' });

  const { stepIndex, stepId, response } = req.body || {};
  if (!Number.isFinite(stepIndex)) return res.status(400).json({ error: 'stepIndex must be a number' });

  const existing = getProgressRow(req.userId, COURSE_ID, lessonId);
  const responses = existing ? JSON.parse(existing.step_responses_json) : {};
  if (stepId && response !== undefined) responses[stepId] = response;

  const row = upsertProgress(req.userId, COURSE_ID, lessonId, {
    currentStepIndex: stepIndex,
    stepResponsesJson: JSON.stringify(responses),
    status: existing?.status === 'completed' ? 'completed' : 'in_progress',
  });
  res.json({ ok: true, currentStepIndex: row.current_step_index });
});

// POST /api/learning/courses/:courseId/lessons/:lessonId/exit-check
// { responses: [{ promptId, selfRating, hasRecording, durationMs }] }
// Marks the lesson completed (all three prompts attempted is the
// completion bar) and applies the lesson's declared state promotions.
router.post('/courses/:courseId/lessons/:lessonId/exit-check', (req, res) => {
  if (req.params.courseId !== COURSE_ID) return res.status(404).json({ error: 'course not found' });
  const { lessonId } = req.params;
  const content = getLessonContent(lessonId);
  if (!content) return res.status(404).json({ error: 'lesson content not available yet' });

  const { responses } = req.body || {};
  if (!Array.isArray(responses) || !responses.length) {
    return res.status(400).json({ error: 'responses is required' });
  }
  const requiredPromptIds = content.exitCheck.prompts.map((p) => p.id);
  const attemptedIds = new Set(responses.map((r) => r.promptId));
  const allAttempted = requiredPromptIds.every((id) => attemptedIds.has(id));
  const status = responses.every((r) => r.selfRating !== 'Noch schwierig') ? 'self_passed' : 'needs_review';

  const exitCheckResult = { responses, status, attemptedAt: new Date().toISOString(), allAttempted };

  upsertProgress(req.userId, COURSE_ID, lessonId, {
    exitCheckJson: JSON.stringify(exitCheckResult),
    status: allAttempted ? 'completed' : 'in_progress',
    completedAt: allAttempted ? new Date().toISOString() : null,
  });

  let state = getLearnerState(req.userId, COURSE_ID);
  state = applyLessonStateUpdate(state, content, { exitCheckAttempted: allAttempted });
  saveLearnerState(req.userId, COURSE_ID, state);

  res.json({ ok: true, exitCheck: exitCheckResult, learnerState: state });
});

// POST /api/learning/courses/:courseId/lessons/:lessonId/retrieval
// { responses: [{ promptId, elapsedMs, repeated }] } — records timing per
// cue and flags anything over the slow threshold as review_due. Does not
// itself promote anything in learner state (spec: recycling/review debt is
// tracked, not auto-resolved by this MVP UI).
router.post('/courses/:courseId/lessons/:lessonId/retrieval', (req, res) => {
  if (req.params.courseId !== COURSE_ID) return res.status(404).json({ error: 'course not found' });
  const { lessonId } = req.params;
  const content = getLessonContent(lessonId);
  if (!content) return res.status(404).json({ error: 'lesson content not available yet' });

  const { responses } = req.body || {};
  if (!Array.isArray(responses) || !responses.length) {
    return res.status(400).json({ error: 'responses is required' });
  }
  const thresholdMs = content.retrievalChallenge.slowThresholdSeconds * 1000;
  const scored = responses.map((r) => ({
    ...r,
    reviewDue: !r.repeated && (r.elapsedMs == null || r.elapsedMs > thresholdMs),
  }));
  const result = { responses: scored, attemptedAt: new Date().toISOString() };

  upsertProgress(req.userId, COURSE_ID, lessonId, { retrievalChallengeJson: JSON.stringify(result) });
  res.json({ ok: true, retrievalChallenge: result });
});

// POST /api/learning/recordings (multipart "audio") — stores a short
// learner recording and returns its id for later replay. There is no
// speech-to-text/evaluation here (none exists in this app) - this is
// storage + replay only, as the MVP scope explicitly requires.
router.post('/recordings', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'an audio file is required' });
  const userDir = path.join(RECORDINGS_DIR, req.userId);
  await fs.mkdir(userDir, { recursive: true });
  const ext = req.file.mimetype?.includes('mp4') ? 'mp4' : req.file.mimetype?.includes('wav') ? 'wav' : 'webm';
  const recordingId = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(userDir, recordingId), req.file.buffer);
  res.status(201).json({ recordingId, mimeType: req.file.mimetype });
});

// GET /api/learning/recordings/:recordingId — replay. recordingId embeds
// its own extension; ownership is enforced by only ever looking inside
// this account's own recordings directory.
router.get('/recordings/:recordingId', async (req, res) => {
  const recordingId = req.params.recordingId;
  if (!/^[a-f0-9-]+\.(webm|mp4|wav)$/i.test(recordingId)) {
    return res.status(400).json({ error: 'invalid recording id' });
  }
  const filePath = path.join(RECORDINGS_DIR, req.userId, recordingId);
  try {
    const buffer = await fs.readFile(filePath);
    const ext = recordingId.split('.').pop();
    const mimeType = ext === 'mp4' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : 'audio/webm';
    res.setHeader('Content-Type', mimeType);
    res.send(buffer);
  } catch {
    res.status(404).json({ error: 'recording not found' });
  }
});

export default router;
