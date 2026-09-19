// Reading Mode content script. Loaded (dormant) on every http(s) page except
// the platform's own site; does nothing until it gets a TOGGLE_READING_MODE
// message from the popup. Mirrors client/src/views/reader.js's model
// exactly, not just its "clicked = learning, else passive" split but also
// *how* passive gets assigned: a click commits everything read *up to that
// click* as passive (see reader.js's commitReadUpTo), not the whole page at
// once - a title or nav link the reader never actually read shouldn't be
// claimed as passively known just because it happened to be on the page.
// See server/src/routes/vocab.js's /reading-page endpoint, which this
// reuses directly rather than inventing a separate extension-only table.

let active = false;
let widgetHost = null;
let styleEl = null;
let wrappedSpans = [];
let clickedWords = new Map(); // normalized word -> {german, persian}
let seenWords = new Map(); // normalized word -> {german, persian}; only ever populated by commitReadUpTo (i.e. words actually read up to a click), never the whole page at once
let vocabStatus = {}; // normalized word -> 'learning' | 'learned' | 'passive'
let paraState = new WeakMap(); // paragraph element -> {count, lastCommitted} - see commitReadUpTo
let autoSyncTimer = null;
const AUTO_SYNC_DELAY_MS = 4000; // sync shortly after the last click, not per-click

const HAS_WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’-]{2,}/;
const TOKEN_SPLIT_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’-]{2,}/g;
const DEFAULT_COLORS = { known: '#2f8f4e', learning: '#d98c2b', unset: '#9a9488' };

// Never wrapped/colored at all, not just excluded from auto-passive - a page
// title, nav links, footer boilerplate etc. aren't "reading" in the sense
// this feature means, so they stay plain text entirely rather than risking
// getting marked as known vocabulary the reader never actually read.
const EXCLUDE_SELECTOR =
  'script, style, noscript, textarea, input, select, iframe, code, pre, ' +
  'nav, header, footer, aside, form, button, label, ' +
  'h1, h2, h3, h4, h5, h6, .lex-widget-host, .lex-word';

// The nearest one of these ancestors is treated as "one paragraph" for the
// read-up-to-here commit range below - closest() finds the innermost match,
// so a <p> two levels up wins over an outer <div>/<section> further out.
const PARAGRAPH_SELECTOR = 'p, li, blockquote, dd, dt, figcaption, td, th, div, section, article, main';

function normalize(word) {
  return word.toLowerCase();
}

function statusClass(status) {
  if (status === 'learned' || status === 'passive') return 'lex-known';
  if (status === 'learning') return 'lex-learning';
  return 'lex-unset';
}

function findParagraph(el) {
  return el.closest(PARAGRAPH_SELECTOR) || el;
}

function getParaEntry(para) {
  let entry = paraState.get(para);
  if (!entry) {
    entry = { count: 0, lastCommitted: -1 };
    paraState.set(para, entry);
  }
  return entry;
}

function sendMsg(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error('No response from extension background'));
      if (!res.ok) return reject(new Error(res.error || 'Request failed'));
      resolve(res.data);
    });
  });
}

async function getColors() {
  const { lexColors } = await chrome.storage.sync.get('lexColors');
  return { ...DEFAULT_COLORS, ...(lexColors || {}) };
}

async function activateReadingMode() {
  if (active) return;

  let authState;
  try {
    authState = await sendMsg('GET_AUTH_STATE');
  } catch (err) {
    alert(`Reading Mode could not reach the extension background: ${err.message}`);
    return;
  }
  if (!authState?.loggedIn) {
    alert('Sign in first: click the extension icon and log in with your Book Reading Platform account.');
    return;
  }

  try {
    vocabStatus = await sendMsg('GET_VOCAB_STATUS');
  } catch {
    vocabStatus = {};
  }

  const colors = await getColors();
  active = true;
  injectStyles(colors);
  wrapWords(document.body);
  injectWidget();
}

