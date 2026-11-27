import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';
import { renderClickableGermanText, attachWordClickHandlers, hidePopup } from '../components/clickableGermanText.js';
import { showPopupFor } from '../popup.js';
import { showWordMenu, hideWordMenu, showPatternConfirm } from '../wordMenu.js';

// "Show my own HTML worksheet" - upload a self-contained HTML page, see it
// listed, open it in an iframe exactly as uploaded. No parsing/extraction.
//
// The iframe is same-origin (served from GET /api/worksheets/:id/view on
// our own domain, with sandbox="... allow-same-origin ..."), so once it
// loads, this file can reach into its document and apply
// clickableGermanText.js directly to the worksheet's own plain-text
// elements - same click-to-translate/Ctrl-click-to-save behavior as
// anywhere else in the app, without needing to change the worksheet's own
// stored HTML at all.
//
// Walks every individual TEXT NODE in the worksheet (not whole elements),
// so this reaches text absolutely anywhere - table cells, a question label
// sitting right next to its own <select>, a rule box's numbered items,
// nested <strong>/<em> runs inside a paragraph - rather than only a fixed
// list of "safe" container tags. Each qualifying text node is replaced with
// a <span> that clickableGermanText.js then fills in, leaving every
// surrounding element (the table, the <select>, the formatting tags)
// completely untouched - only the actual text content ever moves.
//
// A text node is skipped only if it's inside a form control itself
// (input/textarea/select/option/button - these hold the control's OWN
// value/label, not worksheet prose) or inside #marking/the note controls -
// #marking already has its own, different word-click-to-mark interaction
// built into the worksheet's own script, and .noteWrap/.markingNotes/
// .noteToggle/.noteEnter are this app's own injected UI chrome, not
// worksheet content. Everything else - including a label's text sitting
// right next to its <select>, since the <select> itself is a sibling
// element the text node's replacement never touches - becomes clickable.
const NON_CLICKABLE_ANCESTOR_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON']);
// .row-index (a plain "s001" id label) and .structure-panel (a grammar
// formula like "X + ist + Y" plus its variable key, not real sentence
// prose - the Sprechen B1 Teil 1 kit's own convention, see
// server/content-courses/sprechen-b1-teil1/) are excluded for a different
// reason than the rest of this list: not because they're app/kit UI chrome
// clicks shouldn't fire on, but because wrapping their Latin-letter
// fragments ("s" out of "s001", "X"/"Y" placeholder variables) as if they
// were German words pollutes any [data-gloss]-based selector the content's
// OWN script uses for something else entirely - see the Sprechen worksheet
// kit's own fa-word click handler, which maps each Persian word button to
// its German gloss positionally via `row.querySelectorAll('[data-gloss]')`;
// our wrapped placeholder spans carrying a data-gloss of their own were
// shifting that mapping and showing the wrong (or no) translation.
const NON_CLICKABLE_ANCESTOR_SELECTOR =
  '#marking, .noteWrap, .markingNotes, .noteToggle, .noteEnter, .freeNote, .row-index, .structure-panel';
// Elements whose content should stay clickable/selectable even though a
// BUTTON ancestor would otherwise exclude them (see
// NON_CLICKABLE_ANCESTOR_TAGS's own comment) - the Sprechen B1 kit hides
// each sentence's real German text (.de-full) and its word-by-word reveal
// list (.word-list) inside a <button class="reveal-box"> that just toggles
// visibility; unlike the "whole worksheet built out of <button class=word>
// tokens" case that exclusion exists for, these buttons wrap real prose
// worth making clickable, not a self-contained word-marking feature of
// their own.
const FORCE_WALKABLE_SELECTOR = '.de-full, .word-list';

// The worksheet is its own document with its own stylesheet, which knows
// nothing about classes this app adds at runtime - a worksheet whose OWN
// markup happens to already define a ".word" class (like b1 lektion 1's
// own word-marking feature) gets some styling for free by name collision,
// but a plain worksheet with no such feature would show these as
// unstyled, indistinguishable inline text. Injected once per load so every
// worksheet gets at least baseline styling regardless of what it already has.
function injectStyles(doc) {
  if (doc.getElementById('tbInjectedStyles')) return;
  const style = doc.createElement('style');
  style.id = 'tbInjectedStyles';
  style.textContent = `
    .word { cursor: pointer; border-radius: 3px; padding: 0 1px }
    .word:hover { background: #e8f0f8 }
    .word.wordAdded { font-weight: 600; text-decoration: underline; text-decoration-style: dotted }
    .word.wordKnown { color: #2f8f4e }
    .word.wordLearning { color: #d98c2b }
    .word.wordUnset { color: #9a9488 }
    .hoerenCurrentWord { background: #fff3b0; border-radius: 3px }
    .freeNote { margin: 10px 0; border: 1px solid #e8d28a; background: #fffbea; border-radius: 8px; padding: 8px 10px; display: block }
    .freeNoteBar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px }
    .freeNoteLabel { font-size: 12px; color: #8a6d1f; font-weight: 600 }
    .freeNoteDelete { background: none; border: none; cursor: pointer; font-size: 13px; color: #8a6d1f; padding: 0 4px }
    .freeNoteBox { width: 100%; resize: none; overflow: hidden; border: 1px solid #e8d28a; border-radius: 5px; padding: 6px 8px; font: inherit; box-sizing: border-box; background: #fffef8 }
    .freeNoteEnter { margin-top: 6px; font-size: 13px; padding: 3px 10px; border-radius: 6px; border: 1px solid #e8d28a; background: #fff; color: #8a6d1f; cursor: pointer }
    .freeNoteEnter:disabled { opacity: 0.6; cursor: default }
    .patternConfirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; margin: 4px 0 10px; padding: 8px 10px; background: #eef6ec; border: 1px solid #a8d1a0; border-radius: 8px; font-family: system-ui, sans-serif }
    .patternConfirm .patternInput { font-size: 14px; padding: 5px 7px; border-radius: 6px; border: 1px solid #ccc; min-width: 220px }
    .patternConfirm .patternTranslationInput { font-size: 14px; padding: 5px 7px; border-radius: 6px; border: 1px solid #ccc; min-width: 160px }
    .patternConfirm .patternActions { display: flex; gap: 6px }
    .patternConfirm button { padding: 4px 10px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 13px }
    .patternConfirm .patternStatus { color: #777 }
    .faWordAi { cursor: pointer; border-bottom: 1px dotted #a9a9a9 }
    .faWordAi:hover { background: #f3f0ff }
  `;
  doc.head.appendChild(style);
}

