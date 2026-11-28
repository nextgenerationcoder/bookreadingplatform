import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';
import { showPopupFor, hidePopup } from '../popup.js';
import { findSeparableCompounds, SEPARABLE_PREFIX_SET, likelyInfinitive } from '../separableVerbs.js';
import { showWordMenu, showTranslationPicker, closeTranslationPicker, showVerbLinkPicker, closeVerbLinkPicker, showPatternConfirm, closePatternConfirm } from '../wordMenu.js';
import { applyClickableTextInsideFrame } from './worksheets.js';

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

  let book, dictionary, clickedWords, vocabStatus;
  try {
    const [bookData, dict, clicksRaw, vocab] = await Promise.all([
      getContent(bookId),
      getDictionary(),
      api.getWordClicks().catch(() => ({})),
      api.getVocabProgress().catch(() => ({ words: [] })),
    ]);
    book = bookData;
    dictionary = dict;
    clickedWords = Object.fromEntries(
      Object.entries(clicksRaw).map(([w, v]) => [normalizeWord(w), v.count])
    );
    // Passive is shown the same as learned (green) - both mean "you know
    // this", just via different evidence (passed a page without needing
    // help vs. answered correctly enough times in a lesson). Only
    // 'learning' (orange) and no entry at all (gray, never encountered)
    // are visually distinct - see the .wordKnown/.wordLearning/.wordUnset
    // rules in style.css.
    vocabStatus = Object.fromEntries(vocab.words.map((w) => [normalizeWord(w.german), w.status]));
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load. Make sure the server is running.<br><small>${err.message}</small></div>`;
    return;
  }

  let pageIndex = 0;
  // Reset per page (in renderPage()). wordIndexCounter gives every .word
  // span on the page a stable left-to-right position; lastCommittedIndex
  // is the furthest position reached by a click so far, so clicking a word
  // can commit everything *read past* to get there as passive/green - see
  // onWordClick's incremental commit below. Finish Page still separately
  // covers the tail beyond the last click through the end of the page.
  let wordIndexCounter = 0;
  let lastCommittedIndex = -1;
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

  // Tri-color word status, independent of the "ever clicked" (.learned)
  // flag below: green (wordKnown) for learned/passive - both mean "you
  // know this", just via different evidence - orange (wordLearning) for
  // actively being worked on, gray (wordUnset) for a word with no
  // vocab_progress entry at all yet.
  function applyWordColor(span, key) {
    span.classList.remove('wordKnown', 'wordLearning', 'wordUnset');
    const status = vocabStatus[key];
    if (status === 'learned' || status === 'passive') span.classList.add('wordKnown');
    else if (status === 'learning') span.classList.add('wordLearning');
    else span.classList.add('wordUnset');
  }

  host.innerHTML = `
    <div class="toolbar">
      <a class="backLink" href="${backHref}">${backLabel}</a>
      <button id="prev">← Previous</button>
      <button id="next">Next →</button>
      <span id="pageIndicator"></span>
      <form id="gotoPageForm" class="gotoPageForm">
        <input type="number" id="gotoPageInput" inputmode="numeric" placeholder="Page #" aria-label="Go to page" />
        <button type="submit">Go</button>
      </form>
      <a id="editPageLink" class="backLink" href="#">Edit page</a>
    </div>
    <div id="gotoPageStatus" class="importStatus error" hidden></div>
    <div class="ttsBar">
      <button id="playPauseBtn" type="button">▶ Play</button>
      <button id="prevSentenceBtn" type="button" title="Previous sentence">⏮</button>
      <button id="nextSentenceBtn" type="button" title="Next sentence">⏭</button>
      <span id="ttsStatus" class="importStatus"></span>
    </div>
    <div class="ttsBar trackPlayerBar" id="trackPlayerBar" hidden>
      <button id="prevTrackBtn" type="button" title="Previous lesson">⏮ Lesson</button>
      <button id="trackBack10Btn" type="button" title="Back 10 seconds">−10s</button>
      <button id="prevChunkBtn" type="button" title="Previous chunk" hidden>⏮ Chunk</button>
      <button id="trackPlayPauseBtn" type="button">▶ Play</button>
      <button id="nextChunkBtn" type="button" title="Next chunk" hidden>Chunk ⏭</button>
      <button id="trackFwd10Btn" type="button" title="Forward 10 seconds">+10s</button>
      <button id="nextTrackBtn" type="button" title="Next lesson">Lesson ⏭</button>
      <input type="range" id="trackSeek" class="trackSeek" min="0" max="0" value="0" step="1">
      <span id="trackTime" class="importStatus">0:00 / 0:00</span>
      <button id="shadowingToggleBtn" type="button" title="Listen to one small chunk at a time, with a pause to repeat it out loud">🗣 Shadowing</button>
    </div>
    <div class="shadowingBar" id="shadowingBar" hidden>
      <span id="shadowingChunkText" class="shadowingChunkText"></span>
      <span id="shadowingStatus" class="importStatus"></span>
    </div>
    <div class="hint" id="wordHint">Tap any German word to see its meaning. Words you tap are saved automatically.</div>
    <div id="pageHost"></div>
    <div class="pageFinishBar" id="pageFinishBar">
      <button id="finishPageBtn" type="button">✓ Finish Page</button>
      <span id="finishPageStatus" class="importStatus"></span>
    </div>
  `;

  const prevBtn = host.querySelector('#prev');
  const nextBtn = host.querySelector('#next');
  const indicator = host.querySelector('#pageIndicator');
  const gotoPageForm = host.querySelector('#gotoPageForm');
  const gotoPageInput = host.querySelector('#gotoPageInput');
  const gotoPageStatus = host.querySelector('#gotoPageStatus');
  const editPageLink = host.querySelector('#editPageLink');
  const pageHost = host.querySelector('#pageHost');
  const wordHint = host.querySelector('#wordHint');
  const ttsBar = host.querySelector('.ttsBar');
  const pageFinishBar = host.querySelector('#pageFinishBar');
  const playPauseBtn = host.querySelector('#playPauseBtn');
  const prevSentenceBtn = host.querySelector('#prevSentenceBtn');
  const nextSentenceBtn = host.querySelector('#nextSentenceBtn');
  const ttsStatus = host.querySelector('#ttsStatus');
  const finishPageBtn = host.querySelector('#finishPageBtn');
  const finishPageStatus = host.querySelector('#finishPageStatus');
  const trackPlayerBar = host.querySelector('#trackPlayerBar');
  const prevTrackBtn = host.querySelector('#prevTrackBtn');
  const trackBack10Btn = host.querySelector('#trackBack10Btn');
  const trackPlayPauseBtn = host.querySelector('#trackPlayPauseBtn');
  const trackFwd10Btn = host.querySelector('#trackFwd10Btn');
  const nextTrackBtn = host.querySelector('#nextTrackBtn');
  const prevChunkBtn = host.querySelector('#prevChunkBtn');
  const nextChunkBtn = host.querySelector('#nextChunkBtn');
  const trackSeek = host.querySelector('#trackSeek');
  const trackTime = host.querySelector('#trackTime');
  const shadowingToggleBtn = host.querySelector('#shadowingToggleBtn');
  const shadowingBar = host.querySelector('#shadowingBar');
  const shadowingChunkText = host.querySelector('#shadowingChunkText');
  const shadowingStatus = host.querySelector('#shadowingStatus');

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

  // --- Narration track player (a real pre-recorded MP3 attached to a
  // course page - see courseImporter.js's course_pages.audio - independent
  // of the Piper TTS above, which synthesizes speech from the page's own
  // .de/.fa sentences and has nothing to read for an HTML-type page). -----
  let trackAudioEl = null;
  let trackSeeking = false;
  // Set by goTrack() right before go() re-renders the next/previous page -
  // tells renderPage() whether to start that page's track playing right
  // away (continuous listening across lessons) - the plain page Next/
  // Previous buttons also call go() but never set this, so they only ever
  // stop playback, never start it on the new page.
  let pendingTrackAutoplay = false;

  function formatTrackTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function stopTrackAudio() {
    if (trackAudioEl) {
      trackAudioEl.pause();
      trackAudioEl.src = '';
      trackAudioEl.ontimeupdate = null;
      trackAudioEl.onloadedmetadata = null;
      trackAudioEl.onended = null;
      trackAudioEl.onerror = null;
      trackAudioEl = null;
    }
    trackPlayPauseBtn.textContent = '▶ Play';
    trackSeek.value = '0';
    trackTime.textContent = '0:00 / 0:00';
  }

  function setupTrackAudio(page, { autoplay } = {}) {
    stopTrackAudio();
    trackAudioEl = new Audio(api.coursePageAudioUrl(bookId, page.page));

    trackAudioEl.onloadedmetadata = () => {
      trackSeek.max = String(Math.floor(trackAudioEl.duration) || 0);
      trackTime.textContent = `${formatTrackTime(trackAudioEl.currentTime)} / ${formatTrackTime(trackAudioEl.duration)}`;
    };
    trackAudioEl.ontimeupdate = () => {
      if (!trackSeeking) trackSeek.value = String(Math.floor(trackAudioEl.currentTime));
      trackTime.textContent = `${formatTrackTime(trackAudioEl.currentTime)} / ${formatTrackTime(trackAudioEl.duration)}`;
    };
    trackAudioEl.onended = () => {
      trackPlayPauseBtn.textContent = '▶ Play';
    };
    trackAudioEl.onerror = () => {
      trackTime.textContent = 'Playback error.';
    };

    if (autoplay) {
      trackAudioEl
        .play()
        .then(() => { trackPlayPauseBtn.textContent = '⏸ Pause'; })
        .catch(() => {}); // autoplay can be blocked; the learner can press Play
    }
  }

  trackPlayPauseBtn.onclick = () => {
    if (!trackAudioEl) return;
    if (trackAudioEl.paused) {
      trackAudioEl.play().then(() => { trackPlayPauseBtn.textContent = '⏸ Pause'; }).catch(() => {});
    } else {
      trackAudioEl.pause();
      trackPlayPauseBtn.textContent = '▶ Play';
    }
  };
  trackBack10Btn.onclick = () => {
    if (trackAudioEl) trackAudioEl.currentTime = Math.max(0, trackAudioEl.currentTime - 10);
  };
  trackFwd10Btn.onclick = () => {
    if (trackAudioEl) trackAudioEl.currentTime = Math.min(trackAudioEl.duration || Infinity, trackAudioEl.currentTime + 10);
  };
  trackSeek.addEventListener('input', () => {
    trackSeeking = true;
    if (trackAudioEl) trackTime.textContent = `${formatTrackTime(Number(trackSeek.value))} / ${formatTrackTime(trackAudioEl.duration)}`;
  });
  trackSeek.addEventListener('change', () => {
    if (trackAudioEl) trackAudioEl.currentTime = Number(trackSeek.value);
    trackSeeking = false;
  });

  // "Next/Previous lesson": like the plain page Next/Previous buttons, but
  // remembers whether the track was playing so the new lesson's track picks
  // up immediately instead of needing a separate tap on Play.
  function goTrack(delta) {
    pendingTrackAutoplay = Boolean(trackAudioEl && !trackAudioEl.paused);
    go(delta);
  }
  prevTrackBtn.onclick = () => goTrack(-1);
  nextTrackBtn.onclick = () => goTrack(1);

  // --- Shadowing mode: swaps the player's source to a real, pre-rendered
  // "Shadowing practice" MP3 (see shadowingAudioBuilder.js on the server -
  // real silence and real time-stretched short chunks baked into the
  // audio itself via ffmpeg, a direct port of the user's own
  // shadowing_pipeline.py) and reuses the exact same Play/Pause/±10s/seek
  // controls already wired to trackAudioEl, rather than live-pausing the
  // original track from JS. Rendering happens server-side on the first
  // request for a page (slow - one ffmpeg call per chunk) and is cached
  // after that, so stay in the "rendering…" state until canplay fires.
  let shadowingActive = false;
  let normalTrackUrl = null;
  let shadowingLoadHandlers = null;

  function clearShadowingLoadHandlers() {
    if (!trackAudioEl || !shadowingLoadHandlers) return;
    trackAudioEl.removeEventListener('canplay', shadowingLoadHandlers.onCanPlay);
    trackAudioEl.removeEventListener('error', shadowingLoadHandlers.onError);
    shadowingLoadHandlers = null;
  }

  function stopShadowing() {
    if (!shadowingActive) return;
    shadowingActive = false;
    clearShadowingLoadHandlers();
    shadowingToggleBtn.textContent = '🗣 Shadowing';
    shadowingToggleBtn.disabled = false;
    shadowingBar.hidden = true;
    shadowingStatus.textContent = '';
    if (trackAudioEl && normalTrackUrl) {
      trackAudioEl.pause();
      trackAudioEl.src = normalTrackUrl;
      trackAudioEl.load();
      trackPlayPauseBtn.textContent = '▶ Play';
    }
  }

  function toggleShadowing() {
    if (shadowingActive) {
      stopShadowing();
      return;
    }
    if (!trackAudioEl) return;
    const page = book.pages[pageIndex];
    normalTrackUrl = trackAudioEl.src;
    shadowingActive = true;
    shadowingToggleBtn.textContent = '⏹ Stop shadowing';
    shadowingToggleBtn.disabled = true;
    shadowingBar.hidden = false;
    shadowingChunkText.textContent = '';
    shadowingStatus.textContent = 'Preparing the shadowing track… this can take a while the first time.';

    trackAudioEl.pause();
    trackAudioEl.src = api.courseShadowingAudioUrl(bookId, page.page);
    trackAudioEl.load();

    clearShadowingLoadHandlers();
    const onCanPlay = () => {
      clearShadowingLoadHandlers();
      shadowingStatus.textContent = '';
      shadowingToggleBtn.disabled = false;
      trackAudioEl.play().then(() => { trackPlayPauseBtn.textContent = '⏸ Pause'; }).catch(() => {});
    };
    const onError = () => {
      clearShadowingLoadHandlers();
      shadowingStatus.textContent = 'Could not build/load the shadowing track.';
      shadowingToggleBtn.disabled = false;
    };
    shadowingLoadHandlers = { onCanPlay, onError };
    trackAudioEl.addEventListener('canplay', onCanPlay, { once: true });
    trackAudioEl.addEventListener('error', onError, { once: true });
  }
  shadowingToggleBtn.onclick = toggleShadowing;

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
    stopTrackAudio();
    stopShadowing();
    speaking = false;
    updatePlayButton();
    pageIndex = next;
    currentSentenceIndex = 0;
    renderPage();
  }

  // Page numbers aren't guaranteed contiguous (a book can be missing pages),
  // so this looks up the matching entry rather than assuming pageNumber ===
  // pageIndex + first-page-offset.
  function goToPage(pageNumber) {
    const next = book.pages.findIndex((p) => p.page === pageNumber);
    if (next === -1) {
      gotoPageStatus.textContent = `No page ${pageNumber} in this book.`;
      gotoPageStatus.hidden = false;
      return;
    }
    gotoPageStatus.hidden = true;
    stopAudio();
    stopTrackAudio();
    stopShadowing();
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
      stopTrackAudio();
      stopShadowing();
      closeTranslationPicker();
      closeVerbLinkPicker();
      closePatternConfirm();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function renderPage() {
    closeTranslationPicker();
    closeVerbLinkPicker();
    closePatternConfirm();
    const page = book.pages[pageIndex];
    prevBtn.disabled = pageIndex === 0;
    nextBtn.disabled = pageIndex === book.pages.length - 1;
    prevTrackBtn.disabled = pageIndex === 0;
    nextTrackBtn.disabled = pageIndex === book.pages.length - 1;
    const first = book.pages[0].page;
    const last = book.pages[book.pages.length - 1].page;
    indicator.textContent = `Page ${page.page} of ${first}–${last}`;
    editPageLink.href = `${editPageBase}/page/${page.page}/edit`;
    // No min/max constraint attributes here on purpose - those trigger the
    // browser's native validation, which silently blocks form submission
    // for an out-of-range value before goToPage() ever runs, so the "No
    // page N in this book" message below never gets a chance to show.
    gotoPageInput.placeholder = `Page # (${first}–${last})`;
    gotoPageInput.value = '';
    gotoPageStatus.hidden = true;

    pageHost.innerHTML = '';
    wordIndexCounter = 0;
    lastCommittedIndex = -1;
    // Hidden up front, not just left over from the previous page - the new
    // Hören page's own load handler (wireUpHoerenNav) re-shows them once it
    // can see whether THIS page actually has chunks, which only happens
    // once the iframe finishes loading a moment later.
    prevChunkBtn.hidden = true;
    nextChunkBtn.hidden = true;

    // An HTML-type course page (see courseImporter.js's course_pages.html
    // comment) has no .word spans / sentences of its own to read aloud or
    // "Finish Page" over - it's shown in an iframe instead, same as a
    // worksheet, with the same clickable-word/"Notiz"/"Extract pattern"
    // interactivity (see renderHtmlCoursePage below).
    const isHtmlPage = isCourse && Boolean(page.html);
    ttsBar.hidden = isHtmlPage;
    wordHint.hidden = isHtmlPage;
    pageFinishBar.hidden = isHtmlPage;

    if (isHtmlPage) {
      renderHtmlCoursePage(page);
    } else {
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
    }

    trackPlayerBar.hidden = !page.hasAudio;
    if (page.hasAudio) setupTrackAudio(page, { autoplay: pendingTrackAutoplay });
    else stopTrackAudio();
    stopShadowing();
    pendingTrackAutoplay = false;

    window.scrollTo({ top: 0, behavior: 'instant' });
    hidePopup();

    finishPageStatus.textContent = '';
    finishPageStatus.className = 'importStatus';

    api.setProgress(bookId, page.page).catch(() => {});
  }

  // Shown exactly like a worksheet (same sandboxed same-origin iframe, same
  // applyClickableTextInsideFrame pass once it loads) - see
  // worksheets.js's renderWorksheetViewer for the original of this.
  function renderHtmlCoursePage(page) {
    const iframe = document.createElement('iframe');
    iframe.className = 'coursePageFrame';
    iframe.src = api.coursePageViewUrl(bookId, page.page);
    iframe.sandbox = 'allow-scripts allow-forms allow-same-origin allow-modals allow-popups';
    iframe.title = 'Course page';
    iframe.addEventListener('load', () =>
      applyClickableTextInsideFrame(iframe, {
        listNotes: () => api.listCoursePageNotes(bookId, page.page),
        createNote: (blockIndex, charOffset, text) => api.createCoursePageNote(bookId, page.page, blockIndex, charOffset, text),
        updateNote: (noteId, text) => api.updateCoursePageNoteText(bookId, page.page, noteId, text),
        deleteNote: (noteId) => api.deleteCoursePageNote(bookId, page.page, noteId),
        askAi: (question) => api.askWorksheetAi(question),
        bookId,
        vocabStatus,
      })
    );
    pageHost.appendChild(iframe);
    iframe.addEventListener('load', () => wireUpHoerenNav(iframe));
  }

  // --- Hören chunk-nav + live word highlight (see server/src/hoerenChunker.js
  // for how a page's generated HTML gets its .hoerenChunk/.hoerenWord
  // data-start/data-end attributes) - a plain HTML course page with neither
  // (an ordinary worksheet-style page, or one of the earlier Sprechen mp3
  // pages) just leaves the Chunk buttons hidden and skips the highlight
  // listener entirely, so this is safe to call on every HTML page's load.
  let hoerenCurrentWordEl = null;

  function wireUpHoerenNav(iframe) {
    let doc;
    try {
      doc = iframe.contentDocument;
    } catch {
      return;
    }
    if (!doc) return;

    const chunkStarts = [...new Set([...doc.querySelectorAll('.hoerenChunk[data-chunk-start]')].map((el) => Number(el.dataset.chunkStart)))].sort(
      (a, b) => a - b
    );
    const hasChunks = chunkStarts.length > 0 && Boolean(trackAudioEl);
    prevChunkBtn.hidden = !hasChunks;
    nextChunkBtn.hidden = !hasChunks;
    hoerenCurrentWordEl = null;
    if (!hasChunks) return;

    function seekToChunk(forward) {
      // Same reason as the highlight listener above - while Shadowing mode
      // has swapped in the rendered practice track, these boundaries (from
      // the original narration) don't correspond to real seek points in it.
      if (!trackAudioEl || shadowingActive) return;
      const t = trackAudioEl.currentTime;
      if (forward) {
        const next = chunkStarts.find((s) => s > t + 0.15);
        if (next !== undefined) trackAudioEl.currentTime = next;
      } else {
        const earlier = chunkStarts.filter((s) => s < t - 0.15);
        trackAudioEl.currentTime = earlier.length ? earlier[earlier.length - 1] : 0;
      }
    }
    prevChunkBtn.onclick = () => seekToChunk(false);
    nextChunkBtn.onclick = () => seekToChunk(true);

    const words = [...doc.querySelectorAll('.hoerenWord[data-start]')];
    if (!words.length || !trackAudioEl) return;
    trackAudioEl.addEventListener('timeupdate', () => {
      // Shadowing mode swaps trackAudioEl's src to a differently-timed
      // rendered track (see toggleShadowing) - these word timestamps are
      // only valid against the page's own original narration.
      if (!trackAudioEl || shadowingActive) return;
      const t = trackAudioEl.currentTime;
      const current = words.find((w) => t >= Number(w.dataset.start) && t < Number(w.dataset.end));
      if (current === hoerenCurrentWordEl) return;
      hoerenCurrentWordEl?.classList.remove('hoerenCurrentWord');
      current?.classList.add('hoerenCurrentWord');
      hoerenCurrentWordEl = current || null;
    });
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
        const key = normalize(effectiveWord);
        if (clickedWords[key]) span.classList.add('learned');
        applyWordColor(span, key);
        span.dataset.pageIndex = wordIndexCounter++;
        span.dataset.word = effectiveWord;
        span.dataset.gloss = compound ? (compound.gloss || NO_GLOSS) : glossFor(token);
        span.dataset.page = pageNum;
        span.textContent = token;
        span.addEventListener('click', onWordClick);
        span.addEventListener('contextmenu', onWordRightClick);
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

    // Immediate visual feedback - a click means "I don't know this", so it
    // turns orange right away rather than waiting for Finish Page to
    // persist it server-side. A word already green (learned) never gets
    // downgraded by a click, matching what Finish Page itself does
    // server-side (see routes/vocab.js's reading-page upsert).
    if (vocabStatus[key] !== 'learned') {
      vocabStatus[key] = 'learning';
      pageHost.querySelectorAll(`.word[data-word="${CSS.escape(word)}"]`).forEach((span) => applyWordColor(span, key));
    }

    // Both halves of a separable verb share one dataset.word (the resolved
    // infinitive), so mark the other half learned too and highlight the pair.
    if (el.dataset.compoundGroup) {
      el.closest('.sentence')
        ?.querySelectorAll(`.word[data-compound-group="${el.dataset.compoundGroup}"]`)
        .forEach((span) => span.classList.add('learned', 'compoundActive'));
    }

    api.recordWordClick(bookId, Number(el.dataset.page), word).catch(() => {});
    commitReadUpTo(el);
  }

  // Right-click opens a small menu (mark known / mark unknown / change
  // translation) instead of acting immediately - see wordMenu.js. A drag-
  // selection that includes the right-clicked word is used as the menu's
  // target instead of the whole word, covering two cases:
  //   - a multi-word chunk (contains a space) - can span any amount of
  //     text, even across several sentences (not restricted to this word's
  //     own .de paragraph - containsNode confirms the clicked word is part
  //     of the selection wherever it extends), since German is full of
  //     multi-word expressions worth saving as their own unit.
  //   - a SUBSTRING of just this one word (no space) - e.g. selecting
  //     "Leistung" out of "Leistungsträger" - treated like any other single
  //     word (saved to the shared dictionary), since it's a real standalone
  //     word the compound happens to contain, not a personal phrase.
  // With no matching selection, the whole clicked word is used, same as
  // before.
  function onWordRightClick(e) {
    e.preventDefault();
    const el = e.currentTarget;
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.containsNode(el, true);
    const selectedText = hasSelection ? selection.toString().trim() : '';
    const text = selectedText || el.dataset.word;
    const isPhrase = text.includes(' ');

    const items = [
      { label: 'Mark known', onClick: () => markWordKnown(el, text, isPhrase) },
      { label: 'Mark unknown', onClick: () => markWordUnknown(el, text, isPhrase) },
      { label: 'Change translation', onClick: () => startChangeTranslation(el, text, isPhrase) },
    ];
    // Only offered when no custom selection is overriding the word, and
    // it isn't already part of a detected/linked pair - separableVerbs.js's
    // automatic detector sometimes misses a split verb (irregular
    // conjugation not in its tables, or an unusual clause boundary), so
    // this lets the learner fix that case by hand.
    if (text === el.dataset.word && !el.classList.contains('compoundPart')) {
      items.push({ label: 'Link separable verb', onClick: () => startVerbLink(el, text) });
    }
    // Only for a multi-word selection - a fixed construction (verb +
    // preposition + case, an idiom) is worth generalizing into a reusable
    // pattern; a single word already has its own dictionary entry as-is.
    if (isPhrase) {
      items.push({ label: 'Extract pattern (AI)', onClick: () => startExtractPattern(el, text) });
    }
    showWordMenu(e.clientX, e.clientY, items);
  }

  // Sets status straight to 'learned' (green) server-side via
  // /api/vocab/mark-known and un-does any in-session "clicked this page"
  // tracking for the word, so Finish Page/commitReadUpTo won't turn around
  // and report it as toLearn. For custom text (a phrase, or a substring of
  // this word), there's no single .word span whose dataset.gloss/word
  // actually matches it - el.dataset.gloss belongs to the FULL word under
  // the cursor, not the selection, so it'd be wrong to reuse here, and
  // there's nothing to recolor either; just confirms via the popup.
  async function markWordKnown(el, text, isPhrase) {
    const key = normalize(text);
    const isCustomText = text !== el.dataset.word;
    const gloss = !isCustomText && el.dataset.gloss !== NO_GLOSS ? el.dataset.gloss : '';

    showPopupFor(el, text, 'Marking as known…');
    try {
      await api.markWordKnown(text, gloss);
    } catch (err) {
      showPopupFor(el, text, `Error: ${err.message}`);
      return;
    }

    if (!isCustomText) {
      delete clickedWords[key];
      vocabStatus[key] = 'learned';
      pageHost.querySelectorAll(`.word[data-word="${CSS.escape(text)}"]`).forEach((span) => {
        span.classList.remove('learned');
        applyWordColor(span, key);
      });
    }
    showPopupFor(el, text, 'Marked as known ✓');
  }

  // The opposite: forces status back to 'learning' (orange) even if it was
  // already 'learned' - a deliberate menu choice, unlike a stray click,
  // so overriding 'learned' here is correct. Also treats it like a fresh
  // click for Finish Page bookkeeping (toLearn, not passive).
  async function markWordUnknown(el, text, isPhrase) {
    const key = normalize(text);
    const isCustomText = text !== el.dataset.word;
    const gloss = !isCustomText && el.dataset.gloss !== NO_GLOSS ? el.dataset.gloss : '';

    showPopupFor(el, text, 'Marking as unknown…');
    try {
      await api.markWordUnknown(text, gloss);
    } catch (err) {
      showPopupFor(el, text, `Error: ${err.message}`);
      return;
    }

    if (!isCustomText) {
      clickedWords[key] = (clickedWords[key] || 0) + 1;
      vocabStatus[key] = 'learning';
      pageHost.querySelectorAll(`.word[data-word="${CSS.escape(text)}"]`).forEach((span) => {
        span.classList.add('learned');
        applyWordColor(span, key);
      });
    }
    showPopupFor(el, text, 'Marked as unknown ✓');
  }

  // "Change translation": the learner picks the matching Persian text (see
  // wordMenu.js's picker) rather than typing anything - the picker is
  // anchored under this word's own sentence as a starting point, but
  // nothing stops dragging the selection into another sentence's .fa too,
  // for a translation spanning the same multiple sentences as a chunk's
  // German text. A single word (including a substring of a bigger word)
  // updates the shared dictionary gloss (visible everywhere that word
  // appears, like a manual re-import); a multi-word phrase has no single
  // dictionary entry to update, so it's saved as a personal vocab_progress
  // row instead, same as "mark known" with a specific translation attached.
  function startChangeTranslation(el, text, isPhrase) {
    const faEl = el.closest('.sentence')?.querySelector('.fa');
    if (!faEl) return;
    showTranslationPicker(faEl, text, async (persianText) => {
      if (isPhrase) {
        await api.markWordKnown(text, persianText);
        return;
      }
      const key = normalize(text);
      await api.updateDictionaryGloss(text, persianText);
      dictionary[key] = persianText;
      pageHost.querySelectorAll(`.word[data-word="${CSS.escape(text)}"]`).forEach((span) => {
        span.dataset.gloss = persianText;
      });
    });
  }

  // Given the two clicked words of a manually-linked separable verb, try to
  // reconstruct its infinitive exactly like separableVerbs.js's automatic
  // detector does: exactly one of the two must be a known separable prefix
  // (SEPARABLE_PREFIX_SET), and the other must be a conjugation
  // likelyInfinitive() can resolve - prefix + that stem is the infinitive.
  // Returns null if neither condition holds (an irregular/unlisted form, or
  // neither word is a recognized prefix), in which case startVerbLink falls
  // back to a plain compound key instead of a real infinitive.
  function guessSeparableInfinitive(wordA, wordB) {
    const aIsPrefix = SEPARABLE_PREFIX_SET.has(normalize(wordA));
    const bIsPrefix = SEPARABLE_PREFIX_SET.has(normalize(wordB));
    if (aIsPrefix === bIsPrefix) return null;
    const [prefix, verbForm] = aIsPrefix ? [wordA, wordB] : [wordB, wordA];
    const stem = likelyInfinitive(verbForm);
    if (!stem) return null;
    return { infinitive: normalize(prefix) + stem, verbForm };
  }

  // "Link separable verb": a fallback for when separableVerbs.js's automatic
  // clause-based detection misses a split verb. The learner clicks the
  // other part of the verb in the same sentence (see wordMenu.js's
  // showVerbLinkPicker), then picks its Persian meaning the same way
  // "Change translation" does. Mirrors an auto-detected pair exactly - both
  // spans end up with the resolved infinitive as dataset.word, the chosen
  // gloss, and 'compoundPart'/'compoundGroup' so they highlight together on
  // click just like one findSeparableCompounds already found.
  //
  // When the infinitive can be resolved, this also saves a dictionary hint
  // on the conjugated form (" • infinitive", same shape upsertSeparableVerbs
  // writes) so findSeparableCompounds recognizes this exact conjugated form
  // on its own from now on - everywhere it recurs, not just this click.
  function startVerbLink(el, text) {
    const sentenceEl = el.closest('.sentence');
    const faEl = sentenceEl?.querySelector('.fa');
    if (!sentenceEl || !faEl) return;

    showVerbLinkPicker(sentenceEl, el, text, (secondEl) => {
      const secondText = secondEl.dataset.word;
      const guess = guessSeparableInfinitive(text, secondText);
      const infinitive = guess ? guess.infinitive : normalize(`${text}${secondText}`);

      showTranslationPicker(faEl, infinitive, async (persianText) => {
        await api.updateDictionaryGloss(infinitive, persianText);
        if (guess) {
          await api.updateDictionaryGloss(guess.verbForm, `${persianText} • ${infinitive}`);
        }
        const key = normalize(infinitive);
        dictionary[key] = persianText;

        const indices = [el.dataset.pageIndex, secondEl.dataset.pageIndex].sort((a, b) => Number(a) - Number(b));
        const groupId = `manual-${indices[0]}-${indices[1]}`;
        for (const span of [el, secondEl]) {
          span.dataset.word = infinitive;
          span.dataset.gloss = persianText;
          span.classList.add('compoundPart');
          span.dataset.compoundGroup = groupId;
          span.title = `Separable verb: ${infinitive}`;
          applyWordColor(span, key);
        }
      });
    });
  }

  // "Extract pattern (AI)": for a selected multi-word chunk that's really a
  // reusable construction (verb + preposition + case, an idiom) rather than
  // a one-off fragment - e.g. selecting "einen Überblick über diese
  // Unternehmenssoftware verschaffen" out of a sentence about one specific
  // piece of software, where the dictionary-worthy unit is really the
  // pattern "einen Überblick über etwas verschaffen" with the object
  // generalized to "etwas". Doing that generalization needs real German
  // grammar (case government, gender-appropriate placeholders) well beyond
  // anything worth hand-coding here, so it's delegated to the account's own
  // Translation API key (see server/src/llm.js's extractPhrasePattern) -
  // the AI's suggested pattern + translation are shown as editable fields
  // (wordMenu.js's showPatternConfirm) rather than saved outright, since
  // it's a starting point the learner can fix up, not assumed correct.
  function startExtractPattern(el, text) {
    const sentenceEl = el.closest('.sentence');
    const deEl = sentenceEl?.querySelector('.de');
    const faEl = sentenceEl?.querySelector('.fa');
    if (!deEl || !faEl) return;

    showPopupFor(el, text, 'Asking AI…');
    api
      .extractPattern(text, deEl.textContent, faEl.textContent)
      .then(({ pattern, translation }) => {
        hidePopup();
        showPatternConfirm(faEl, pattern, translation, async (finalPattern, finalTranslation) => {
          await api.updateDictionaryGloss(finalPattern, finalTranslation);
          dictionary[normalize(finalPattern)] = finalTranslation;
          // Also save it to the learner's own To Learn list (vocab_progress),
          // same as any other saved phrase (e.g. "Change translation" on a
          // multi-word selection) - updateDictionaryGloss alone only updates
          // the shared dictionary, which My Words/To Learn's "Structure" tab
          // doesn't read from, so without this a confirmed pattern would
          // never actually show up there. Status 'learning' (via
          // markWordUnknown - see its own doc comment for why that's the
          // one that means "learning"), same as any other freshly-saved item.
          await api.markWordUnknown(finalPattern, finalTranslation);
        });
      })
      .catch((err) => {
        showPopupFor(el, text, `Error: ${err.message}`);
      });
  }

  // A click is also a "I've read at least this far" signal - everything
  // between the previous furthest click and this one gets committed as
  // passive (green) right away, not just this one word, so reading most of
  // a page and then navigating away (without ever hitting Finish Page)
  // still saves that progress instead of losing it silently. Finish Page
  // still separately covers whatever's left *after* the last click through
  // the true end of the page - this only ever advances forward, so
  // clicking an earlier word again (already inside a committed range)
  // doesn't redo anything.
  function commitReadUpTo(clickedEl) {
    const clickedIndex = Number(clickedEl.dataset.pageIndex);
    if (!Number.isFinite(clickedIndex) || clickedIndex <= lastCommittedIndex) return;

    const spansInRange = [...pageHost.querySelectorAll('.word')].filter((el) => {
      const idx = Number(el.dataset.pageIndex);
      return idx > lastCommittedIndex && idx <= clickedIndex;
    });
    lastCommittedIndex = clickedIndex;

    const { toLearn, passive } = classifyWordSpans(spansInRange);
    for (const { german } of passive) {
      const key = normalize(german);
      if (vocabStatus[key] === 'learned' || vocabStatus[key] === 'learning') continue;
      vocabStatus[key] = 'passive';
      pageHost.querySelectorAll(`.word[data-word="${CSS.escape(german)}"]`).forEach((span) => applyWordColor(span, key));
    }
    if (toLearn.length || passive.length) api.recordReadingPage(toLearn, passive).catch(() => {});
  }

  // Splits a set of word spans into two piles: ever-clicked ("I needed the
  // gloss, so I don't know this") goes toward active learning, everything
  // else is assumed passively understood ("read past it without needing
  // help"). Shared by Finish Page (the whole page) and onWordClick's
  // incremental commit (just the span range read to reach this click).
  function classifyWordSpans(spans) {
    const seen = new Set();
    const toLearn = [];
    const passive = [];
    for (const el of spans) {
      const word = el.dataset.word;
      const key = normalize(word);
      if (seen.has(key)) continue;
      seen.add(key);
      const gloss = el.dataset.gloss;
      // Still counts as "read past it" even with no dictionary gloss yet
      // (foreign loanwords mixed into German text, proper nouns, a word
      // just not in the dictionary) - persian stays '' rather than being
      // skipped outright, so it still gets colored/tracked; My Words
      // already shows '—' for an empty gloss.
      const entry = { german: word, persian: gloss === NO_GLOSS ? '' : gloss };
      if (el.classList.contains('learned')) toLearn.push(entry);
      else passive.push(entry);
    }
    return { toLearn, passive };
  }

  // Deliberately an explicit click (or Finish Page below), not automatic on
  // page turn - a page you only skimmed shouldn't silently get credited as
  // words you passively know.
  finishPageBtn.onclick = async () => {
    const { toLearn, passive } = classifyWordSpans(pageHost.querySelectorAll('.word'));

    if (!toLearn.length && !passive.length) {
      finishPageStatus.textContent = 'No words with a known translation on this page.';
      finishPageStatus.className = 'importStatus';
      return;
    }

    finishPageBtn.disabled = true;
    finishPageStatus.textContent = 'Saving…';
    finishPageStatus.className = 'importStatus';
    try {
      await api.recordReadingPage(toLearn, passive);
      finishPageStatus.textContent = `Saved: ${toLearn.length} to learn, ${passive.length} passively known.`;
      finishPageStatus.className = 'importStatus success';
    } catch (err) {
      finishPageStatus.textContent = `Error: ${err.message}`;
      finishPageStatus.className = 'importStatus error';
    } finally {
      finishPageBtn.disabled = false;
    }
  };

  prevBtn.onclick = () => go(-1);
  nextBtn.onclick = () => go(1);
  gotoPageForm.onsubmit = (e) => {
    e.preventDefault();
    const value = Number(gotoPageInput.value);
    if (!Number.isFinite(value)) return;
    goToPage(value);
    gotoPageInput.value = '';
  };
  renderPage();
}
