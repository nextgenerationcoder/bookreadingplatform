// Free, local OCR fallback for scanned PDF pages (no vision API key
// needed) - runs Tesseract in a dedicated child process (see ocrWorker.js).
// The German ("deu") language pack is fetched once on first use and cached
// under the DB's persisted volume, so later calls are fully offline.

import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, 'ocrWorker.js');
const TIMEOUT_MS = 90_000;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
const CACHE_PATH = path.join(path.dirname(DB_PATH), 'ocr-cache');

export async function ocrImageBuffer(buffer) {
  await mkdir(CACHE_PATH, { recursive: true });
  const tmpPath = path.join(tmpdir(), `pdf-ocr-${Date.now()}-${crypto.randomUUID()}.png`);
  await writeFile(tmpPath, buffer);

  try {
    return await new Promise((resolve, reject) => {
      const child = fork(WORKER_SCRIPT, [tmpPath, CACHE_PATH], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('OCR timed out'));
      }, TIMEOUT_MS);

      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn(arg);
      };

      child.on('message', (msg) => {
        finish(msg.ok ? resolve : reject, msg.ok ? msg.text : new Error(msg.error || 'OCR failed'));
      });
      child.on('error', (err) => finish(reject, err));
      child.on('exit', (code) => {
        if (code !== 0) finish(reject, new Error('OCR process exited unexpectedly'));
      });
    });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