// Block-level tags: an element containing one of these anywhere inside it
// is a WRAPPER around other, more specific blocks (see isTextBlock below),
// never a leaf itself - e.g. <article> holding several <p>s, or a
// worksheet's own <div class="mark"> holding only inline word tokens (no
// block tags inside it at all) is a leaf.
const BLOCK_LEVEL_SELECTOR =
  'p, div, section, article, li, ol, ul, table, h1, h2, h3, h4, h5, h6, header, footer, aside, figure, figcaption, blockquote, form, fieldset, dl, dt, dd';

function isTextBlock(el) {
  if (!el || el.nodeType !== 1) return false;
  if (NON_CLICKABLE_ANCESTOR_TAGS.has(el.tagName)) return false;
  if (el.matches?.(NON_CLICKABLE_ANCESTOR_SELECTOR)) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(el.textContent || '')) return false;
  // A leaf either has a direct text node (the common case - a plain <p>)
  // OR its content is already made of inline elements with no block-level
  // tag anywhere inside - e.g. some AI-generated worksheets (like "b1
  // lektion 1") pre-wrap every word in its own <button class="word">
  // for their OWN click-to-mark feature, leaving no bare text node behind
  // at all; without this, such a box would be invisible to this app's own
  // note/"Extract pattern" features (findable by neither computeBlocks nor
  // the "every word should be clickable" TreeWalker pass, since there's no
  // raw text left to wrap - but its own buttons still carry real content).
  return !el.querySelector(BLOCK_LEVEL_SELECTOR);
}

// Every "leaf" text-bearing element (a <p>, <li>, <td>, grammar-box <div>
// whose OWN direct children include real text - not one that just wraps
// other qualifying elements, e.g. a <div class="rule"> around several <p>s
// is excluded, its <p> children are what count) in document order. This is
// the same granularity, and must stay in sync with, the TreeWalker's
// text-node pass below - together they're "where can this app's own
// content (clickable words, free notes) go". Must run on the PRISTINE,
// unmodified worksheet DOM (before the text-node pass wraps any words, and
// before any saved note has split anything) so the indices this assigns
// are reproducible across page loads - see db.js's worksheet_notes comment.
function computeBlocks(doc) {
  const blocks = [];
  doc.body.querySelectorAll('*').forEach((el) => {
    if (isTextBlock(el)) blocks.push(el);
  });
  return blocks;
}

// Finds the (textNode, localOffset) inside blockEl that's `targetOffset`
// characters into blockEl's own text content, clamped to the end if
// targetOffset reaches or exceeds the total length (which is exactly what
// "insert the note after this whole block" means - see splitBlockAtOffset).
function findTextPosition(blockEl, targetOffset) {
  const walker = blockEl.ownerDocument.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let node;
  let lastNode = null;
  let remaining = targetOffset;
  while ((node = walker.nextNode())) {
    lastNode = node;
    const len = node.nodeValue.length;
    if (remaining <= len) return { node, offset: Math.max(0, remaining) };
    remaining -= len;
  }
  return lastNode ? { node: lastNode, offset: lastNode.nodeValue.length } : null;
}

// Splits blockEl's content at `charOffset` characters in, inserts noteEl
// between the two halves, and removes whichever half ends up empty (so a
// note added right before the very first character, or right after the
// very last one, doesn't leave a stray empty paragraph behind). Returns the
// element that now holds the "before" text (for further, smaller-offset
// splits of the same original block - see applySavedNotes) - this is
// always blockEl itself, still in the DOM, just possibly now shorter.
function splitBlockAtOffset(doc, blockEl, charOffset, noteEl) {
  const parent = blockEl.parentNode;
  const pos = findTextPosition(blockEl, charOffset);
  if (!pos) {
    // No text at all (shouldn't happen for a real block, but be safe).
    parent.insertBefore(noteEl, blockEl.nextSibling);
    return blockEl;
  }

  const range = doc.createRange();
  range.setStart(pos.node, pos.offset);
  const fullRange = doc.createRange();
  fullRange.selectNodeContents(blockEl);
  range.setEnd(fullRange.endContainer, fullRange.endOffset);
  const afterFragment = range.extractContents(); // mutates blockEl in place, removing the "after" part

  const afterBlock = blockEl.cloneNode(false);
  afterBlock.removeAttribute('id');
  afterBlock.appendChild(afterFragment);

  const beforeIsEmpty = !blockEl.textContent.trim();
  const afterIsEmpty = !afterBlock.textContent.trim();
  const anchor = blockEl.nextSibling;

  if (beforeIsEmpty) {
    // The whole original block's text is in "after" - the note goes before
    // all of it, i.e. exactly where blockEl itself was.
    parent.insertBefore(noteEl, blockEl);
    if (!afterIsEmpty) parent.insertBefore(afterBlock, blockEl);
    parent.removeChild(blockEl);
    return null; // nothing left of the original block to split further
  }
  parent.insertBefore(noteEl, anchor);
  if (!afterIsEmpty) parent.insertBefore(afterBlock, anchor);
  return blockEl;
}

