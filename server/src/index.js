import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { seedIfEmpty } from './seed.js';
import { requireAuth } from './auth.js';
import authRouter from './routes/auth.js';
import booksRouter, { resumePendingPdfJobs } from './routes/books.js';
import coursesRouter from './routes/courses.js';
import dictionaryRouter from './routes/dictionary.js';
import progressRouter from './routes/progress.js';
import wordClicksRouter from './routes/wordClicks.js';
import settingsRouter from './routes/settings.js';
import ocrRouter from './routes/ocr.js';
import ttsRouter from './routes/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A safety net, not a fix for any specific bug: without this, an error
// thrown inside a background job (like PDF import processing, which runs
// detached from any HTTP request) or any other unhandled rejection just
// vanishes - nothing crashes, nothing shows up anywhere, and whatever was
// running silently stops making progress. This at least guarantees it hits
// the logs (`docker compose logs -f app`) so a "nothing happened and I
// don't know why" report always has a paper trail.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

await seedIfEmpty();

const app = express();
const PORT = process.env.PORT || 4000;

// credentials:true is required for the session cookie to be sent/accepted
// cross-origin (the Vite dev server on :5173 talking to the API on :4000);
// in production client+server share an origin so this is a no-op there.
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);

// Everything below requires a logged-in user: books/dictionary content is
// shared across all accounts, but only visible to people who've signed in,
// and progress/word-clicks are scoped per-account inside their own routes.
app.use('/api/books', requireAuth, booksRouter);
app.use('/api/courses', requireAuth, coursesRouter);
app.use('/api/dictionary', requireAuth, dictionaryRouter);
app.use('/api/progress', requireAuth, progressRouter);
app.use('/api/word-clicks', requireAuth, wordClicksRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/ocr', requireAuth, ocrRouter);
app.use('/api/tts', requireAuth, ttsRouter);

// In production the client is built to client/dist and served by this same
// process, so the whole app is one container behind one port. In local dev
// the frontend runs separately via Vite (which proxies /api/* here instead),
// and this folder won't exist, so this block just does nothing.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => {
  console.log(`Book reading platform listening on http://localhost:${PORT}`);
});

// Resume any PDF import jobs that were still running when the process last
// stopped (redeploy, crash, restart) - after listen() so early requests
// aren't blocked on it.
resumePendingPdfJobs().catch((err) => console.error('Failed to resume pending PDF import jobs:', err));
