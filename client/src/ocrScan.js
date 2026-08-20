import { api } from './api.js';

// Undoes OCR's hard line-wraps, then splits into sentences on ./!/? followed
// by whitespace and an uppercase letter (typical German sentence starts).
function splitSentences(rawText) {
  const joined = rawText.replace(/\s*\n\s*/g, ' ').trim();
  if (!joined) return [];
  return joined
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Scans a page photo, translates each extracted sentence, and formats the
// result in the same PAGE/CHAPTER/"N: sentence" text our importer already
// parses - so the OCR path is just a way to prefill that textarea, not a
// separate ingestion pipeline. The caller still gets to review/edit before
// submitting, since OCR and machine translation both make mistakes.
export async function scanPageToText(file, pageNumber, chapter) {
  const { text } = await api.scanImage(file);
  const sentences = splitSentences(text);
  if (!sentences.length) {
    throw new Error("Couldn't find any readable text in that photo.");
  }

  const { translations } = await api.translateLines(sentences);

  const lines = [`PAGE ${pageNumber}`];
  if (chapter) lines.push(`CHAPTER: ${chapter}`);
  sentences.forEach((sentence, i) => {
    lines.push(`${i + 1}: ${sentence}`);
    lines.push(translations[i] || '(auto-translation unavailable - fill in by hand)');
  });
  return lines.join('\n');
}