// Within a Sprechen-B1-kit-style row (see server/content-courses/
// sprechen-b1-teil1/), each .fa-word button already carries a precise,
// human-curated German<->Persian pairing - data-gloss is the German
// phrase, the button's own visible text is its Persian translation -
// richer and more reliable for THAT exact phrase than this app's own
// generic dictionary (which only knows isolated words and often has no
// entry at all for a multi-word chunk). Also seeds the shared `dictionary`
// object under the phrase's own key, so Ctrl/Cmd+click's "add to To
// Learn" (ensureGloss) finds it too instead of falling back to a fresh,
// likely-empty lookup for the whole phrase.
function collectCuratedPhrases(deFullEl, dictionary) {
  const row = deFullEl.closest('.worksheet-row');
  if (!row) return [];
  const phrases = [...row.querySelectorAll('.fa-word[data-gloss]')]
    .map((btn) => ({ de: btn.dataset.gloss, fa: btn.textContent.trim() }))
    .filter((p) => p.de && p.fa);
  for (const { de, fa } of phrases) dictionary[normalizeWord(de)] = fa;
  return phrases.sort((a, b) => b.de.length - a.de.length);
}

// Wraps `text` into clickable spans the same way renderClickableGermanText
// does, except any substring that exactly matches one of `phrases` (tried
// longest-first, so a 4-word curated phrase wins over any single word
// inside it) becomes ONE span carrying that phrase's curated gloss
// directly - no dictionary lookup, no "Looking up…". Whatever isn't
// covered by a phrase falls back to the normal per-word/dictionary
// behavior, unchanged.
function wrapWithCuratedPhrases(container, text, phrases, options) {
  container.innerHTML = '';
  let i = 0;
  while (i < text.length) {
    const match = phrases.find((p) => text.startsWith(p.de, i));
    if (match) {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = match.de;
      span.dataset.gloss = match.fa;
      attachWordClickHandlers(span, match.de, { ...options, sentence: text });
      container.appendChild(span);
      i += match.de.length;
      continue;
    }
    let j = i + 1;
    while (j < text.length && !phrases.some((p) => text.startsWith(p.de, j))) j++;
    const chunk = document.createElement('span');
    renderClickableGermanText(chunk, text.slice(i, j), options);
    while (chunk.firstChild) container.appendChild(chunk.firstChild);
    i = j;
  }
}

// A Sprechen-kit row's curated .fa-word buttons only cover the
// words/phrases the curator was confident about (see
// collectCuratedPhrases's own comment) - the rest of .fa-text is plain,
// unclickable Persian text today, which reads as a dead click rather than
// "this word was never curated". Wraps every remaining Persian word in a
// clickable span that asks the AI (findGermanForPersian below) which
// German substring it corresponds to, given BOTH sentences - a generic
// fallback for exactly the gap a human curator left, not a replacement for
// the curated links (those stay instant and free, with no AI call).
function wireUpPersianWordLookup(doc, getFrameRect) {
  for (const row of doc.querySelectorAll('.worksheet-row')) {
    const faText = row.querySelector('.fa-text');
    const deFull = row.querySelector('.de-full');
    const box = row.querySelector('.reveal-box');
    if (!faText || !deFull) continue;
    const germanSentence = deFull.textContent.trim();
    const persianSentence = faText.textContent.trim();

    const walker = doc.createTreeWalker(faText, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/[؀-ۿ]/.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
        for (let el = node.parentElement; el && el !== faText; el = el.parentElement) {
          if (el.tagName === 'BUTTON') return NodeFilter.FILTER_REJECT; // already a curated .fa-word
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n);

    for (const textNode of textNodes) {
      const frag = doc.createDocumentFragment();
      for (const token of textNode.nodeValue.split(/(\s+)/)) {
        if (!token || !/[؀-ۿ]/.test(token)) {
          frag.appendChild(doc.createTextNode(token));
          continue;
        }
        const span = doc.createElement('span');
        span.className = 'faWordAi';
        span.textContent = token;
        span.title = 'یافتن معادل آلمانی با هوش مصنوعی';
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          // A single Persian word is sometimes just a grammatical particle
          // with no standalone German equivalent at all (e.g. "خواهم" in
          // "خواهم کرد" - a future-tense auxiliary, meaningless on its own;
          // only the whole phrase "will do" has a real German counterpart).
          // If the learner drag-selected a chunk that includes this word
          // before clicking it, send that whole selection instead of just
          // this one token - same "a selection overrides the single word"
          // rule reader.js's own right-click menu already uses.
          const selection = doc.getSelection();
          const hasSelection = selection && !selection.isCollapsed && selection.containsNode(span, true);
          const phrase = hasSelection ? selection.toString().trim() : token;
          lookupPersianWord(doc, span, phrase || token, germanSentence, persianSentence, box, getFrameRect);
        });
        frag.appendChild(span);
      }
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }
}

