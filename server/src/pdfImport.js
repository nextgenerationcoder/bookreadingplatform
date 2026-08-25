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

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { formatPageFromText } from './llm.js';
import { ocrImageBuffer } from './tesseractOcr.js';
import { saveImportedBook, appendToBook, parseBookText } from './bookImporter.js';

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
export async function importPdfAsBook({
  pdfBuffer, text: textAi, bookId, title, startPage, chapter, onProgress,
  resumeFromIndex = 1, initialPagesFound = 0, initialErrors = [],
}) {
  const doc = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const totalPages = doc.numPages;
  let pagesFound = initialPagesFound;
  const errors = [...initialErrors];
  let meta = null;

  for (let i = resumeFromIndex; i <= totalPages; i++) {
    const pageNumber = startPage + i - 1;
    onProgress?.({ currentPage: i, totalPages, pagesFound, errors });

    let rawText = await extractPageText(doc, i);
    let usedOcr = false;

    if (rawText.length < MIN_EXTRACTABLE_CHARS) {
      usedOcr = true;
      try {
        const png = await renderPageToPngBuffer(doc, i);
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
      meta = saveOnePage(bookId, title, formatted);
      pagesFound += 1;
    } catch (err) {
      console.error(`PDF import: translation/formatting failed on page ${pageNumber}:`, err.message);
      errors.push({ index: i - 1, pageNumber, error: err.message });
    }
  }

  onProgress?.({ currentPage: totalPages, totalPages, pagesFound, errors, done: true });
  return { meta, pagesFound, totalPages, errors };
}
