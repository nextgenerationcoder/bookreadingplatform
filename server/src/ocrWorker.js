// Runs as its own child process (see tesseractOcr.js) so that tesseract.js
// internals - which can throw an uncaught error straight past normal
// try/catch on certain failures, e.g. a network error while lazily fetching
// language data - only ever crash this short-lived process, never the main
// server.
import { createWorker } from 'tesseract.js';
import { readFile } from 'node:fs/promises';

const filePath = process.argv[2];
const cachePath = process.argv[3];

function report(msg) {
  try {
    process.send(msg);
  } catch {
    // parent is gone; the non-zero exit code below is the fallback signal.
  }
}

process.on('uncaughtException', (err) => {
  report({ ok: false, error: err.message });
  process.exit(1);
});

async function main() {
  const buffer = await readFile(filePath);
  const worker = await createWorker('deu', 1, { cachePath });
  try {
    const { data } = await worker.recognize(buffer);
    report({ ok: true, text: data.text });
  } finally {
    await worker.terminate();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    report({ ok: false, error: err.message });
    process.exit(1);
  });