async function lookupPersianWord(doc, anchorEl, persianPhrase, germanSentence, persianSentence, box, getFrameRect) {
  const frameRect = getFrameRect ? getFrameRect() : undefined;
  showPopupFor(anchorEl, persianPhrase, 'در حال بررسی…', frameRect);

  let german;
  try {
    ({ german } = await api.findGermanForPersian(persianPhrase, germanSentence, persianSentence));
  } catch (err) {
    showPopupFor(anchorEl, persianPhrase, `خطا: ${err.message}`, frameRect);
    return;
  }

  if (!german) {
    showPopupFor(anchorEl, persianPhrase, 'معادل مشخصی پیدا نشد', frameRect);
    return;
  }

  // Shown the same way the worksheet's own "select a curated word" feature
  // shows its answer - appended to .word-list, box switched to its
  // word-mode styling - instead of revealing the full German sentence.
  // Finding one word's meaning shouldn't give away the rest of the answer,
  // which a full reveal would.
  hidePopup();
  appendToWordList(doc, box, german);

  // A curated .fa-word click also registers a Learn candidate
  // (addCandidate) alongside the word-list display - an AI-found word
  // should get the same "show up below in Learn, waiting for ✓/✕" ✓,
  // but addCandidate is closured inside the worksheet's own mount()
  // script, unreachable from here. worksheet:ai-candidate is the mirror
  // of worksheet:learn-decision (the kit's own event OUT) - an event IN,
  // which the kit's per-row listener (see shared/worksheet.js) turns back
  // into a real addCandidate() call.
  box
    .closest('.worksheet-row')
    ?.dispatchEvent(new doc.defaultView.CustomEvent('worksheet:ai-candidate', { detail: { fa: persianPhrase, de: german }, bubbles: true }));
}

// Mirrors the worksheet's own renderWords() output for one entry (see
// shared/worksheet.js), without needing access to its closured `state` -
// this is a one-off AI-found entry, not a toggleable selection tied to a
// particular .fa-word button, so it's just appended, never rebuilt from an
// ids array the way a curated selection's list is.
function appendToWordList(doc, box, text) {
  const list = box?.querySelector('.word-list');
  if (!list) return;
  box.classList.add('word-mode');
  box.classList.remove('revealed');
  const span = doc.createElement('span');
  span.textContent = text;
  list.appendChild(span);
  list.hidden = false;
}

// The Sprechen kit's own "Learn" section (pick a word via a .fa-word
// click or "Extract pattern", then confirm it with the ✓/✕ buttons that
// show up below) is entirely local to the worksheet - it only moves the
// candidate between its own in-page `pending`/`saved` lists, persisted to
// this browser's localStorage, with no concept of this app's real To
// Learn list at all. The kit's own engine already anticipates exactly
// this gap: it dispatches a `worksheet:learn-decision` CustomEvent (see
// shared/worksheet.js's `decide()`) specifically so a host app can hook
// in its own save - this is that hook. Confirming "بله" (save) calls the
// same markWordUnknown the rest of the app already uses for "add to To
// Learn" (status 'learning', not 'learned' - a word just confirmed here
// isn't mastered yet); "خیر" (dismiss) does nothing extra, matching the
// kit's own behavior of just dropping the candidate.
function wireUpLearnDecisionBridge(doc) {
  doc.addEventListener('worksheet:learn-decision', (e) => {
    const { item, decision } = e.detail || {};
    const german = item?.de?.trim();
    if (decision !== 'save' || !german) return;
    api.markWordUnknown(german, item.fa || '').catch(() => {});
  });
}

function autoGrowTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

// Recognizes the "/ai <question> ... ---" command a learner can type into
// any note - ported as-is from the "noteEnter" script this app's own
// worksheet-authoring scripts (add-ai-command.js) inject into individual
// worksheets' stored HTML, so free-form notes and a worksheet's own static
// "+ Notiz" boxes behave identically. Strips any previous [KI]/[Fehler]
// result line so re-asking replaces it instead of stacking duplicates.
export function parseAiCommand(raw) {
  const lines = raw.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === '/ai' || l.trim().startsWith('/ai '));
  if (startIdx === -1) return null;
  const endIdx = lines.findIndex((l, i) => i > startIdx && l.trim() === '---');
  if (endIdx === -1) return null;
  const firstLine = lines[startIdx].trim();
  const inline = firstLine.slice(3).trim();
  const between = lines.slice(startIdx + 1, endIdx).filter((l) => !l.trim().startsWith('[KI] ') && !l.trim().startsWith('[Fehler:'));
  const question = [inline, ...between].filter(Boolean).join('\n').trim();
  return question ? { question, lines, startIdx, endIdx, between } : null;
}

