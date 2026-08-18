import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT word, gloss FROM dictionary').all();
  const dict = Object.fromEntries(rows.map((r) => [r.word, r.gloss]));
  res.json(dict);
});

export default router;
