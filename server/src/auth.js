// Password hashing uses Node's built-in scrypt (no extra native dependency
// to compile - avoids repeating the better-sqlite3 native-build pain for
// something as simple as password hashing).

import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const suppliedBuffer = crypto.scryptSync(password, salt, 64);
  return hashBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now.toISOString(),
    expiresAt.toISOString()
  );
  return { token, expiresAt, maxAge: SESSION_TTL_MS };
}

export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.email AS email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    deleteSession(token);
    return null;
  }
  return { id: row.userId, email: row.email };
}

export function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function requireAuth(req, res, next) {
  const user = getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) return res.status(401).json({ error: 'not authenticated' });
  req.user = user;
  req.userId = user.id;
  next();
}
