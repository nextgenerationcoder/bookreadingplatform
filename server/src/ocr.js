import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, 'ocrWorker.js');
const TIMEOUT_MS = 60_000;

// Extracts German text from a photo of a book page. Runs tesseract.js in a
// dedicated child process (see ocrWorker.js) - never in-process - because
// its Node worker-thread can crash the whole process on certain failures in
// a way normal try/catch can't intercept, and this is a shared server, not
// a script. The German ("deu") language pack is fetched once on first use
// and cached under server/data/ocr-cache, so later calls are fully offline.
export async function ocrImage(buffer) {
  const tmpPath = path.join(tmpdir(), `ocr-${Date.now()}-${crypto.randomUUID()}.bin`);
  await writeFile(tmpPath, buffer);

  try {
    return await new Promise((resolve, reject) => {
      const child = fork(WORKER_SCRIPT, [tmpPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });

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
