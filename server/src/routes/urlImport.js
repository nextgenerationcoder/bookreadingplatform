import { Router } from 'express';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { formatPageFromText } from '../llm.js';
import { saveImportedBook, appendToBook, parseBookText, buildPageBlock } from '../bookImporter.js';
import { paginateText, slugifyForBookId } from '../urlImport.js';

const router = Router();

function getTextAiSettings(userId) {
  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    throw Object.assign(new Error('no Translation API key configured — add one in Settings first'), { status: 400 });
  }
  return row;
}

// Translates each page and builds/saves the book, page by page.
async function translatePagesIntoBook({ pages, title, provider, apiKey }) {
  const bookId = slugifyForBookId(title);
  let meta = null;
  const errors = [];
  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    try {
      const { sentences } = await formatPageFromText({ provider, apiKey, rawText: pages[i], chapter: null });
      if (!sentences.length) {
        errors.push({ pageNumber, error: 'No translatable content found on this page' });
        continue;
      }
      const pageBlock = buildPageBlock(pageNumber, null, sentences);
      meta = meta
        ? appendToBook(bookId, pageBlock)
        : saveImportedBook(parseBookText(`BOOK: ${bookId}\nTITLE: ${title}\nLANG: de -> fa\n\n${pageBlock}`));
    } catch (err) {
      console.error(`Import: translation/formatting failed on page ${pageNumber}:`, err.message);
      errors.push({ pageNumber, error: err.message });
    }
  }
  return { meta, errors };
}

// POST /api/import-url { text, title } - translates pasted/shared text into
// a readable book, page by page, and returns the new book's meta so the
// client can jump straight into the reader. Synchronous, not a background
// job like PDF import - a single shared passage is far smaller than a
// whole book, so this comfortably finishes within one request.
//
// Deliberately takes text, not a URL to fetch: an earlier version fetched
// the URL server-side, but a real test (a LinkedIn job posting) showed that
// doesn't work for anything login-gated or JS-rendered - the plain-HTML
// response has none of the real content. The phone/browser the person is
// already logged into can see the real page, so they copy/share the text
// in instead (see main.js's redirectShareTargetToHash, which is what lands
// a shared selection here via #/import-url).
router.post('/', async (req, res) => {
  const { text, title: rawTitle } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  let row;
  try {
    row = getTextAiSettings(req.userId);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  // Paragraphs are just blank-line-separated chunks of whatever was pasted.
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  if (!paragraphs.length) {
    return res.status(400).json({ error: 'No text found to import.' });
  }

  const pages = paginateText(paragraphs);
  const title = (rawTitle || '').trim() || 'Pasted Text';

  let textApiKey;
  try {
    textApiKey = await decrypt(row.llm_api_key_enc);
  } catch (err) {
    console.error('Paste import: failed to decrypt the Translation API key:', err);
    return res.status(500).json({ error: 'Failed to read your Translation API key — try re-saving it in Settings.' });
  }

  const { meta, errors } = await translatePagesIntoBook({ pages, title, provider: row.llm_provider, apiKey: textApiKey });

  if (!meta) {
    const reason = errors[0]?.error || 'unknown reason';
    return res.status(400).json({
      error: `Could not translate any page of this content (${reason}) — it may not be German text.`,
    });
  }

  res.json({ ...meta, pagesRequested: pages.length, errors });
});

export default router;
