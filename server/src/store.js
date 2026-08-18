import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');

// Per-file write queues so concurrent writes to the same JSON file never interleave.
const writeQueues = new Map();

function queueWrite(filePath, task) {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(task, task);
  writeQueues.set(filePath, next.catch(() => {}));
  return next;
}

export async function readJson(relPath, fallback) {
  const filePath = path.join(DATA_DIR, relPath);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJson(relPath, data) {
  const filePath = path.join(DATA_DIR, relPath);
  return queueWrite(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  });
}

// Read-modify-write helper that serializes on the same write queue, so callers
// don't lose updates to a counter/object under concurrent requests.
export async function updateJson(relPath, fallback, mutator) {
  const filePath = path.join(DATA_DIR, relPath);
  return queueWrite(filePath, async () => {
    let current;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      current = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      current = fallback;
    }
    const updated = mutator(current);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
    return updated;
  });
}
