// Whole-book PDF import: extracts text page-by-page from the PDF itself
// (via its text layer - fast, free, exact, no AI needed for this part).
// For pages with no extractable text (i.e. that page is a scanned image,
// not real text), it's rendered to an image and read with a vision-capable
// AI key instead - real OCR, not skipped. Either way, each page's German
// text then goes through a (possibly different, cheaper, text-only) AI key
// to translate it into Persian and format it into our PAGE/CHAPTER/
// "N: sentence" import format, and the assembled result is saved as a book.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { formatPageFromText, formatPageFromImage } from './llm.js';
import { saveImportedBook, appendToBook, parseBookText } from './bookImporter.js';

const MIN_EXTRACTABLE_CHARS = 20;
const RENDER_SCALE = 2.0; // ~144 DPI at typical page sizes - good OCR quality without huge images

async function loadPdf(pdfBuffer) {
  return getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
}

async function extractPageText(doc, pageIndex) {
  const page = await doc.getPage(pageIndex);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
}

async function renderPageToPngBase64(doc, pageIndex) {
  const page = await doc.getPage(pageIndex);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer('image/png').toString('base64');
}

// Runs the whole pipeline and returns { text, pagesFound, totalPages,
// errors } - same shape as the page-photo batch endpoint, so the client can
// reuse the same review UI. `text` is the assembled PAGE/CHAPTER/sentence
// block for every page that could be translated; nothing is saved by this
// function alone.
//
// `vision` is optional ({ provider, apiKey } or null/undefined) - without
// it, scanned pages are reported in `errors` instead of OCR'd.
export async function pdfToImportText({ pdfBuffer, text: textAi, vision, startPage, chapter }) {
  const doc = await loadPdf(pdfBuffer);
  const totalPages = doc.numPages;
  const results = [];
  const errors = [];

  for (let i = 1; i <= totalPages; i++) {
    const pageNumber = startPage + i - 1;
    let rawText = await extractPageText(doc, i);
    let fromOcr = false;

    if (rawText.length < MIN_EXTRACTABLE_CHARS) {
      if (!vision) {
        errors.push({
          index: i - 1,
          pageNumber,
          error: 'No extractable text on this PDF page (scanned image) - add a Vision API key in Settings to OCR pages like this.',
        });
        continue;
      }
      try {
        const imageBase64 = await renderPageToPngBase64(doc, i);
        // formatPageFromImage already translates+formats in one call, so a
        // page that needed OCR skips the separate text-translation step below.
        const formatted = await formatPageFromImage({
          provider: vision.provider,
          apiKey: vision.apiKey,
          imageBase64,
          mimeType: 'image/png',
          pageNumber,
          chapter,
        });
        if (!formatted || formatted.trim() === 'NO_TEXT_FOUND') {
          errors.push({ index: i - 1, pageNumber, error: 'No readable text found on this scanned page' });
          continue;
        }
        results.push(formatted);
        continue;
      } catch (err) {
        errors.push({ index: i - 1, pageNumber, error: `OCR failed: ${err.message}` });
        continue;
      }
    }

    try {
      const formatted = await formatPageFromText({ provider: textAi.provider, apiKey: textAi.apiKey, rawText, pageNumber, chapter });
      if (!formatted || formatted.trim() === 'NO_TEXT_FOUND') {
        errors.push({ index: i - 1, pageNumber, error: 'AI found no translatable content on this page' });
        continue;
      }
      results.push(formatted);
    } catch (err) {
      errors.push({ index: i - 1, pageNumber, error: err.message });
    }
  }

  return { text: results.join('\n\n'), pagesFound: results.length, totalPages, errors };
}

// Runs the pipeline AND saves the result as a book in one step (creates
// bookId if it doesn't exist yet, otherwise appends to it) - the fully
// automated "give me the whole PDF and it builds the book itself" mode.
export async function importPdfAsBook({ pdfBuffer, text, vision, bookId, title, startPage, chapter }) {
  const { text: importText, pagesFound, totalPages, errors } = await pdfToImportText({ pdfBuffer, text, vision, startPage, chapter });
  if (!pagesFound) {
    return { meta: null, pagesFound, totalPages, errors };
  }

  let meta;
  try {
    // appendToBook merges into an existing book (inheriting its title/lang);
    // if the book doesn't exist yet, fall back to creating it fresh.
    meta = await appendToBook(bookId, importText);
  } catch {
    const header = `BOOK: ${bookId}\nTITLE: ${title || bookId}\nLANG: de -> fa\n\n`;
    const book = parseBookText(header + importText);
    meta = saveImportedBook(book);
  }

  return { meta, pagesFound, totalPages, errors };
}
