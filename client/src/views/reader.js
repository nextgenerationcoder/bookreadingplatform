import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';
import { showPopupFor, hidePopup } from '../popup.js';
import { findSeparableCompounds } from '../separableVerbs.js';

const TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’-]+|[^A-Za-zÀ-ÖØ-öø-ÿ'’-]+/g;
const NO_GLOSS = 'Not yet in the dictionary.';

export async function renderReader(host, bookId) {
  host.innerHTML = '<div class="loading">Loading book…</div>';

  let book, dictionary, clickedWords;
  try {
    const [bookData, dict, clicksRaw] = await Promise.all([
      api.getBook(bookId),
      getDictionary(),
      api.getWordClicks().catch(() => ({})),
    ]);
    book = bookData;
    dictionary = dict;
    clickedWords = Object.fromEntries(
      Object.entries(clicksRaw).map(([w, v]) => [normalizeWord(w), v.count])
    );
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load the book. Make sure the server is running.<br><small>${err.message}</small></div>`;
    return;
  }

  let pageIndex = 0;
  try {
    const savedProgress = await api.getProgress(bookId).catch(() => null);
    if (savedProgress?.page) {
      const idx = book.pages.findIndex((p) => p.page === savedProgress.page);
      if (idx >= 0) pageIndex = idx;
    }
  } catch {
    // ignore, start from page 0
  }

  function normalize(word) {
    return normalizeWord(word);
  }
  function glossFor(word) {
    return dictionary[normalize(word)] || NO_GLOSS;
  }

  host.innerHTML = `
    <div class="toolbar">
      <a class="backLink" href="#/">← Library</a>
      <button id="prev">← Previous</button>
      <button id="next">Next →</button>
      <span id="pageIndicator"></span>
      <a id="editPageLink" class="backLink" href="#">Edit page</a>
    </div>
    <div class="hint">Tap any German word to see its meaning. Words you tap are saved automatically.</div>
    <div id="pageHost"></div>
  `;

  const prevBtn = host.querySelector('#prev');
  const nextBtn = host.querySelector('#next');
  const indicator = host.querySelector('#pageIndicator');
  const editPageLink = host.querySelector('#editPageLink');
  const pageHost = host.querySelector('#pageHost');

  function go(delta) {
    const next = pageIndex + delta;
    if (next < 0 || next >= book.pages.length) return;
    pageIndex = next;
    renderPage();
  }

  function onKeydown(e) {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  }
  document.addEventListener('keydown', onKeydown);
  // Reader views are replaced wholesale on navigation, so drop the listener
  // once this host is no longer in the document to avoid stacking handlers.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(host)) {
      document.removeEventListener('keydown', onKeydown);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function renderPage() {
    const page = book.pages[pageIndex];
    prevBtn.disabled = pageIndex === 0;
    nextBtn.disabled = pageIndex === book.pages.length - 1;
    const first = book.pages[0].page;
    const last = book.pages[book.pages.length - 1].page;
    indicator.textContent = `Page ${page.page} of ${first}–${last}`;
    editPageLink.href = `#/book/${encodeURIComponent(bookId)}/page/${page.page}/edit`;

    pageHost.innerHTML = '';
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

    pageHost.appendChild(section);
    window.scrollTo({ top: 0, behavior: 'instant' });
    hidePopup();

    api.setProgress(bookId, page.page).catch(() => {});
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

    // "teilte ... aus" -> austeilen: a separable-prefix verb split across the
    // clause. Detected generically (see separableVerbs.js), not per-sentence.
    const compoundByIndex = new Map();
    for (const compound of findSeparableCompounds(tokens, dictionary)) {
      const groupId = `${sentence.num}-${compound.prefixIndex}`;
      compoundByIndex.set(compound.verbIndex, { ...compound, groupId });
      compoundByIndex.set(compound.prefixIndex, { ...compound, groupId });
    }

    tokens.forEach((token, index) => {
      if (/^[A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/.test(token)) {
        const compound = compoundByIndex.get(index);
        const effectiveWord = compound ? compound.infinitive : token;

        const span = document.createElement('span');
        span.className = 'word';
        if (compound) {
          span.classList.add('compoundPart');
          span.dataset.compoundGroup = compound.groupId;
          span.title = `Separable verb: ${compound.infinitive}`;
        }
        if (clickedWords[normalize(effectiveWord)]) span.classList.add('learned');
        span.dataset.word = effectiveWord;
        span.dataset.gloss = compound ? compound.gloss : glossFor(token);
        span.dataset.page = pageNum;
        span.textContent = token;
        span.addEventListener('click', onWordClick);
        de.appendChild(span);
      } else {
        de.appendChild(document.createTextNode(token));
      }
    });
    article.appendChild(de);

    const fa = document.createElement('p');
    fa.className = 'fa';
    fa.dir = 'rtl';
    fa.textContent = sentence.fa;
    article.appendChild(fa);

    return article;
  }

  async function onWordClick(e) {
    e.stopPropagation();
    const el = e.currentTarget;
    const word = el.dataset.word;
    const key = normalize(word);
    const knownGloss = el.dataset.gloss;

    if (knownGloss === NO_GLOSS) {
      showPopupFor(el, word, 'Looking up…');
      try {
        const { gloss } = await api.lookupWord(word);
        dictionary[key] = gloss;
        pageHost.querySelectorAll(`.word[data-word="${CSS.escape(word)}"]`).forEach((span) => {
          span.dataset.gloss = gloss;
        });
        showPopupFor(el, word, gloss);
      } catch {
        showPopupFor(el, word, NO_GLOSS);
      }
    } else {
      showPopupFor(el, word, knownGloss);
    }

    clickedWords[key] = (clickedWords[key] || 0) + 1;
    el.classList.add('learned');

    // Both halves of a separable verb share one dataset.word (the resolved
    // infinitive), so mark the other half learned too and highlight the pair.
    if (el.dataset.compoundGroup) {
      el.closest('.sentence')
        ?.querySelectorAll(`.word[data-compound-group="${el.dataset.compoundGroup}"]`)
        .forEach((span) => span.classList.add('learned', 'compoundActive'));
    }

    api.recordWordClick(bookId, Number(el.dataset.page), word).catch(() => {});
  }

  prevBtn.onclick = () => go(-1);
  nextBtn.onclick = () => go(1);
  renderPage();
}
