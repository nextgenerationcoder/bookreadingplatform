import express from 'express';
import cors from 'cors';
import booksRouter from './routes/books.js';
import dictionaryRouter from './routes/dictionary.js';
import progressRouter from './routes/progress.js';
import wordClicksRouter from './routes/wordClicks.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/books', booksRouter);
app.use('/api/dictionary', dictionaryRouter);
app.use('/api/progress', progressRouter);
app.use('/api/word-clicks', wordClicksRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => {
  console.log(`Book reading platform API listening on http://localhost:${PORT}`);
});
