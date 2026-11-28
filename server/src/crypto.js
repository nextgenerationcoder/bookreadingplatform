import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lives next to the database file (same DB_PATH-controlled directory, e.g.
// the mounted Docker volume in production) rather than a path hardcoded to
// the source tree - otherwise a container rebuild would regenerate this key
// on a fresh, non-persisted filesystem and permanently break decryption of
// every previously-saved secret.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
const KEY_FILE = path.join(path.dirname(DB_PATH), '.encryption-key');

// Encrypts sensitive per-account settings (currently: a personal AI API key)
// before they're stored in the database, so a leaked DB file alone isn't
// enough to read them back out - and since decryption always happens
// server-side keyed off req.userId, one account's key is never reachable
// from another account's requests.
//
// The key comes from ENCRYPTION_KEY if set (recommended for production, and
// required if you ever restore a DB backup onto a different host and expect
// existing keys to keep decrypting). Otherwise a random key is generated
// once and persisted next to the database, so it survives restarts but is
// unique to this deployment.
async function loadOrCreateKey() {
  if (process.env.ENCRYPTION_KEY) {
    return crypto.scryptSync(process.env.ENCRYPTION_KEY, 'book-platform-salt', 32);
  }
  try {
    const hex = await fs.readFile(KEY_FILE, 'utf-8');
    return Buffer.from(hex.trim(), 'hex');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const key = crypto.randomBytes(32);
  await fs.mkdir(path.dirname(KEY_FILE), { recursive: true });
  await fs.writeFile(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

let keyPromise = null;
function getKey() {
  if (!keyPromise) keyPromise = loadOrCreateKey();
  return keyPromise;
}

export async function encrypt(plaintext) {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export async function decrypt(encoded) {
  const key = await getKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}
