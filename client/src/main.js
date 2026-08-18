import './style.css';
import { api } from './api.js';

const BOOK_ID = 'laurie-saunders';
const TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’-]+|[^A-Za-zÀ-ÖØ-öø-ÿ'’-]+/g;
const NO_GLOSS = 'ترجمهٔ این واژه هنوز در واژه‌نامه وارد نشده است.';

const app = document.getElementById('app');

let book = null;
let dictionary = {};
let clickedWords = {}; // word -> count, for "already learning" highlight
let pageIndex = 0;

function normalizeWord(word) {
  return word.toLowerCase();
}

function glossFor(word) {
  return dictionary[normalizeWord(word)] || NO_GLOSS;
}

async function init() {
  app.innerHTML = '<div class="loading">در حال بارگذاری کتاب…</div>';
  try {
    const [bookData, dict] = await Promise.all([api.getBook(BOOK_ID), api.getDictionary()]);
    book = bookData;
    dictionary = dict;

    let savedProgress = null;
    try {
      savedProgress = await api.getProgress(BOOK_ID);
    } catch {
      savedProgress = null;
    }
    if (savedProgress?.page) {
      const idx = book.pages.findIndex((p) => p.page === savedProgress.page);
      if (idx >= 0) pageIndex = idx;
    }

    try {
      const all = await api.getWordClicks();
      clickedWords = Object.fromEntries(
        Object.entries(all).map(([w, v]) => [normalizeWord(w), v.count])
      );
    } catch {
      clickedWords = {};
    }

    buildShell();
    renderPage();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="error">بارگذاری کتاب با خطا مواجه شد. مطمئن شوید سرور در حال اجراست.<br><small>${err.message}</small></div>`;
  }
}

function buildShell() {
  app.innerHTML = `
    <div class="toolbar">
      <button id="prev">← صفحه قبل</button>
      <button id="next">صفحه بعد →</button>
      <span id="pageIndicator"></span>
    </div>
    <div class="hint" dir="rtl">روی هر کلمهٔ آلمانی بزن تا معنی آن باز شود. کلمه‌هایی که می‌زنی به‌صورت خودکار ذخیره می‌شوند و پیشرفت مطالعه‌ات هم روی حساب کاربری‌ات نگه داشته می‌شود.</div>
    <div id="pageHost"></div>
  `;
  document.getElementById('prev').onclick = () => go(-1);
  document.getElementById('next').onclick = () => go(1);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onGlobalClick);
}

function onKeydown(e) {
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === 'ArrowRight') go(1);
  if (e.key === 'Escape') hidePopup();
}

function go(delta) {
  const next = pageIndex + delta;
  if (next < 0 || next >= book.pages.length) return;
  pageIndex = next;
  renderPage();
}

function renderPage() {
  const page = book.pages[pageIndex];
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const indicator = document.getElementById('pageIndicator');
  prev.disabled = pageIndex === 0;
  next.disabled = pageIndex === book.pages.length - 1;
  const first = book.pages[0].page;
  const last = book.pages[book.pages.length - 1].page;
  indicator.textContent = `صفحه ${page.page} از ${first}–${last}`;

  const host = document.getElementById('pageHost');
  host.innerHTML = '';
  const section = document.createElement('section');
  section.className = 'page';

  const header = document.createElement('header');
  header.className = 'pageHeader';
  header.innerHTML = `<span>${page.chapter || ''}</span><strong>Seite ${page.page}</strong>`;
  section.appendChild(header);

  let lastChapter = page.chapter;
  for (const sentence of page.sentences) {
    if (sentence.chapter && sentence.chapter !== lastChapter) {
      const divider = document.createElement('div');
      divider.className = 'chapterDivider';
      divider.textContent = sentence.chapter;
      section.appendChild(divider);
      lastChapter = sentence.chapter;
    }
    section.appendChild(renderSentence(sentence, page.page));
  }

  host.appendChild(section);
  window.scrollTo({ top: 0, behavior: 'instant' });
  hidePopup();

  api.setProgress(BOOK_ID, page.page).catch(() => {});
}

function renderSentence(sentence, pageNum) {
  const article = document.createElement('article');
  article.className = 'sentence';

  const num = document.createElement('div');
  num.className = 'num';
  num.textContent = sentence.num;
  article.appendChild(num);

  const de = document.createElement('p');
  de.className = 'de';
  const tokens = sentence.de.match(TOKEN_RE) || [];
  for (const token of tokens) {
    if (/^[A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/.test(token)) {
      const span = document.createElement('span');
      span.className = 'word';
      if (clickedWords[normalizeWord(token)]) span.classList.add('learned');
      span.dataset.word = token;
      span.dataset.gloss = glossFor(token);
      span.dataset.page = pageNum;
      span.textContent = token;
      de.appendChild(span);
    } else {
      de.appendChild(document.createTextNode(token));
    }
  }
  article.appendChild(de);

  const fa = document.createElement('p');
  fa.className = 'fa';
  fa.dir = 'rtl';
  fa.textContent = sentence.fa;
  article.appendChild(fa);

  return article;
}

let popupEl = null;
function ensurePopup() {
  if (popupEl) return popupEl;
  popupEl = document.createElement('div');
  popupEl.id = 'popup';
  popupEl.className = 'popup';
  popupEl.setAttribute('role', 'dialog');
  popupEl.setAttribute('aria-live', 'polite');
  popupEl.innerHTML = '<div class="w" id="popupWord"></div><div class="g" id="popupGloss"></div>';
  document.body.appendChild(popupEl);
  return popupEl;
}

function hidePopup() {
  if (popupEl) popupEl.classList.remove('show');
}

function onGlobalClick(e) {
  const w = e.target.closest('.word');
  if (!w) {
    if (!e.target.closest('#popup')) hidePopup();
    return;
  }
  e.stopPropagation();

  const popup = ensurePopup();
  document.getElementById('popupWord').textContent = w.dataset.word;
  document.getElementById('popupGloss').textContent = w.dataset.gloss;
  popup.classList.add('show');

  const r = w.getBoundingClientRect();
  const pr = popup.getBoundingClientRect();
  let left = Math.min(window.innerWidth - pr.width - 12, Math.max(12, r.left + r.width / 2 - pr.width / 2));
  let top = r.bottom + 10;
  if (top + pr.height > window.innerHeight - 10) top = Math.max(10, r.top - pr.height - 10);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  const key = normalizeWord(w.dataset.word);
  clickedWords[key] = (clickedWords[key] || 0) + 1;
  w.classList.add('learned');
  api.recordWordClick(BOOK_ID, Number(w.dataset.page), w.dataset.word).catch(() => {});
}

init();
