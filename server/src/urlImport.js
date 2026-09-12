// Turns a shared webpage URL into a readable book: fetch -> strip down to
// readable text (cheerio) -> paginate like a real book's pages -> translate
// each page via the account's own Translation API key (same
// formatPageFromText() the PDF import pipeline already uses) -> save.
//
// Used by routes/urlImport.js, which is what the "Import Web Page" view
// (client/src/views/importUrl.js) and Android's share-to-app flow
// (manifest.json's share_target -> #/import-url) both call into.

import * as cheerio from 'cheerio';

// Roughly one page's worth of reading - matches the unit formatPageFromText
// already works in one call at a time (a PDF page), so a long article reads
// the same way a long PDF does: split into multiple pages, not one giant
// block sent to the AI at once.
const MAX_PAGE_CHARS = 2500;
// Caps how much of a very long page/article gets imported - well past a
// normal "read a few pages" session, with plenty of headroom. A genuinely
// book-length page belongs in the PDF import instead.
const MAX_TOTAL_CHARS = 20000;

// A page's paragraph-tag extraction only "worked" if it captured a real
// share of the container's actual text - otherwise the real content almost
// certainly isn't in <p>/<li>/etc at all (common on JS-heavy sites: the
// visible text sits in plain <div>/<span> wrappers), and a handful of short
// unrelated <p> tags (cookie notices, UI labels) would otherwise look like
// "it worked" while missing the actual article/posting entirely.
const MIN_PARAGRAPH_COVERAGE = 0.4;

// Strips a fetched webpage down to its readable text (no nav/ads/scripts) -
// one paragraph per block-level element, so pagination below can group them
// without cutting mid-thought more than it has to. Prefers <article>/<main>
// (most real sites wrap their actual content in one of those) and falls
// back to <body> otherwise.
export function extractReadableText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, aside, svg, iframe, form, button').remove();

  let container = $('article').first();
  if (!container.length) container = $('main').first();
  if (!container.length) container = $('body');

  const paragraphs = [];
  container.find('p, li, h1, h2, h3, blockquote').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 20) paragraphs.push(text);
  });

  const wholeChars = container.text().replace(/\s+/g, ' ').trim().length;
  const paragraphChars = paragraphs.reduce((n, p) => n + p.length, 0);

  // Falls back to every leaf element's own text (no child elements, so no
  // double-counting a parent and its children) whenever the tag-based
  // extraction came up empty or clearly missed most of the real content -
  // catches sites whose real text sits in plain <div>/<span> wrappers
  // rather than semantic <p>/<li> tags (common on JS-templated pages).
  if (!wholeChars) return paragraphs;
  if (!paragraphs.length || paragraphChars < wholeChars * MIN_PARAGRAPH_COVERAGE) {
    const leaves = [];
    container.find('*').each((_, el) => {
      const node = $(el);
      if (node.children().length) return;
      const text = node.text().replace(/\s+/g, ' ').trim();
      if (text.length > 20) leaves.push(text);
    });
    if (leaves.length) return leaves;
  }

  return paragraphs;
}

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

export function extractTitle(html, fallbackUrl) {
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr('content')?.trim() || $('title').first().text().trim() || $('h1').first().text().trim();
  if (title) return title;
  try {
    return new URL(fallbackUrl).hostname;
  } catch {
    return 'Imported Page';
  }
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
