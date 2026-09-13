// Text-to-speech via Piper (github.com/OHF-voice/piper1-gpl), installed as
// the "piper-tts" PyPI package (see Dockerfile) and driven here as a child
// process - CPU-only, real-time, no external API or per-request cost.
//
// Piper's CLI doesn't expose true phoneme-level word timestamps, so word
// boundaries for the "bold the word being read" UI are *estimated*: each
// clip's total duration is divided across its words proportionally to word
// length, with a small fixed gap between words. That's close enough for
// karaoke-style highlighting but not frame-accurate - a mismatch of a
// syllable or two is expected, not a bug.

import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');
// Lives next to the database (same persisted volume in Docker), not the
// source tree, so downloaded voice models survive container rebuilds.
const VOICES_DIR = path.join(path.dirname(DB_PATH), 'piper-voices');

export const VOICES = {
  'thorsten-low': { name: 'de_DE-thorsten-low', label: 'Fast (lower quality)' },
  'thorsten-medium': { name: 'de_DE-thorsten-medium', label: 'Natural (recommended)' },
};
export const DEFAULT_VOICE = 'thorsten-medium';
export const MIN_RATE = 0.75;
export const MAX_RATE = 1.5;
export const DEFAULT_RATE = 1;

function resolveVoiceId(voiceId) {
  return VOICES[voiceId] ? voiceId : DEFAULT_VOICE;
}

function modelPaths(voiceId) {
  const voice = VOICES[resolveVoiceId(voiceId)];
  const base = path.join(VOICES_DIR, voice.name);
  return { onnx: `${base}.onnx`, config: `${base}.onnx.json`, voiceName: voice.name };
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Python tracebacks are many lines of stack frames ending in the actual
// exception message - surface just that last line instead of the whole
// dump, which is meaningless to someone reading it in the app.
function lastLine(stderr) {
  const lines = stderr.trim().split('\n').filter(Boolean);
  return lines[lines.length - 1] || '';
}

async function ensureVoiceDownloaded(voiceId) {
  const { onnx, config, voiceName } = modelPaths(voiceId);
  if ((await fileExists(onnx)) && (await fileExists(config))) return;

  await mkdir(VOICES_DIR, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(
      'python3',
      ['-m', 'piper.download_voices', voiceName, '--download-dir', VOICES_DIR],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Voice download failed for "${voiceName}": ${lastLine(stderr) || `exit code ${code}`}`));
    });
  });
}

// Parses a standard PCM WAV header to get clip duration. Searches for the
// "data" chunk marker rather than assuming a fixed 44-byte header, since
// some encoders (Piper included, depending on version) add extra chunks
// before it.
function parseWavDurationSeconds(buffer) {
  const dataIdx = buffer.indexOf('data', 12, 'ascii');
  if (dataIdx === -1) return 0;
  const dataSize = buffer.readUInt32LE(dataIdx + 4);
  const sampleRate = buffer.readUInt32LE(24);
  const channels = buffer.readUInt16LE(22);
  const bitsPerSample = buffer.readUInt16LE(34);
  const bytesPerSample = bitsPerSample / 8;
  if (!sampleRate || !channels || !bytesPerSample) return 0;
  return dataSize / (sampleRate * channels * bytesPerSample);
}

// Matches the same "real word" tokens the reader turns into clickable/
// highlightable spans (see client TOKEN_RE's word branch), in order, so
// entry N here lines up with the Nth .word span for a given sentence.
const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’-]+/g;
export function extractWords(text) {
  return text.match(WORD_RE) || [];
}

const INTER_WORD_GAP = 0.08;
export function estimateWordTimings(words, durationSeconds) {
  if (!words.length) return [];
  const weights = words.map((w) => Math.max(w.length, 2));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const speakable = Math.max(durationSeconds - INTER_WORD_GAP * (words.length - 1), 0.1);
  let t = 0;
  return weights.map((w) => {
    const dur = (w / totalWeight) * speakable;
    const entry = { start: t, end: t + dur };
    t += dur + INTER_WORD_GAP;
    return entry;
  });
}

export async function synthesize(text, { voiceId, speechRate } = {}) {
  await ensureVoiceDownloaded(voiceId);
  const { onnx, config } = modelPaths(voiceId);
  const rate = Math.min(Math.max(Number(speechRate) || DEFAULT_RATE, MIN_RATE), MAX_RATE);
  // Piper's length_scale is inverse of speed: >1 = slower, <1 = faster.
  const lengthScale = 1 / rate;

  const audio = await new Promise((resolve, reject) => {
    const child = spawn('python3', [
      '-m',
      'piper',
      '--model',
      onnx,
      '--config',
      config,
      '--length-scale',
      String(lengthScale),
      '--sentence-silence',
      '0',
      '--output-file',
      '-',
    ]);

    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`Piper synthesis failed: ${lastLine(stderr) || `exit code ${code}`}`));
    });

    child.stdin.write(text);
    child.stdin.end();
  });

  const durationSeconds = parseWavDurationSeconds(audio);
  const words = extractWords(text);
  const timings = estimateWordTimings(words, durationSeconds);

  return { audio, words, timings, durationSeconds };
}
