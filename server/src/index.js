import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { seedIfEmpty } from './seed.js';
import booksRouter from './routes/books.js';
import dictionaryRouter from './routes/dictionary.js';
import progressRouter from './routes/progress.js';
import wordClicksRouter from './routes/wordClicks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await seedIfEmpty();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/books', booksRouter);
app.use('/api/dictionary', dictionaryRouter);
app.use('/api/progress', progressRouter);
app.use('/api/word-clicks', wordClicksRouter);

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
