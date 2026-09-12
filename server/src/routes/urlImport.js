import { Router } from 'express';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { formatPageFromText } from '../llm.js';
import { saveImportedBook, appendToBook, parseBookText, buildPageBlock } from '../bookImporter.js';
import { extractReadableText, paginateText, extractTitle, slugifyForBookId } from '../urlImport.js';

const router = Router();

// Best-effort SSRF guard: a logged-in account shouldn't be able to make this
// server fetch its own internal services (the whisper container, localhost
// admin ports, cloud metadata endpoints, etc.) and read the result back
// through the "imported page" text. Not exhaustive (doesn't resolve DNS to
// catch a hostname that resolves to a private IP), but blocks the obvious
// cases without needing a DNS round trip on every import.
const PRIVATE_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|::1|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i;

// Below this, there's essentially nothing to translate - see the check
// right after extraction, which turns this into an honest diagnosis
// ("this page needs a login/JS") instead of a confusing AI failure.
const MIN_CONTENT_CHARS = 150;

function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs can be imported.');
  }
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    throw new Error("That URL points at a private/internal address, which can't be imported.");
  }
  return parsed;
}

function getTextAiSettings(userId) {
  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    throw Object.assign(new Error('no Translation API key configured — add one in Settings first'), { status: 400 });
  }
  return row;
}

// Translates each page and builds/saves the book, page by page - shared by
// both the URL-fetch route and the paste-text route below, since past the
// point of having plain-text pages, the two are identical.
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

// POST /api/import-url { url } - fetches a webpage, translates it into a
// readable book (see urlImport.js for the extraction/pagination), and
// returns the new book's meta so the client can jump straight into the
// reader. Synchronous, not a background job like PDF import - a single
// webpage is far smaller than a whole book, so this comfortably finishes
// within one request.
router.post('/', async (req, res) => {
  const { url: rawUrl } = req.body || {};
  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsedUrl;
  try {
    parsedUrl = assertSafeUrl(rawUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let row;
  try {
    row = getTextAiSettings(req.userId);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  let html;
  try {
    const fetchRes = await fetch(parsedUrl.href, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; BilingualReaderBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!fetchRes.ok) throw new Error(`The page returned ${fetchRes.status} ${fetchRes.statusText}`);
    const contentType = fetchRes.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`That URL isn't a webpage (content-type: ${contentType || 'unknown'})`);
    }
    html = await fetchRes.text();
  } catch (err) {
    return res.status(400).json({ error: `Couldn't fetch that page: ${err.message}` });
  }

  const paragraphs = extractReadableText(html);
  const extractedChars = paragraphs.reduce((n, p) => n + p.length, 0);
  if (!paragraphs.length || extractedChars < MIN_CONTENT_CHARS) {
    // A clear diagnosis instead of letting this look like a translation
    // failure: sites that need a login or run mostly client-side JS (many
    // job boards, including LinkedIn's job view pages) serve almost no
    // real content in the plain HTML this fetch sees - there's nothing an
    // AI call could recover here, so this fails before spending one. The
    // client's UI points at "Paste Page Text" (POST /text below) as the
    // way around this - it can't be fixed by trying harder to fetch.
    return res.status(400).json({
      error: `Only found ${extractedChars} characters of readable text on that page - probably needs a login or JavaScript to show its real content, which this import can't do. Try "Paste Page Text" instead.`,
    });
  }
  const pages = paginateText(paragraphs);
  const title = extractTitle(html, parsedUrl.href);

  let textApiKey;
  try {
    textApiKey = await decrypt(row.llm_api_key_enc);
  } catch (err) {
    console.error('URL import: failed to decrypt the Translation API key:', err);
    return res.status(500).json({ error: 'Failed to read your Translation API key — try re-saving it in Settings.' });
  }

  const { meta, errors } = await translatePagesIntoBook({ pages, title, provider: row.llm_provider, apiKey: textApiKey });

  if (!meta) {
    const reason = errors[0]?.error || 'unknown reason';
    return res.status(400).json({
      error: `Could not translate any page of this content (${reason}) — it may not be German text.`,
    });
  }

  res.json({ ...meta, url: parsedUrl.href, pagesRequested: pages.length, errors });
});

// POST /api/import-url/text { text, title } - same translate-and-save
// pipeline as above, but for text pasted directly instead of a URL to
// fetch. Exists for pages this server can't fetch the real content of at
// all: logged-in-only content (LinkedIn job postings, paywalled articles)
// or anything JS-rendered - the phone/browser the person is already
// logged into can see the real page, so they copy it in by hand instead.
// Paragraphs are just blank-line-separated chunks of whatever was pasted.
router.post('/text', async (req, res) => {
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

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  if (!paragraphs.length) {
    return res.status(400).json({ error: 'No text found to import.' });
  }

  const pages = paginateText(paragraphs);
  const title = (rawTitle || '').trim() || 'Pasted Page';

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
