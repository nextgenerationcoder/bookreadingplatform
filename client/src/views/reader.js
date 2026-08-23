import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';
import { showPopupFor, hidePopup } from '../popup.js';
import { findSeparableCompounds } from '../separableVerbs.js';

const TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’-]+|[^A-Za-zÀ-ÖØ-öø-ÿ'’-]+/g;
const NO_GLOSS = 'Not yet in the dictionary.';

// kind: 'book' (default) or 'course' - courses live in their own tables
// server-side but read identically (word clicks/progress/TTS/dictionary all
// key off the same generic content id either way).
export async function renderReader(host, bookId, kind = 'book') {
  const isCourse = kind === 'course';
  const getContent = isCourse ? api.getCourse : api.getBook;
  const backHref = isCourse ? '#/courses' : '#/';
  const backLabel = isCourse ? '← Courses' : '← Library';
  const editPageBase = isCourse ? `#/course/${encodeURIComponent(bookId)}` : `#/book/${encodeURIComponent(bookId)}`;

  host.innerHTML = '<div class="loading">Loading…</div>';

  let book, dictionary, clickedWords;
  try {
    const [bookData, dict, clicksRaw] = await Promise.all([
      getContent(bookId),
      getDictionary(),
      api.getWordClicks().catch(() => ({})),
    ]);
    book = bookData;
    dictionary = dict;
    clickedWords = Object.fromEntries(
      Object.entries(clicksRaw).map(([w, v]) => [normalizeWord(w), v.count])
    );
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load. Make sure the server is running.<br><small>${err.message}</small></div>`;
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
      <a class="backLink" href="${backHref}">${backLabel}</a>
      <button id="prev">← Previous</button>
      <button id="next">Next →</button>
      <span id="pageIndicator"></span>
      <a id="editPageLink" class="backLink" href="#">Edit page</a>
    </div>
    <div class="ttsBar">
      <button id="playPauseBtn" type="button">▶ Play</button>
      <button id="prevSentenceBtn" type="button" title="Previous sentence">⏮</button>
      <button id="nextSentenceBtn" type="button" title="Next sentence">⏭</button>
      <span id="ttsStatus" class="importStatus"></span>
    </div>
    <div class="hint">Tap any German word to see its meaning. Words you tap are saved automatically.</div>
    <div id="pageHost"></div>
  `;

  const prevBtn = host.querySelector('#prev');
  const nextBtn = host.querySelector('#next');
  const indicator = host.querySelector('#pageIndicator');
  const editPageLink = host.querySelector('#editPageLink');
  const pageHost = host.querySelector('#pageHost');
  const playPauseBtn = host.querySelector('#playPauseBtn');
  const prevSentenceBtn = host.querySelector('#prevSentenceBtn');
  const nextSentenceBtn = host.querySelector('#nextSentenceBtn');
  const ttsStatus = host.querySelector('#ttsStatus');

  // --- Read Aloud (Piper TTS) state ---------------------------------------
  // Word timing is estimated server-side (proportional to word length, not
  // true phoneme alignment), so highlighting is close but not frame-exact.
  let speaking = false;
  let currentSentenceIndex = 0;
  let audioEl = null;
  let currentWordSpans = [];
  let currentTimings = [];
  let speakToken = 0;

  function getSentenceEls() {
    return [...pageHost.querySelectorAll('.sentence')];
  }

  function updatePlayButton() {
    playPauseBtn.textContent = speaking ? '⏸ Pause' : '▶ Play';
  }

  function stopAudio() {
    speakToken++;
    if (audioEl) {
      audioEl.pause();
      audioEl.onended = null;
      audioEl.ontimeupdate = null;
      audioEl.onerror = null;
      audioEl = null;
    }
    currentWordSpans.forEach((span) => span?.classList.remove('speaking'));
    currentWordSpans = [];
    currentTimings = [];
  }

  // Crosses into the previous/next page (re-rendering it) when index runs
  // past the current page's sentences, returning the resolved in-page
  // index, or null if there's no more book in that direction.
  function resolveSentencePosition(index) {
    const sentences = book.pages[pageIndex].sentences;
    if (index < 0) {
      if (pageIndex === 0) return null;
      pageIndex -= 1;
      renderPage();
      return book.pages[pageIndex].sentences.length - 1;
    }
    if (index >= sentences.length) {
      if (pageIndex >= book.pages.length - 1) return null;
      pageIndex += 1;
      renderPage();
      return 0;
    }
    return index;
  }

  async function playSentenceAudio(index) {
    const myToken = speakToken;
    const sentence = book.pages[pageIndex].sentences[index];
    const article = getSentenceEls()[index];
    if (!article || !sentence) {
      speaking = false;
      updatePlayButton();
      return;
    }

    ttsStatus.textContent = 'Loading audio…';
    ttsStatus.className = 'importStatus';
    let result;
    try {
      result = await api.synthesize(sentence.de);
    } catch (err) {
      if (myToken !== speakToken) return;
      ttsStatus.textContent = `Couldn't read this sentence: ${err.message}`;
      ttsStatus.className = 'importStatus error';
      speaking = false;
      updatePlayButton();
      return;
    }
    if (myToken !== speakToken) return;
    ttsStatus.textContent = '';

    const wordSpans = [...article.querySelectorAll('.word')];
    currentWordSpans = wordSpans;
    currentTimings = result.timings;

    const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    audioEl = new Audio(url);

    audioEl.ontimeupdate = () => {
      if (myToken !== speakToken) return;
      const t = audioEl.currentTime;
      wordSpans.forEach((span, i) => {
        const timing = currentTimings[i];
        span.classList.toggle('speaking', Boolean(timing && t >= timing.start && t < timing.end));
      });
    };
    audioEl.onended = () => {
      URL.revokeObjectURL(url);
      if (myToken !== speakToken) return;
      goToSentence(currentSentenceIndex + 1, { autoplay: true });
    };
    audioEl.onerror = () => {
      if (myToken !== speakToken) return;
      ttsStatus.textContent = 'Playback error.';
      ttsStatus.className = 'importStatus error';
      speaking = false;
      updatePlayButton();
    };

    try {
      await audioEl.play();
    } catch {
      // Autoplay can be blocked by the browser in some contexts; the user
      // can just press Play again.
    }
  }

  function goToSentence(index, { autoplay }) {
    stopAudio();
    const resolved = resolveSentencePosition(index);
    if (resolved === null) {
      speaking = false;
      updatePlayButton();
      return;
    }
    currentSentenceIndex = resolved;
    getSentenceEls()[resolved]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (autoplay) {
      speaking = true;
      updatePlayButton();
      playSentenceAudio(resolved);
    }
  }

  playPauseBtn.onclick = () => {
    if (speaking) {
      speaking = false;
      audioEl?.pause();
      updatePlayButton();
    } else if (audioEl) {
      speaking = true;
      updatePlayButton();
      audioEl.play().catch(() => {});
    } else {
      goToSentence(currentSentenceIndex, { autoplay: true });
    }
  };
  prevSentenceBtn.onclick = () => goToSentence(currentSentenceIndex - 1, { autoplay: speaking });
  nextSentenceBtn.onclick = () => goToSentence(currentSentenceIndex + 1, { autoplay: speaking });
  // ------------------------------------------------------------------------

  function go(delta) {
    const next = pageIndex + delta;
    if (next < 0 || next >= book.pages.length) return;
    stopAudio();
    speaking = false;
    updatePlayButton();
    pageIndex = next;
    currentSentenceIndex = 0;
    renderPage();
  }

  function onKeydown(e) {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  }
  document.addEventListener('keydown', onKeydown);
  // Reader views are replaced wholesale on navigation, so drop the listener
  // (and stop any in-progress narration - an <audio> element keeps playing
  // in the background otherwise, since it isn't attached to the DOM) once
  // this host is no longer in the document.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(host)) {
      document.removeEventListener('keydown', onKeydown);
      stopAudio();
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
    editPageLink.href = `${editPageBase}/page/${page.page}/edit`;

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