function deactivateReadingMode() {
  if (!active) return;
  active = false;
  clearTimeout(autoSyncTimer);
  // Flush whatever hasn't synced yet so stopping (or navigating away, since
  // this fires from beforeunload too) doesn't silently drop it.
  if (clickedWords.size || seenWords.size) syncNow();
  for (const span of wrappedSpans) {
    const parent = span.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(span.textContent), span);
    parent.normalize();
  }
  wrappedSpans = [];
  clickedWords.clear();
  seenWords.clear();
  paraState = new WeakMap();
  styleEl?.remove();
  styleEl = null;
  widgetHost?.remove();
  widgetHost = null;
}

function injectStyles(colors) {
  styleEl = document.createElement('style');
  styleEl.textContent = `
    .lex-word { cursor: pointer; border-radius: 3px; }
    .lex-word.lex-known { color: ${colors.known} !important; }
    .lex-word.lex-learning { color: ${colors.learning} !important; }
    .lex-word.lex-unset { color: ${colors.unset} !important; }
    .lex-word.lex-clicked { text-decoration: underline; text-decoration-style: dotted; }
  `;
  document.head.appendChild(styleEl);
}

function wrapWords(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !HAS_WORD_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
      if (parent.closest(EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  for (const textNode of textNodes) {
    const para = findParagraph(textNode.parentElement);
    const entry = getParaEntry(para);
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    TOKEN_SPLIT_RE.lastIndex = 0;
    let match;
    while ((match = TOKEN_SPLIT_RE.exec(text))) {
      const word = match[0];
      const offset = match.index;
      if (offset > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));

      const span = document.createElement('span');
      span.className = 'lex-word';
      span.textContent = word;
      const key = normalize(word);
      const status = vocabStatus[key] || 'unset';
      span.classList.add(statusClass(status));
      span.dataset.word = word;
      span.dataset.status = status;
      span.dataset.paraIndex = entry.count++;
      span.addEventListener('click', onWordClick);
      frag.appendChild(span);
      wrappedSpans.push(span);

      lastIndex = offset + word.length;
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

// A click is also a "I've read at least this far [in this paragraph]"
// signal - everything between the previous furthest click and this one,
// *within the same paragraph*, gets committed as passive right away. Never
// crosses into other paragraphs and never auto-commits a trailing
// unclicked tail - unlike the website's own "Finish Page" button, there's
// no equivalent "I'm done with this page" signal on an arbitrary webpage,
// so only what was actually clicked through ever counts.
function commitReadUpTo(span) {
  const para = findParagraph(span);
  const entry = getParaEntry(para);
  const clickedIndex = Number(span.dataset.paraIndex);
  if (!Number.isFinite(clickedIndex) || clickedIndex <= entry.lastCommitted) return;

  const spansInRange = [...para.querySelectorAll('.lex-word')].filter((s) => {
    const idx = Number(s.dataset.paraIndex);
    return idx > entry.lastCommitted && idx <= clickedIndex;
  });
  entry.lastCommitted = clickedIndex;

  for (const s of spansInRange) {
    const key = normalize(s.dataset.word);
    if (clickedWords.has(key)) continue; // stays orange, tracked separately
    if (!seenWords.has(key)) seenWords.set(key, { german: s.dataset.word, persian: '' });
    if (s.dataset.status !== 'learned' && s.dataset.status !== 'learning') {
      s.classList.remove('lex-unset');
      s.classList.add('lex-known');
      s.dataset.status = 'passive';
    }
  }
}

let activePopup = null;

async function onWordClick(e) {
  e.stopPropagation();
  const span = e.currentTarget;
  const word = span.dataset.word;
  const key = normalize(word);
  span.classList.add('lex-clicked');

  // A click means "I don't know this" - color it orange right away, same as
  // the website's own reader does, matching vocab.js's /reading-page rule
  // that a click always pushes toward 'learning' unless the word is already
  // 'learned' (a page skim shouldn't undo real progress on a mastered word).
  if (span.dataset.status !== 'learned') {
    span.classList.remove('lex-known', 'lex-unset');
    span.classList.add('lex-learning');
    span.dataset.status = 'learning';
  }
  clickedWords.set(key, { german: word, persian: '' });
  seenWords.set(key, { german: word, persian: '' });

  commitReadUpTo(span);

  showGlossPopup(span, 'Looking up…');
  let gloss = 'Not found';
  try {
    const data = await sendMsg('LOOKUP_WORD', { word: key });
    gloss = data?.gloss || gloss;
  } catch {
    gloss = 'Lookup failed';
  }
  clickedWords.set(key, { german: word, persian: gloss });
  seenWords.set(key, { german: word, persian: gloss });
  showGlossPopup(span, gloss);
  updatePendingStatus();
  scheduleAutoSync();
}

function updatePendingStatus() {
  const statusEl = widgetHost?.querySelector('#lex-status');
  if (!statusEl) return;
  statusEl.textContent = `${clickedWords.size} to learn queued – syncing soon…`;
}

function scheduleAutoSync() {
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(syncNow, AUTO_SYNC_DELAY_MS);
}

function showGlossPopup(anchor, text) {
  activePopup?.remove();
  const rect = anchor.getBoundingClientRect();
  const p = document.createElement('div');
  p.textContent = text;
  Object.assign(p.style, {
    position: 'fixed',
    left: `${Math.max(4, rect.left)}px`,
    top: `${rect.bottom + 4}px`,
    background: '#111',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '13px',
    zIndex: 2147483647,
    maxWidth: '260px',
    pointerEvents: 'none',
    fontFamily: 'system-ui, sans-serif',
  });
  document.body.appendChild(p);
  activePopup = p;
  setTimeout(() => {
    if (activePopup === p) {
      p.remove();
      activePopup = null;
    }
  }, 3000);
}

function injectWidget() {
  widgetHost = document.createElement('div');
  widgetHost.className = 'lex-widget-host';
  Object.assign(widgetHost.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: 2147483647,
    background: '#173e64',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '12px',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    boxShadow: '0 4px 14px rgba(0,0,0,.3)',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  });
  widgetHost.innerHTML = `
    <span>\u{1F4D6} Reading Mode</span>
    <button id="lex-sync-btn" type="button">Sync words</button>
    <button id="lex-stop-btn" type="button">Stop</button>
    <span id="lex-status"></span>
  `;
  for (const [id, bg] of [
    ['lex-sync-btn', '#2f8f4e'],
    ['lex-stop-btn', '#c0392b'],
  ]) {
    Object.assign(widgetHost.querySelector(`#${id}`).style, {
      cursor: 'pointer',
      border: 'none',
      borderRadius: '6px',
      padding: '6px 10px',
      background: bg,
      color: '#fff',
      fontSize: '13px',
    });
  }
  widgetHost.querySelector('#lex-status').style.opacity = '.85';
  document.body.appendChild(widgetHost);
  widgetHost.querySelector('#lex-sync-btn').addEventListener('click', syncNow);
  widgetHost.querySelector('#lex-stop-btn').addEventListener('click', deactivateReadingMode);
}

async function syncNow() {
  const statusEl = widgetHost?.querySelector('#lex-status');
  const toLearn = [...clickedWords.values()];
  const passive = [...seenWords.entries()].filter(([key]) => !clickedWords.has(key)).map(([, v]) => v);

  if (!toLearn.length && !passive.length) {
    if (statusEl) statusEl.textContent = 'Nothing new to sync';
    return;
  }
  if (statusEl) statusEl.textContent = 'Syncing…';
  try {
    await sendMsg('SYNC_READING_PAGE', { toLearn, passive });
    if (statusEl) statusEl.textContent = `Saved ${toLearn.length} to learn, ${passive.length} passive`;
    clickedWords.clear();
    seenWords.clear();
    for (const span of wrappedSpans) span.classList.remove('lex-clicked');
  } catch (err) {
    if (statusEl) statusEl.textContent = `Sync failed: ${err.message}`;
  }
}

// Best-effort: fires on navigation/tab-close so words aren't silently lost
// if the user never presses Stop. Not guaranteed to finish (the page is
// already tearing down), but the 4s debounce in scheduleAutoSync usually
// means most clicks are already synced by the time this fires.
window.addEventListener('beforeunload', () => {
  if (active && (clickedWords.size || seenWords.size)) syncNow();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TOGGLE_READING_MODE') {
    (async () => {
      if (active) deactivateReadingMode();
      else await activateReadingMode();
      sendResponse({ ok: true, active });
    })();
    return true;
  }
  if (msg.type === 'GET_READING_MODE_STATE') {
    sendResponse({ ok: true, active });
    return false;
  }
  return false;
});