// A freely-placed note: id is null until the first save completes (created
// on first keystroke, then just updated/deleted after that).
//
// askAi/onCreate/onUpdate/onDelete let any view (worksheets, course pages,
// game.js, ...) reuse this exact component - same "/ai ... ---" convention,
// same textarea/Enter/delete UI - against its own backing store and its own
// AI call.
export function buildFreeNote(doc, { id, text, askAi, onCreate, onUpdate, onDelete }) {
  const wrap = doc.createElement('div');
  wrap.className = 'freeNote';
  wrap.innerHTML = `
    <div class="freeNoteBar"><span class="freeNoteLabel">Notiz</span><button type="button" class="freeNoteDelete" title="Notiz löschen">✕</button></div>
    <textarea class="freeNoteBox" placeholder="Ihre Notiz … (/ai <Frage> gefolgt von einer Zeile mit --- fragt die KI)"></textarea>
    <button type="button" class="freeNoteEnter">Enter</button>
  `;
  const textarea = wrap.querySelector('.freeNoteBox');
  const enterBtn = wrap.querySelector('.freeNoteEnter');
  textarea.value = text || '';
  let noteId = id || null;
  let saveTimer = null;

  requestAnimationFrame(() => autoGrowTextarea(textarea));

  async function save() {
    try {
      if (!noteId) {
        const result = await onCreate(textarea.value);
        noteId = result?.id ?? null;
      } else {
        await onUpdate(noteId, textarea.value);
      }
    } catch {
      // best-effort - the note stays visible either way, just may not
      // have persisted this particular edit
    }
  }

  textarea.addEventListener('input', () => {
    autoGrowTextarea(textarea);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  });

  // Same "/ai" command as the worksheet's own static "+ Notiz" boxes -
  // typing the question, hitting this button either runs the AI call (if
  // the text parses as an /ai command) or just saves immediately, matching
  // the original noteEnter behavior (its "else save()" branch).
  enterBtn.addEventListener('click', async () => {
    const parsed = parseAiCommand(textarea.value);
    if (!parsed) {
      clearTimeout(saveTimer);
      save();
      return;
    }
    enterBtn.disabled = true;
    const original = enterBtn.textContent;
    enterBtn.textContent = '…';
    let resultLine;
    try {
      const { answer } = await askAi(parsed.question);
      resultLine = `[KI] ${answer}`;
    } catch (e) {
      resultLine = `[Fehler: ${e.message}]`;
    }
    const before = parsed.lines.slice(0, parsed.startIdx + 1).concat(parsed.between);
    const after = parsed.lines.slice(parsed.endIdx);
    textarea.value = before.concat([resultLine]).concat(after).join('\n');
    autoGrowTextarea(textarea);
    enterBtn.disabled = false;
    enterBtn.textContent = original;
    clearTimeout(saveTimer);
    save();
  });

  wrap.querySelector('.freeNoteDelete').addEventListener('click', async () => {
    if (!doc.defaultView.confirm('Notiz löschen?')) return;
    wrap.remove();
    if (noteId) {
      try {
        await onDelete(noteId);
      } catch {
        // already removed from view; a failed delete just leaves an orphan
        // row the learner won't see again unless they look it up directly
      }
    }
  });

  return wrap;
}

// Loads this worksheet's saved free notes and re-applies each one's split,
// using the SAME blockIndex/charOffset it was created with. Multiple notes
// landing in the same original block are applied from the LARGEST offset
// down to the smallest - splitting at a smaller offset never invalidates an
// already-placed larger-offset split's position, but the reverse isn't
// true, so processing order matters.
// Returns the "after" fragments created by these splits (element, original
// block index, base offset within that original block's text) - the
// caller needs these to seed wireUpAddNoteContextMenu's own block tracking,
// since without them a later right-click landing in text that comes AFTER
// an already-saved note would resolve to no block at all (see
// wireUpAddNoteContextMenu's blockMeta).
async function applySavedNotes(doc, blocks, callbacks) {
  let notes;
  try {
    ({ notes } = await callbacks.listNotes());
  } catch {
    return [];
  }
  const byBlock = new Map();
  for (const note of notes) {
    if (!byBlock.has(note.blockIndex)) byBlock.set(note.blockIndex, []);
    byBlock.get(note.blockIndex).push(note);
  }
  const extraFragments = [];
  for (const [blockIndex, notesForBlock] of byBlock) {
    let currentBlock = blocks[blockIndex];
    if (!currentBlock) continue; // worksheet content changed since this note was made - skip rather than guess
    const sorted = [...notesForBlock].sort((a, b) => b.charOffset - a.charOffset);
    for (const note of sorted) {
      if (!currentBlock) break;
      const noteEl = buildFreeNote(doc, {
        id: note.id,
        text: note.text,
        askAi: callbacks.askAi,
        onUpdate: callbacks.updateNote,
        onDelete: callbacks.deleteNote,
      });
      currentBlock = splitBlockAtOffset(doc, currentBlock, note.charOffset, noteEl);
      const afterEl = noteEl.nextSibling;
      if (afterEl && afterEl.nodeType === 1 && afterEl.textContent.trim()) {
        extraFragments.push({ element: afterEl, index: blockIndex, baseOffset: note.charOffset });
      }
    }
  }
  return extraFragments;
}

// Range.getClientRects() gives one rect per LINE for a plain text node, but
// one rect per INLINE ELEMENT once that text has already been wrapped in
// per-word <span class="word"> (which it always has, in practice, by the
// time a learner actually right-clicks - the clickable-text pass runs
// unconditionally on load) - several same-line rects in that case, not one.
// Grouping by closeness in `top` reconstructs true per-visual-line rects
// either way, independent of whatever markup happens to be inside the block.
function getLineRects(doc, el) {
  const range = doc.createRange();
  range.selectNodeContents(el);
  const raw = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  if (!raw.length) return [];
  const sorted = [...raw].sort((a, b) => a.top - b.top);
  const lines = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(r.top - last.top) < 3) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
  }
  return lines;
}

