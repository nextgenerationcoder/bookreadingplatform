import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  requireAuth,
  cookieOptions,
  SESSION_COOKIE_NAME,
} from '../auth.js';

const router = Router();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

router.post('/signup', (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'a valid email is required' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'an account with that email already exists' });
  }

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    normalizedEmail,
    hashPassword(password),
    new Date().toISOString()
  );

  const { token, maxAge } = createSession(id);
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(maxAge));
  res.status(201).json({ id, email: normalizedEmail });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const { token, maxAge } = createSession(user.id);
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(maxAge));
  res.json({ id: user.id, email: user.email });
});

router.post('/logout', (req, res) => {
  deleteSession(req.cookies?.[SESSION_COOKIE_NAME]);
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

export default router;
