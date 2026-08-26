// Splits an uploaded PDF into real 10-page sub-PDF files before processing,
// instead of treating a whole 300+ page book as one giant in-memory
// document for the length of the import. Each chunk is copied with
// pdf-lib's copyPages (which preserves the original content streams/fonts,
// so the text layer - and therefore whether OCR is needed - stays exactly
// as it was in the source), keeping peak memory small and letting a resume
// after a restart re-load just the ~10-page chunk it was on rather than
// re-parsing the entire book.

import { PDFDocument } from 'pdf-lib';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export const CHUNK_SIZE = 10;

export function chunkFileName(chunkNumber) {
  return `chunk-${String(chunkNumber).padStart(4, '0')}.pdf`;
}

export function chunkNumberForPage(pageIndex, chunkSize = CHUNK_SIZE) {
  return Math.floor((pageIndex - 1) / chunkSize) + 1;
}

// Splits pdfBuffer into chunkSize-page files written to dir/chunk-0001.pdf,
// chunk-0002.pdf, etc. Returns the book's total page count.
export async function splitPdfIntoChunks(pdfBuffer, dir, chunkSize = CHUNK_SIZE) {
  // ignoreEncryption: many scanned/downloaded PDFs have an owner password
  // restricting printing/editing but no open password - pdf-lib otherwise
  // refuses to touch them at all.
  const src = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  await fs.mkdir(dir, { recursive: true });

  for (let start = 0; start < totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalPages);
    const indices = Array.from({ length: end - start }, (_, k) => start + k);
    const chunkDoc = await PDFDocument.create();
    const copiedPages = await chunkDoc.copyPages(src, indices);
    for (const page of copiedPages) chunkDoc.addPage(page);
    const bytes = await chunkDoc.save();
    const chunkNumber = Math.floor(start / chunkSize) + 1;
    await fs.writeFile(path.join(dir, chunkFileName(chunkNumber)), bytes);
  }

  return totalPages;
}
