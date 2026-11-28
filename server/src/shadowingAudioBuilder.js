// Builds a real, pre-rendered Shadowing-practice MP3 from a page's source
// narration track + its chunk boundaries (shadowingChunker.js) - a direct
// port of the "build audio per chunk" step of the user's own
// shadowing_pipeline.py, using the same ffmpeg CLI calls via child_process
// (matching tts.js's own spawn-a-subprocess convention) instead of
// shelling out to Python, since Groq transcription and chunking already
// happen in plain Node here (asr.js, shadowingChunker.js) - no reason to
// add a second language/runtime just for the ffmpeg half.
//
// Per chunk: speech duration = end - start; slowed duration = max(speech
// duration, 1.5s); silence duration = slowed duration * 1.2. A chunk
// shorter than 1.5s is time-stretched (ffmpeg's atempo filter, which
// preserves pitch) to fill that floor, capped at a 2x speed change - any
// chunk that short is almost always 1-2 words, so slowing it further than
// 2x would make single syllables drag unnaturally rather than sound like
// natural slow speech.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAUSE_FACTOR = 1.2;
const MIN_SLOW_DUR = 1.5;
const MAX_TEMPO_RATIO = 2.0;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' / ')}`));
    });
  });
}

// Builds one chunk's own speech segment (ffmpeg -ss/-to, optionally with an
// atempo speed-up if the chunk is shorter than MIN_SLOW_DUR) and its
// trailing silence segment (ffmpeg's anullsrc), returning both file paths.
async function buildChunkSegments(sourcePath, chunk, index, tmpDir) {
  const duration = chunk.end - chunk.start;
  const slowedDuration = Math.max(duration, MIN_SLOW_DUR);
  const silenceDuration = slowedDuration * PAUSE_FACTOR;

  const speechPath = path.join(tmpDir, `seg_${String(index).padStart(4, '0')}.mp3`);
  if (duration < MIN_SLOW_DUR) {
    const ratio = Math.min(MIN_SLOW_DUR / duration, MAX_TEMPO_RATIO);
    // atempo > 1 speeds a clip UP (shortens it), which is backwards for
    // "stretch a short chunk out to fill 1.5s" - the inverse (1/ratio)
    // is what actually slows it down to roughly that target length.
    await run('ffmpeg', [
      '-y', '-ss', String(chunk.start), '-to', String(chunk.end), '-i', sourcePath,
      '-filter:a', `atempo=${(1 / ratio).toFixed(4)}`, speechPath,
    ]);
  } else {
    await run('ffmpeg', ['-y', '-ss', String(chunk.start), '-to', String(chunk.end), '-i', sourcePath, speechPath]);
  }

  const silencePath = path.join(tmpDir, `sil_${String(index).padStart(4, '0')}.mp3`);
  await run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', String(silenceDuration), '-q:a', '9', '-acodec', 'libmp3lame', silencePath,
  ]);

  return [speechPath, silencePath];
}

// `chunks`: [{start, end, text}] from shadowingChunker.js's groupWordsIntoChunks.
// Returns the rendered MP3 as a Buffer.
export async function buildShadowingAudio(sourceBuffer, chunks) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadowing-'));
  try {
    const sourcePath = path.join(tmpDir, 'source.mp3');
    await fs.writeFile(sourcePath, sourceBuffer);

    const segments = [];
    for (let i = 0; i < chunks.length; i++) {
      segments.push(...(await buildChunkSegments(sourcePath, chunks[i], i, tmpDir)));
    }

    const listPath = path.join(tmpDir, 'concat.txt');
    await fs.writeFile(listPath, segments.map((s) => `file '${s}'`).join('\n'));

    const outPath = path.join(tmpDir, 'output.mp3');
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);

    return fs.readFile(outPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
