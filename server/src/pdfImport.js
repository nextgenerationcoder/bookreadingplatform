// Whole-book PDF import: extracts text page-by-page from the PDF itself
// (via its text layer - fast, free, exact, no AI needed for this part),
// then runs each page's text through the account's configured AI provider
// to translate it into Persian and format it into our PAGE/CHAPTER/
// "N: sentence" import format, then saves the assembled result as a book.
//
// Pages with no extractable text (i.e. the PDF is scanned images rather
// than real text) are skipped and reported back rather than guessed at -
// the existing page-photo batch upload (Add Pages) is the tool for that
// case, since it reads photos directly with a vision-capable model.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { formatPageFromText } from './llm.js';
import { saveImportedBook, appendToBook, parseBookText } from './bookImporter.js';

const MIN_EXTRACTABLE_CHARS = 20;

async function extractPageTexts(pdfBuffer) {
  const doc = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
    pages.push(text);
  }
  return pages;
}

// Runs the whole pipeline and returns { text, pagesFound, errors } - same
// shape as the page-photo batch endpoint, so the client can reuse the same
// review UI. `text` is the assembled PAGE/CHAPTER/sentence block for every
// page that could be translated; nothing is saved by this function alone.
export async function pdfToImportText({ pdfBuffer, provider, apiKey, startPage, chapter }) {
  const pageTexts = await extractPageTexts(pdfBuffer);
  const results = [];
  const errors = [];

  for (let i = 0; i < pageTexts.length; i++) {
    const pageNumber = startPage + i;
    const rawText = pageTexts[i];
    if (rawText.length < MIN_EXTRACTABLE_CHARS) {
      errors.push({
        index: i,
        pageNumber,
        error: 'No extractable text on this PDF page (likely a scanned image) - use the photo batch upload in Add Pages for this page instead.',
      });
      continue;
    }
    try {
      const formatted = await formatPageFromText({ provider, apiKey, rawText, pageNumber, chapter });
      if (!formatted || formatted.trim() === 'NO_TEXT_FOUND') {
        errors.push({ index: i, pageNumber, error: 'AI found no translatable content on this page' });
        continue;
      }
      results.push(formatted);
    } catch (err) {
      errors.push({ index: i, pageNumber, error: err.message });
    }
  }

  return { text: results.join('\n\n'), pagesFound: results.length, totalPages: pageTexts.length, errors };
}

// Runs the pipeline AND saves the result as a book in one step (creates
// bookId if it doesn't exist yet, otherwise appends to it) - the fully
// automated "give me the whole PDF and it builds the book itself" mode.
export async function importPdfAsBook({ pdfBuffer, provider, apiKey, bookId, title, startPage, chapter }) {
  const { text, pagesFound, totalPages, errors } = await pdfToImportText({ pdfBuffer, provider, apiKey, startPage, chapter });
  if (!pagesFound) {
    return { meta: null, pagesFound, totalPages, errors };
  }

  let meta;
  try {
    // appendToBook merges into an existing book (inheriting its title/lang);
    // if the book doesn't exist yet, fall back to creating it fresh.
    meta = await appendToBook(bookId, text);
  } catch {
    const header = `BOOK: ${bookId}\nTITLE: ${title || bookId}\nLANG: de -> fa\n\n`;
    const book = parseBookText(header + text);
    meta = saveImportedBook(book);
  }

  return { meta, pagesFound, totalPages, errors };
}
