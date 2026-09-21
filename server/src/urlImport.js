// Turns pasted/shared text into a readable book: paginate like a real
// book's pages -> translate each page via the account's own Translation
// API key (same formatPageFromText() the PDF import pipeline already
// uses) -> save.
//
// Used by routes/urlImport.js, which is what the "Import Text" view
// (client/src/views/importUrl.js) and Android's share-to-app flow
// (manifest.json's share_target -> #/import-url) both call into. An
// earlier version fetched a URL server-side and extracted readable text
// with cheerio, but a real test (a LinkedIn job posting) showed that
// doesn't work for anything login-gated or JS-rendered - removed in favor
// of just taking the text directly, copied from wherever the person can
// actually see the real content.

// Roughly one page's worth of reading - matches the unit formatPageFromText
// already works in one call at a time (a PDF page), so a long passage
// reads the same way a long PDF does: split into multiple pages, not one
// giant block sent to the AI at once.
const MAX_PAGE_CHARS = 2500;
// Caps how much of a very long passage gets imported - well past a normal
// "read a few pages" session, with plenty of headroom. A genuinely
// book-length passage belongs in the PDF import instead.
const MAX_TOTAL_CHARS = 20000;

// Groups paragraphs into page-sized chunks, capped overall at
// MAX_TOTAL_CHARS - same idea as a real book's pages.
export function paginateText(paragraphs) {
  const pages = [];
  let current = [];
  let currentLen = 0;
  let totalLen = 0;

  for (const para of paragraphs) {
    if (totalLen >= MAX_TOTAL_CHARS) break;
    if (currentLen && currentLen + para.length > MAX_PAGE_CHARS) {
      pages.push(current.join('\n\n'));
      current = [];
      currentLen = 0;
    }
    current.push(para);
    currentLen += para.length;
    totalLen += para.length;
  }
  if (current.length) pages.push(current.join('\n\n'));
  return pages;
}

// bookIds are shared across all accounts (see routes/books.js), so a
// title-only slug risks colliding with someone else's unrelated import -
// the trailing base36 timestamp keeps every import's id unique without
// needing a "does this id already exist" round trip.
export function slugifyForBookId(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `web-${base || 'page'}-${Date.now().toString(36)}`;
}
