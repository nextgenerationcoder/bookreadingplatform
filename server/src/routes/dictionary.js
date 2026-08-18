import { Router } from 'express';
import { readJson } from '../store.js';

const router = Router();

router.get('/', async (_req, res) => {
  const dict = await readJson('dictionary.json', {});
  res.json(dict);
});

export default router;
