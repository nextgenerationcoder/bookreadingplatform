// Whole-book PDF import: extracts text page-by-page from the PDF itself
// (via its text layer - fast, free, exact, no AI needed for this part).
// For pages with no extractable text (i.e. that page is a scanned image),
// it's rendered to an image and read with free, local Tesseract OCR
// instead. Either way, each page's German text then goes through the
// account's Translation API key to translate it into Persian and format it
// into our PAGE/CHAPTER/"N: sentence" import format.
//
// Pages are translated AND SAVED ONE AT A TIME (not assembled and saved
// only at the end), so a book being imported can already be opened and
// read while later pages are still processing in the background.
//
// The book is worked through 10-page chunk files (see pdfSplit.js) rather
// than as one big in-memory document for the whole book - only the current
// chunk's PDF is ever loaded, so a 300+ page scan doesn't need its whole
// page tree/rendered images resident at once, and a resume after a restart
// only has to re-load the small chunk it was on.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import path from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { formatPageFromText } from './llm.js';
import { ocrImageBuffer } from './tesseractOcr.js';
import { saveImportedBook, appendToBook, parseBookText } from './bookImporter.js';
import { CHUNK_SIZE, chunkFileName, chunkNumberForPage } from './pdfSplit.js';

const MIN_EXTRACTABLE_CHARS = 20;
const RENDER_SCALE = 2.0; // ~144 DPI at typical page sizes - good OCR quality without huge images

async function extractPageText(doc, pageIndex) {
  const page = await doc.getPage(pageIndex);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
}

async function renderPageToPngBuffer(doc, pageIndex) {
  const page = await doc.getPage(pageIndex);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer('image/png');
}

// The model is asked to start its reply with "PAGE <n>" (and a CHAPTER
// line, if given), but doesn't always comply - short pages (a title page
// with just an author's name, a copyright page) especially tend to get a
// reply that's just the sentence lines with no header at all, which the
// parser then rejects outright ("Sentence ... appears before any PAGE
// marker"). Since the real page number is already known here, don't trust
// the model's echo of it: strip whatever header lines (if any) it produced
// and always prepend our own canonical ones.
function ensurePageHeader(formatted, pageNumber, chapter) {
  const lines = formatted.split(/\r?\n/);
  let i = 0;
  while (
    i < lines.length &&
    (lines[i].trim() === '' || /^PAGE\s+\d+$/i.test(lines[i].trim()) || /^CHAPTER:/i.test(lines[i].trim()))
  ) {
    i++;
  }
  const body = lines.slice(i).join('\n').trim();
  const chapterLine = chapter ? `CHAPTER: ${chapter}\n` : '';
  return `PAGE ${pageNumber}\n${chapterLine}${body}`;
}

function saveOnePage(bookId, title, pageText) {
  try {
    return appendToBook(bookId, pageText);
  } catch {
    const header = `BOOK: ${bookId}\nTITLE: ${title || bookId}\nLANG: de -> fa\n\n`;
    const book = parseBookText(header + pageText);
    return saveImportedBook(book);
  }
}

// Processes and saves the PDF one page at a time, calling onProgress after
// each page so a caller can track/report status (see routes/books.js's job
// tracking). Returns the final summary once every page has been attempted.
//
// resumeFromIndex/initialPagesFound/initialErrors let a caller pick back up
// mid-book after an interruption (e.g. a server restart) instead of
// reprocessing the whole PDF from page 1 - already-saved pages are skipped
// entirely (replacePage() makes re-saving the same page number safe anyway,
// but there's no need to redo AI calls for pages that already succeeded).
//
// chunkDir must contain the chunk-NNNN.pdf files produced by
// splitPdfIntoChunks() for this same book; totalPages is the book's real
// page count (known up front from the split, not derived here).
export async function importPdfAsBook({
  chunkDir, totalPages, text: textAi, bookId, title, startPage, chapter, onProgress,
  resumeFromIndex = 1, initialPagesFound = 0, initialErrors = [],
}) {
  let pagesFound = initialPagesFound;
  const errors = [...initialErrors];
  let meta = null;

  let loadedChunkNumber = null;
  let doc = null;

  for (let i = resumeFromIndex; i <= totalPages; i++) {
    const pageNumber = startPage + i - 1;
    const chunkNumber = chunkNumberForPage(i);
    const totalChunks = Math.ceil(totalPages / CHUNK_SIZE);
    onProgress?.({ currentPage: i, totalPages, currentChunk: chunkNumber, totalChunks, pagesFound, errors });

    if (chunkNumber !== loadedChunkNumber) {
      // Done with the previous chunk's file (its pages' progress is already
      // persisted via onProgress above) - remove it so a long book doesn't
      // leave every chunk sitting on disk at once.
      if (loadedChunkNumber !== null) {
        await unlink(path.join(chunkDir, chunkFileName(loadedChunkNumber))).catch(() => {});
      }
      const chunkBuffer = await readFile(path.join(chunkDir, chunkFileName(chunkNumber)));
      doc = await getDocument({ data: new Uint8Array(chunkBuffer) }).promise;
      loadedChunkNumber = chunkNumber;
    }
    const localIndex = ((i - 1) % CHUNK_SIZE) + 1;

    let rawText = await extractPageText(doc, localIndex);
    let usedOcr = false;

    if (rawText.length < MIN_EXTRACTABLE_CHARS) {
      usedOcr = true;
      try {
        const png = await renderPageToPngBuffer(doc, localIndex);
        rawText = (await ocrImageBuffer(png)).trim();
      } catch (err) {
        console.error(`PDF import: OCR failed on page ${pageNumber}:`, err.message);
        errors.push({ index: i - 1, pageNumber, error: `OCR failed: ${err.message}` });
        continue;
      }
      if (rawText.length < MIN_EXTRACTABLE_CHARS) {
        console.error(`PDF import: OCR came up empty on page ${pageNumber}`);
        errors.push({ index: i - 1, pageNumber, error: 'No readable text found on this scanned page (OCR came up empty)' });
        continue;
      }
    }

    try {
      const formatted = await formatPageFromText({ provider: textAi.provider, apiKey: textAi.apiKey, rawText, pageNumber, chapter });
      if (!formatted || formatted.trim() === 'NO_TEXT_FOUND') {
        console.error(`PDF import: no translatable content on page ${pageNumber}${usedOcr ? ' (after OCR)' : ''}`);
        errors.push({ index: i - 1, pageNumber, error: `No translatable content found on this page${usedOcr ? ' (after OCR)' : ''}` });
        continue;
      }
      meta = saveOnePage(bookId, title, ensurePageHeader(formatted, pageNumber, chapter));
      pagesFound += 1;
    } catch (err) {
      console.error(`PDF import: translation/formatting failed on page ${pageNumber}:`, err.message);
      errors.push({ index: i - 1, pageNumber, error: err.message });
    }
  }

  const totalChunks = Math.ceil(totalPages / CHUNK_SIZE);
  onProgress?.({ currentPage: totalPages, totalPages, currentChunk: totalChunks, totalChunks, pagesFound, errors, done: true });
  return { meta, pagesFound, totalPages, errors };
}
