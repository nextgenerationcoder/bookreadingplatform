// Reusable "click a German word -> see its translation, Ctrl/Cmd+click ->
// add it to To Learn, Ctrl/Cmd+Alt+click -> ask AI for a context-aware
// re-translation" behavior, extracted from the core of views/reader.js's
// word interaction so any other part of the site can drop plain German text
// in and get the same click/translate/save-to-vocabulary behavior, without
// needing a full book/page/sentence structure around it.
//
// Deliberately simpler than reader.js's own word handling: this has no
// concept of a word's prior "known/learning/unknown" status (no
// wordKnown/wordLearning/wordUnset coloring, no "mark unknown" to undo a
// save) - its only job is translate-on-click and add-to-To-Learn-on-
// Ctrl/Cmd-click. reader.js is left exactly as it is; this is a copy, not a
// refactor, so keep both in sync by hand if the shared lookup/popup logic
// changes in one and should change in the other too.
//
// Uses the same backend endpoints as reader.js (api.lookupWord,
// api.markWordUnknown, api.recordWordClick), plus two endpoints reader.js
// doesn't need (api.contextualTranslate, api.updateWordTranslation) for the
// Ctrl/Cmd+Alt+click AI re-translation below. Same dictionary state shape
// as reader.js too (a plain {normalizedWord: gloss} map) - a caller that
// already has one (e.g. from getDictionary()) can pass it straight through.

import { api } from '../api.js';
import { normalizeWord } from '../state.js';
import { showPopupFor, hidePopup } from '../popup.js';

const TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’-]+|[^A-Za-zÀ-ÖØ-öø-ÿ'’-]+/g;
const NO_GLOSS = 'Not yet in the dictionary.';

/**
 * Wires up click/Ctrl+click/Ctrl+Alt+click word behavior on an EXISTING
 * element, without touching whatever markup/children it already has -
 * added with addEventListener (not .onclick), so it coexists with a
 * caller's own click handler on the same element instead of replacing it.
 * This is the piece renderClickableGermanText uses for each span it
 * creates (see below), but it's also exported on its own for a case that
 * needs: an already-built page (e.g. a worksheet with its own word-marking
 * buttons already in the DOM) where new spans can't be inserted - here it
 * just adds the translate/save/context actions on top of whatever that
 * element's own click already does.
 *
 * @param {HTMLElement} el - the element to wire up; must already contain
 *   the plain word as its visible text.
 * @param {string} word - the German word (not necessarily el.textContent
 *   verbatim, e.g. if el has surrounding whitespace).
 * @param {object} options
 * @param {object} options.dictionary - see renderClickableGermanText.
 * @param {string} [options.sentence] - the sentence this occurrence came
 *   from, for Ctrl/Cmd+Alt+click's context-aware translation; falls back to
 *   `word` itself if omitted.
 * @param {string} [options.bookId] - see renderClickableGermanText.
 * @param {number} [options.page] - see renderClickableGermanText.
 * @param {() => {left: number, top: number}} [options.getFrameRect] - see
 *   renderClickableGermanText.
 */
export function attachWordClickHandlers(el, word, { dictionary, sentence, bookId, page, getFrameRect } = {}) {
  const doc = el.ownerDocument || document;
  el.dataset.word = word;
  if (el.dataset.gloss === undefined) el.dataset.gloss = dictionary[normalizeWord(word)] || NO_GLOSS;
  el.dataset.sentence = sentence || word;
  if (!el.title) el.title = 'Click: translate. Ctrl/Cmd+click: add to To Learn. Ctrl/Cmd+Alt+click: ask AI (context).';

  function popupAt(gloss) {
    showPopupFor(el, word, gloss, getFrameRect ? getFrameRect() : undefined);
  }

  // Looks up and caches the gloss if it isn't known yet, updating every
  // element sharing this word in the same document (not just `el`).
  // Shared by both the plain-click (translate only) and Ctrl/Cmd-click
  // (translate + save) paths so a word Ctrl-clicked without ever being
  // plain-clicked first still gets a real translation looked up, instead of
  // silently saving to To Learn with a blank one.
  async function ensureGloss() {
    const key = normalizeWord(word);
    if (dictionary[key]) return dictionary[key];
    try {
      const { gloss } = await api.lookupWord(word);
      dictionary[key] = gloss;
      doc.querySelectorAll(`[data-word="${CSS.escape(word)}"]`).forEach((other) => {
        other.dataset.gloss = gloss;
      });
      return gloss;
    } catch {
      return '';
    }
  }

  // Ctrl/Cmd+click: shows the translation AND saves the word to To Learn in
  // one action, as something still actively being learned (status
  // 'learning', via markWordUnknown - see its own doc comment in api.js/
  // routes/vocab.js for why that endpoint is the one that sets 'learning'
  // despite its name) rather than 'learned' - a word you just met in a
  // worksheet/text isn't mastered yet just because you looked it up.
  async function addToMyWords() {
    popupAt(el.dataset.gloss === NO_GLOSS ? 'Looking up…' : el.dataset.gloss);
    const gloss = await ensureGloss();
    try {
      await api.markWordUnknown(word, gloss);
    } catch (err) {
      popupAt(`Error: ${err.message}`);
      return;
    }
    doc.querySelectorAll(`[data-word="${CSS.escape(word)}"]`).forEach((other) => other.classList.add('wordAdded'));
    popupAt(gloss ? `${gloss} — added to To Learn ✓` : 'Added to To Learn ✓');
  }

  // Ctrl/Cmd+Alt+click: for when the dictionary's standalone gloss is wrong
  // for how the word is actually used here - sends just the sentence this
  // occurrence came from to the AI and shows its context-aware translation.
  // Updates only `el`'s own dataset.gloss (not every element sharing the
  // word, and never the shared dictionary) since a context-specific sense
  // isn't necessarily right for every other occurrence - but DOES overwrite
  // the word's saved To Learn translation if one exists (via
  // updateWordTranslation, which force-overwrites unlike markWordKnown/
  // Unknown's "fill if blank"), since the whole point of this action is
  // fixing a wrong translation that a casual click already saved.
  async function contextualTranslate() {
    popupAt('Asking AI (context)…');
    let translation;
    try {
      ({ translation } = await api.contextualTranslate(word, el.dataset.sentence));
    } catch (err) {
      popupAt(`Error: ${err.message}`);
      return;
    }
    el.dataset.gloss = translation;
    try {
      await api.updateWordTranslation(word, translation);
    } catch {
      // The popup below still shows the corrected translation even if
      // saving it failed (e.g. a transient network error) - just not
      // persisted this time.
    }
    popupAt(`${translation} (AI, in context) — saved ✓`);
  }

  el.addEventListener('click', async (e) => {
    // Always stopped, even for a plain click with no modifier - a click on
    // a word is fully handled right here (translate it), so it should
    // never also trigger some surrounding container's own click behavior
    // (e.g. a worksheet's "click anywhere to hide this sentence again"
    // toggle, which otherwise fires right after the translation popup
    // opens and immediately hides the very word just translated).
    e.stopPropagation();

    // Checked before the plain Ctrl/Cmd+click case below, since that combo
    // is also true whenever this one is (Alt is just the extra modifier).
    if ((e.ctrlKey || e.metaKey) && e.altKey) {
      await contextualTranslate();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      await addToMyWords();
      return;
    }

    if (el.dataset.gloss === NO_GLOSS) {
      popupAt('Looking up…');
      const gloss = await ensureGloss();
      popupAt(gloss || NO_GLOSS);
    } else {
      popupAt(el.dataset.gloss);
    }

    if (bookId) api.recordWordClick(bookId, page || 0, word).catch(() => {});
  });
}

/**
 * Renders `text` into `container` as clickable German words.
 *
 * @param {HTMLElement} container - emptied and filled with the tokenized text.
 * @param {string} text - plain German text (no adjacent translation needed).
 * @param {object} options
 * @param {object} options.dictionary - {normalizedWord: gloss} - mutated in
 *   place as new words get looked up, so a caller sharing one dictionary
 *   object across several renders benefits from each other's lookups.
 * @param {string} [options.bookId] - passed to api.recordWordClick for the
 *   word-click frequency stats; omit if there's no meaningful "book" this
 *   text belongs to (word-click recording is then skipped).
 * @param {number} [options.page] - printed page number, same purpose.
 * @param {() => {left: number, top: number}} [options.getFrameRect] - only
 *   needed when `container` lives inside a same-origin <iframe> (e.g. a
 *   worksheet) rather than this document directly: called fresh before each
 *   popup so it reflects the frame's current position (it can move on
 *   scroll/resize), and passed through to popup.js so the translation popup
 *   (which always renders into *this* document's <body>) lands in the right
 *   place instead of offset by wherever the iframe happens to sit.
 */
export function renderClickableGermanText(container, text, { dictionary, bookId, page, getFrameRect } = {}) {
  // Splits `text` into sentences up front and, while tokenizing, tracks
  // which sentence each word token falls in (by its running character
  // offset) - so Ctrl/Cmd+Alt+click can hand the AI the one sentence this
  // specific occurrence of the word came from, not the whole passage, even
  // when the same word appears in several different sentences.
  const sentenceChunks = text.match(/[^.!?]+[.!?]*/g) || [text];
  let sentenceCum = 0;
  const sentenceBoundaries = sentenceChunks.map((s) => {
    const end = sentenceCum + s.length;
    const entry = { text: s.trim(), end };
    sentenceCum = end;
    return entry;
  });
  function sentenceAtOffset(offset) {
    return (sentenceBoundaries.find((b) => offset < b.end) || sentenceBoundaries[sentenceBoundaries.length - 1])?.text || text;
  }

  const tokens = text.match(TOKEN_RE) || [];
  container.innerHTML = '';
  let charOffset = 0;
  for (const token of tokens) {
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/.test(token)) {
      container.appendChild(document.createTextNode(token));
      charOffset += token.length;
      continue;
    }
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = token;
    attachWordClickHandlers(span, token, { dictionary, bookId, page, getFrameRect, sentence: sentenceAtOffset(charOffset) });
    container.appendChild(span);
    charOffset += token.length;
  }
}

export { hidePopup };