// Right-click anywhere in the worksheet -> "Notiz" -> a new note is
// inserted exactly between the two rendered (wrapped) lines closest to
// where the click landed, regardless of its horizontal position within
// that gap - see getLineRects() above. Clicking above the first line or
// below the last line of a block puts the note before/after that whole block.
function wireUpAddNoteContextMenu(doc, iframe, blocks, extraFragments = [], dictionary, callbacks) {
  const blockIndexOf = new Map(blocks.map((el, i) => [el, i]));
  // When a block gets split (by a saved note on load, or a new one added
  // here), the resulting pieces need to still resolve back to the ORIGINAL
  // block's index and know their own starting offset within that original
  // text - tracked here rather than as DOM attributes so it survives
  // cloneNode() (which copies attributes, which would otherwise make the
  // "after" clone look identical enough to be ambiguous) cleanly.
  const blockMeta = new Map(blocks.map((el) => [el, { index: blockIndexOf.get(el), baseOffset: 0 }]));
  // applySavedNotes may have already split some of these blocks (for notes
  // saved on an earlier visit) before this function ever saw them - the
  // "after" fragments it created need to be tracked too, or a right-click
  // landing in text that comes after an existing note resolves to no block.
  for (const { element, index, baseOffset } of extraFragments) {
    blockMeta.set(element, { index, baseOffset });
    blockIndexOf.set(element, index);
  }

  function findBlockFromTarget(target) {
    let el = target.nodeType === 3 ? target.parentElement : target;
    while (el && el !== doc.body) {
      if (blockMeta.has(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  doc.addEventListener('contextmenu', (e) => {
    if (e.target.closest?.('input, textarea, select, .freeNote, .noteWrap, .markingNotes, #marking')) return; // let the browser's own menu show there
    const blockEl = findBlockFromTarget(e.target);
    if (!blockEl) return;
    e.preventDefault();

    const frameRect = iframe.getBoundingClientRect();
    const items = [];

    // Offered whenever the right-click lands on/within a real text
    // selection that spans more than one word - same "isPhrase" rule
    // reader.js's own right-click menu uses, since a fixed construction is
    // only worth generalizing into a pattern when it's a multi-word chunk.
    const selection = doc.getSelection();
    const selectedText = selection && !selection.isCollapsed ? selection.toString().trim() : '';
    if (selectedText.includes(' ')) {
      items.push({
        label: 'Extract pattern (AI)',
        onClick: () => startExtractPatternInWorksheet(doc, blockEl, selectedText, dictionary),
      });
    }

    items.push({
      label: 'Notiz hinzufügen',
      onClick: () => {
        const lineRects = getLineRects(doc, blockEl);
        let localOffset;
        if (!lineRects.length) {
          localOffset = 0;
        } else if (e.clientY <= lineRects[0].top) {
          localOffset = 0;
        } else if (e.clientY >= lineRects[lineRects.length - 1].bottom) {
          localOffset = blockEl.textContent.length;
        } else {
          let gapIndex = lineRects.length - 2;
          let bestDist = Infinity;
          for (let i = 0; i < lineRects.length - 1; i++) {
            const gapY = (lineRects[i].bottom + lineRects[i + 1].top) / 2;
            const dist = Math.abs(e.clientY - gapY);
            if (dist < bestDist) {
              bestDist = dist;
              gapIndex = i;
            }
          }
          // A point definitely ON the line right after the gap, at its
          // left edge - independent of the click's own X position, per
          // "doesn't matter if middle of line, end of it, or at first".
          const targetLine = lineRects[gapIndex + 1];
          const targetY = (targetLine.top + targetLine.bottom) / 2;
          const caretRange =
            doc.caretRangeFromPoint?.(targetLine.left + 1, targetY) ||
            (doc.caretPositionFromPoint
              ? (() => {
                  const pos = doc.caretPositionFromPoint(targetLine.left + 1, targetY);
                  return pos ? { startContainer: pos.offsetNode, startOffset: pos.offset } : null;
                })()
              : null);
          if (caretRange && blockEl.contains(caretRange.startContainer)) {
            // Convert (node, localOffsetInNode) into "characters into blockEl's full text".
            const measureRange = doc.createRange();
            measureRange.selectNodeContents(blockEl);
            measureRange.setEnd(caretRange.startContainer, caretRange.startOffset);
            localOffset = measureRange.toString().length;
          } else {
            localOffset = 0;
          }
        }

        const meta = blockMeta.get(blockEl);
        const globalOffset = meta.baseOffset + localOffset;
        const noteEl = buildFreeNote(doc, {
          id: null,
          text: '',
          askAi: callbacks.askAi,
          onCreate: (text) => callbacks.createNote(meta.index, globalOffset, text),
          onUpdate: callbacks.updateNote,
          onDelete: callbacks.deleteNote,
        });

        const remainder = splitBlockAtOffset(doc, blockEl, localOffset, noteEl);
        if (remainder) {
          blockMeta.set(remainder, { index: meta.index, baseOffset: meta.baseOffset }); // "before" part, unchanged base
          blockIndexOf.set(remainder, meta.index);
        }
        // splitBlockAtOffset may have inserted an "after" sibling right
        // after noteEl - if so, register it too so a LATER note can still
        // land inside it with the correct base offset. isTextBlock() can't
        // be used here: by the time a live right-click happens, the
        // text-node-to-<span class="word"> pass has already run, so a
        // block's own direct children are word spans (not bare text), not
        // the pristine shape isTextBlock() was written to detect.
        const afterEl = noteEl.nextSibling;
        if (afterEl && afterEl.nodeType === 1 && afterEl.textContent.trim()) {
          blockMeta.set(afterEl, { index: meta.index, baseOffset: globalOffset });
          blockIndexOf.set(afterEl, meta.index);
        }

        textareaFocus(noteEl);
      },
    });

    showWordMenu(frameRect.left + e.clientX, frameRect.top + e.clientY, items);
  });

  doc.addEventListener('click', (e) => {
    if (!e.target.closest?.('.wordMenu')) hideWordMenu();
  });
}

// "Extract pattern (AI)" for worksheets - same feature as the reader's
// right-click menu (see reader.js's startExtractPattern), ported for a
// plain worksheet page instead of a bilingual .de/.fa sentence pair: there's
// no Persian sentence translation available here, so it's passed as empty
// context (extractPhrasePattern treats it as optional). The surrounding
// block's own full text stands in for "the sentence it came from". Saves
// the same way reader.js does - to the shared dictionary AND to the
// learner's own To Learn/Structure list (vocab_progress), via the exact
// same two calls - so a worksheet-extracted pattern shows up in Structure
// identically to one extracted while reading.
function startExtractPatternInWorksheet(doc, anchorEl, text, dictionary) {
  const contextSentence = anchorEl.textContent || text;
  api
    .extractPattern(text, contextSentence, '')
    .then(({ pattern, translation }) => {
      showPatternConfirm(anchorEl, pattern, translation, async (finalPattern, finalTranslation) => {
        await api.updateDictionaryGloss(finalPattern, finalTranslation);
        dictionary[normalizeWord(finalPattern)] = finalTranslation;
        await api.markWordUnknown(finalPattern, finalTranslation);
      });
    })
    .catch((err) => {
      doc.defaultView.alert(`Could not extract pattern: ${err.message}`);
    });
}

export function textareaFocus(noteWrap) {
  const ta = noteWrap.querySelector('.freeNoteBox');
  ta?.focus();
}

// Reusable across any "show this stored HTML with Worksheet-style
// interactivity" view (currently: worksheets themselves, and HTML-type
// course pages - see reader.js). `callbacks` supplies the backing store and
// AI call so this stays agnostic of which one it's talking to:
//   - listNotes() => Promise<{ notes }>
//   - createNote(blockIndex, charOffset, text) => Promise<{ id }>
//   - updateNote(noteId, text) => Promise<void>
//   - deleteNote(noteId) => Promise<void>
//   - askAi(question) => Promise<{ answer }>
//   - bookId: passed through to clickableGermanText.js's word-click options
export function applyClickableTextInsideFrame(iframe, callbacks) {
  let doc;
  try {
    doc = iframe.contentDocument;
  } catch {
    return; // not same-origin after all, or not ready yet - just skip
  }
  if (!doc || !doc.body) return;

  injectStyles(doc);

  getDictionary().then(async (dictionary) => {
    const getFrameRect = () => iframe.getBoundingClientRect();

    // Pristine block list + saved-note splitting happen FIRST, before
    // anything below touches the DOM - block indices/offsets are only
    // reproducible if computed against the worksheet exactly as uploaded.
    const blocks = computeBlocks(doc);
    const extraFragments = await applySavedNotes(doc, blocks, callbacks);
    wireUpAddNoteContextMenu(doc, iframe, blocks, extraFragments, dictionary, callbacks);

    // Some AI-made worksheets build their OWN "click a word to mark it"
    // feature site-wide, using the exact same class name ("word") this app
    // uses, on pre-existing <button class="word"> elements covering nearly
    // all of the worksheet's text (not just one bounded exercise, the way
    // Arbeitsblatt 17's #marking is) - snapshotting them before the
    // text-node pass below (which creates its OWN new .word spans) is the
    // only way to tell "the worksheet's own" apart from "ours".
    const preexistingWordEls = [...doc.querySelectorAll('.word')];

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
        for (let el = node.parentElement; el; el = el.parentElement) {
          if (el.matches?.(FORCE_WALKABLE_SELECTOR)) break;
          if (NON_CLICKABLE_ANCESTOR_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          if (el.matches?.(NON_CLICKABLE_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
          // A pre-existing .word element (not just one wrapped in a BUTTON,
          // like NON_CLICKABLE_ANCESTOR_TAGS already covers - a page can
          // ship its own plain <span class="word" data-start=...> too, e.g.
          // a Hören page's word-level timing spans) is already in
          // preexistingWordEls and gets wired up by that separate loop below
          // - without this, its own text node would ALSO get caught by this
          // walker and double-wrapped in a second, nested .word span, which
          // then swallows its click (via that inner span's own
          // stopPropagation) before the outer one - the one actually
          // carrying data-start/data-end/dataset.word - ever sees it.
          if (el.classList?.contains('word')) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node);

    for (const textNode of textNodes) {
      const span = doc.createElement('span');
      textNode.parentNode.replaceChild(span, textNode);
      const options = { dictionary, getFrameRect, bookId: callbacks.bookId || 'worksheet', page: 0, vocabStatus: callbacks.vocabStatus };
      const deFullEl = span.closest('.de-full');
      const curatedPhrases = deFullEl ? collectCuratedPhrases(deFullEl, dictionary) : [];
      if (curatedPhrases.length) wrapWithCuratedPhrases(span, textNode.nodeValue, curatedPhrases, options);
      else renderClickableGermanText(span, textNode.nodeValue, options);
    }

    // Add our translate/save/context actions on TOP of each pre-existing
    // word element's own click behavior (attachWordClickHandlers uses
    // addEventListener, so it never replaces whatever onclick the
    // worksheet's own script already assigned - e.g. its own "toggle this
    // word's highlight" stays working exactly as before, now alongside
    // ours). Best-effort sentence context for Ctrl/Cmd+Alt+click: the
    // nearest reasonable text container, falling back to just the word
    // itself if none is found.
    for (const el of preexistingWordEls) {
      const word = el.textContent.trim();
      if (!word || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(word)) continue;
      const context = el.closest('p, li, td, article, .mark');
      attachWordClickHandlers(el, word, {
        dictionary,
        getFrameRect,
        bookId: callbacks.bookId || 'worksheet',
        page: 0,
        vocabStatus: callbacks.vocabStatus,
        sentence: context ? context.textContent.trim() : word,
      });
    }

    wireUpPersianWordLookup(doc, getFrameRect);
    wireUpLearnDecisionBridge(doc);

    // popup.js's own "click outside a .word closes the popup" listener is
    // registered on THIS document only - a click inside the iframe's
    // document never bubbles up to it, so without this it'd never close
    // again once opened from inside the frame.
    doc.addEventListener('click', (e) => {
      if (!e.target.closest?.('.word') && !e.target.closest?.('.faWordAi')) hidePopup();
    });
  });
}

export async function renderWorksheets(host) {
  host.innerHTML = '<div class="loading">Loading…</div>';
  let worksheets;
  try {
    ({ worksheets } = await api.listWorksheets());
  } catch (err) {
    host.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
    return;
  }

  host.innerHTML = `
    <div class="formPage">
      <a href="#/">← Library</a>
      <h1>Worksheets</h1>
      <p class="hint">Upload a self-contained HTML page (e.g. one an AI assistant made for you) - it's shown back to you exactly as uploaded, nothing parsed or extracted.</p>

      <form id="wsForm">
        <label>Title (optional - taken from the file's own &lt;h1&gt;/&lt;title&gt; if left blank)<br>
          <input type="text" id="wsTitle" placeholder="Arbeitsblatt 17"></label><br><br>
        <label>HTML file<br>
          <input type="file" id="wsFile" accept="text/html,.html" required></label><br><br>
        <button type="submit" id="wsSubmit">Upload</button>
      </form>
      <div id="wsError" class="error"></div>

      <h2>Your worksheets</h2>
      <div id="wsList">${worksheets.length ? '' : '<p>No worksheets uploaded yet.</p>'}</div>
    </div>
  `;

  const listEl = host.querySelector('#wsList');
  renderList(worksheets);

  function renderList(items) {
    listEl.innerHTML = items
      .map(
        (w) => `
        <div class="wsRow" data-id="${w.id}">
          <a href="#/worksheets/${w.id}">${escapeHtml(w.title)}</a>
          <span class="wsDate">${new Date(w.createdAt).toLocaleDateString()}</span>
          <button type="button" class="wsDeleteBtn" data-id="${w.id}">Delete</button>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('.wsDeleteBtn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this worksheet?')) return;
        await api.deleteWorksheet(btn.dataset.id);
        btn.closest('.wsRow').remove();
        if (!listEl.querySelector('.wsRow')) listEl.innerHTML = '<p>No worksheets uploaded yet.</p>';
      });
    });
  }

  host.querySelector('#wsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = host.querySelector('#wsSubmit');
    const errorEl = host.querySelector('#wsError');
    const file = host.querySelector('#wsFile').files[0];
    if (!file) return;
    submitBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const { id, title } = await api.uploadWorksheet(file, host.querySelector('#wsTitle').value.trim());
      if (listEl.querySelector('p')) listEl.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'wsRow';
      row.dataset.id = id;
      row.innerHTML = `<a href="#/worksheets/${id}">${escapeHtml(title)}</a> <span class="wsDate">${new Date().toLocaleDateString()}</span> <button type="button" class="wsDeleteBtn" data-id="${id}">Delete</button>`;
      listEl.prepend(row);
      row.querySelector('.wsDeleteBtn').addEventListener('click', async () => {
        if (!confirm('Delete this worksheet?')) return;
        await api.deleteWorksheet(id);
        row.remove();
        if (!listEl.querySelector('.wsRow')) listEl.innerHTML = '<p>No worksheets uploaded yet.</p>';
      });
      host.querySelector('#wsForm').reset();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

export async function renderWorksheetViewer(host, worksheetId) {
  host.innerHTML = `
    <div class="wsViewerPage">
      <iframe class="wsViewerFrame" src="${api.worksheetViewUrl(worksheetId)}" sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups" title="Worksheet"></iframe>
    </div>
  `;
  const page = host.querySelector('.wsViewerPage');
  const iframe = host.querySelector('.wsViewerFrame');
  iframe.addEventListener('load', () =>
    applyClickableTextInsideFrame(iframe, {
      listNotes: () => api.listWorksheetNotes(worksheetId),
      createNote: (blockIndex, charOffset, text) => api.createWorksheetNote(worksheetId, blockIndex, charOffset, text),
      updateNote: (noteId, text) => api.updateWorksheetNoteText(worksheetId, noteId, text),
      deleteNote: (noteId) => api.deleteWorksheetNote(worksheetId, noteId),
      askAi: (question) => api.askWorksheetAi(question),
      bookId: 'worksheet',
    })
  );

  // Pins the viewer to start exactly where the app's own top nav ends,
  // instead of hardcoding its height (which varies - it wraps onto a
  // taller row on narrow screens) - keeps the nav visible and clickable
  // (including its own "Worksheets" link back to the list) above the
  // worksheet, replacing the old plain "← Worksheets" bar.
  const nav = document.querySelector('.topNav');
  function positionBelowNav() {
    page.style.top = nav ? `${nav.getBoundingClientRect().bottom}px` : '0px';
  }
  positionBelowNav();
  window.addEventListener('resize', positionBelowNav);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
