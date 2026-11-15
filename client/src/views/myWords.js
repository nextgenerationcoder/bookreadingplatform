import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';

const TRASH_ICON =
  '<svg class="trashIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4h10M6.5 4V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V4M4.5 4l.5 9.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1L12 4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_ICON =
  '<svg class="checkIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3.2 3.2L13 5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export async function renderMyWords(host) {
  host.innerHTML = '<div class="loading">Loading words…</div>';

  let clicks, dictionary, books, vocab;
  try {
    [clicks, dictionary, books, vocab] = await Promise.all([
      api.getWordClicks(),
      getDictionary(),
      api.listBooks(),
      api.getVocabProgress(),
    ]);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load your words.<br><small>${err.message}</small></div>`;
    return;
  }

  // Words that only exist in the wikidict backfill aren't part of the bulk
  // dictionary snapshot (it's kept small on purpose), so look those up
  // individually - each is an instant indexed DB hit, not a network call.
  const missing = Object.keys(clicks).filter((w) => !(normalizeWord(w) in dictionary));
  if (missing.length) {
    const results = await Promise.all(
      missing.map((w) => api.lookupWord(w).catch(() => null))
    );
    results.forEach((result) => {
      if (result) dictionary[normalizeWord(result.word)] = result.gloss;
    });
  }

  // Frequency rank (1 = most common) for whichever words are actually on
  // this page - not the whole 200k-word table. Missing from the response
  // means the word isn't in the top 200k (rare, or not real German) -
  // sorts to the very end either way.
  const allWords = [...new Set([...Object.keys(clicks), ...vocab.words.map((w) => w.german)])];
  const frequency = allWords.length ? await api.getWordFrequency(allWords).catch(() => ({})) : {};
  const rankOf = (word) => frequency[normalizeWord(word)] ?? Infinity;

  const titleById = Object.fromEntries(books.map((b) => [b.id, b.title]));
  const rows = Object.values(clicks).sort((a, b) => b.count - a.count);

  // "Structure" = a saved multi-word phrase/pattern (from the reader's
  // "Extract pattern (AI)", or any other "Change translation" on a
  // multi-word selection) - vocab_progress has no separate column for this,
  // so a space in `german` is the same test reader.js's own isPhrase check
  // already uses to tell a phrase from a single word. Kept entirely out of
  // the Vocabulary tabs below so a saved pattern shows up once, in
  // Structure, not duplicated into Learning/Passive/Learned too.
  const isStructure = (w) => w.german.includes(' ');
  const structures = vocab.words.filter(isStructure);
  const singleWords = vocab.words.filter((w) => !isStructure(w));

  const learned = singleWords.filter((w) => w.status === 'learned');
  const learning = singleWords.filter((w) => w.status === 'learning');
  const passive = singleWords.filter((w) => w.status === 'passive');

  host.innerHTML = `
    <div class="formPage">
      <h1>To Learn</h1>

      <div class="toLearnTabs">
        <button type="button" class="toLearnTabBtn active" data-section="words">Words</button>
        <button type="button" class="toLearnTabBtn" data-section="structure">Structure (${structures.length})</button>
      </div>

      <div id="wordsSection">
      <h2 class="wordsSectionTitle">Vocabulary</h2>
      <p class="hint">
        Words from lessons and from reading. <strong>Passive</strong> is every word you read past without
        tapping for a translation - assumed understood, but not tested. <strong>Learning</strong> is a word
        you tapped for a gloss (in a book) or answered on (in a lesson) - a word you're actively working on.
        <strong>Learned</strong> means you've answered it correctly ${vocab.learnedStreakThreshold} times in
        a row in a lesson - like Anki's idea of a mastery streak. Tapping a word you'd filed as passive moves
        it to Learning - a click is a clearer signal than a guess.
      </p>
      <div class="vocabTabs">
        <button class="vocabTabBtn active" data-tab="learning">Learning (${learning.length})</button>
        <button class="vocabTabBtn" data-tab="passive">Passive (${passive.length})</button>
        <button class="vocabTabBtn" data-tab="learned">Learned (${learned.length})</button>
        <label class="sortSelectLabel">
          Sort:
          <select id="vocabSort" class="sortSelect">
            <option value="recent">Recently practiced</option>
            <option value="frequency">Frequency (common first)</option>
          </select>
        </label>
      </div>
      <div class="wordsTableWrap">
        <table class="wordsTable">
          <thead>
            <tr>
              <th>Word</th>
              <th>Meaning</th>
              <th class="colHidden">Streak</th>
              <th class="colHidden">Frequency</th>
              <th class="colHidden">Last Practiced</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="vocabBody"></tbody>
        </table>
      </div>
      <div id="vocabEmptyState" class="loading" hidden></div>
      <div id="vocabActionStatus" class="importStatus error" hidden></div>

      <h2 class="wordsSectionTitle">Words Clicked While Reading</h2>
      <p class="hint">
        Every German word you've tapped while reading shows up here, with how many times and which book/page it was on.
      </p>
      <div class="wordsControls">
        <input id="filterInput" class="filterInput" type="text" placeholder="Search words…" dir="ltr">
        <label class="sortSelectLabel">
          Sort:
          <select id="wordsSort" class="sortSelect">
            <option value="clicks">Most clicked</option>
            <option value="frequency">Frequency (common first)</option>
          </select>
        </label>
      </div>
      <div class="wordsTableWrap">
        <table class="wordsTable">
          <thead>
            <tr>
              <th>Word</th>
              <th>Meaning</th>
              <th>Clicks</th>
              <th>Frequency</th>
              <th>Books</th>
              <th>Last Clicked</th>
            </tr>
          </thead>
          <tbody id="wordsBody"></tbody>
        </table>
      </div>
      <div id="emptyState" class="loading" hidden>You haven't clicked any words yet.</div>
      </div>

      <div id="structureSection" hidden>
        <h2 class="wordsSectionTitle">Structure</h2>
        <p class="hint">
          Multi-word phrases and patterns you've saved - e.g. via the reader's "Extract pattern (AI)" on a
          selection, or "Change translation" on a multi-word selection.
        </p>
        <div class="wordsTableWrap">
          <table class="wordsTable">
            <thead>
              <tr>
                <th>Structure</th>
                <th>Meaning</th>
                <th>Status</th>
                <th>Last Practiced</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="structureBody"></tbody>
          </table>
        </div>
        <div id="structureEmptyState" class="loading" hidden>No structures saved yet.</div>
      </div>
    </div>
  `;

  const vocabBody = host.querySelector('#vocabBody');
  const vocabEmptyState = host.querySelector('#vocabEmptyState');
  const vocabActionStatus = host.querySelector('#vocabActionStatus');
  const vocabTabBtns = host.querySelectorAll('.vocabTabBtn');
  const vocabSort = host.querySelector('#vocabSort');
  let activeVocabTab = 'learning';

  const VOCAB_LISTS = { learning, passive, learned };
  const VOCAB_EMPTY_TEXT = {
    learning: 'No words in progress yet.',
    passive: 'No passively-known words yet - they show up here as you read.',
    learned: 'No words learned yet - keep practicing!',
  };

  function frequencyCell(word) {
    const rank = rankOf(word);
    return rank === Infinity ? '—' : `#${rank.toLocaleString()}`;
  }

  function renderVocabRows() {
    let list = VOCAB_LISTS[activeVocabTab];
    if (vocabSort.value === 'frequency') {
      list = [...list].sort((a, b) => rankOf(a.german) - rankOf(b.german));
    }
    vocabBody.innerHTML = '';
    if (!list.length) {
      vocabEmptyState.hidden = false;
      vocabEmptyState.textContent = VOCAB_EMPTY_TEXT[activeVocabTab];
      return;
    }
    vocabEmptyState.hidden = true;
    for (const w of list) {
      const tr = document.createElement('tr');
      const streakCell = activeVocabTab === 'passive' ? '—' : `${w.correctStreak} / ${vocab.learnedStreakThreshold}`;
      const markKnownBtn =
        activeVocabTab === 'learned'
          ? ''
          : `<button class="linkButton markKnownBtn" data-word="${escapeAttr(w.german)}" data-persian="${escapeAttr(w.persian || '')}" title="Mark as known" aria-label="Mark as known">${CHECK_ICON}</button>`;
      const actionCell = `${markKnownBtn} <button class="linkButton deleteWordBtn" data-word="${escapeAttr(w.german)}" title="Delete" aria-label="Delete">${TRASH_ICON}</button>`;
      // Prefer the live shared dictionary gloss over the snapshot saved on
      // this row - vocab_progress.persian is whatever it was when the word
      // was last practiced, so a later "Change translation" edit (which
      // updates the dictionary, not this row) would otherwise never show up
      // here. Phrases aren't in the dictionary (it's single-word only), so
      // they always fall back to the row's own persian field.
      const meaning = dictionary[normalizeWord(w.german)] || w.persian;
      tr.innerHTML = `
        <td dir="ltr" class="wordCell">${escapeHtml(w.german)}</td>
        <td dir="rtl">${meaning ? escapeHtml(meaning) : '—'}</td>
        <td class="colHidden">${streakCell}</td>
        <td class="colHidden">${frequencyCell(w.german)}</td>
        <td class="colHidden">${formatRelative(w.lastSeenAt)}</td>
        <td>${actionCell}</td>
      `;
      vocabBody.appendChild(tr);
    }
  }

  // "I already know this, stop flagging it" - a manual override to 'learned'
  // (see routes/vocab.js's /mark-known), same action as right-clicking a
  // word in the reader or Reading Mode. Delegated on the table body since
  // rows are rebuilt wholesale on every tab/sort change.
  vocabBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.markKnownBtn');
    if (!btn) return;
    const german = btn.dataset.word;
    const persian = btn.dataset.persian;
    btn.disabled = true;
    btn.textContent = 'Marking…';
    vocabActionStatus.hidden = true;
    try {
      await api.markWordKnown(german, persian);
      let w = vocab.words.find((entry) => entry.german === german);
      if (w) {
        w.status = 'learned';
      } else {
        w = { german, persian, timesSeen: 1, timesCorrectTotal: 0, correctStreak: 0, status: 'learned', lastSeenAt: new Date().toISOString() };
        vocab.words.push(w);
      }
      if (!learned.includes(w)) learned.push(w);
      for (const list of [learning, passive]) {
        const idx = list.indexOf(w);
        if (idx !== -1) list.splice(idx, 1);
      }
      vocabTabBtns.forEach((b) => {
        b.textContent = `${b.dataset.tab[0].toUpperCase()}${b.dataset.tab.slice(1)} (${VOCAB_LISTS[b.dataset.tab].length})`;
      });
      renderVocabRows();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = CHECK_ICON;
      vocabActionStatus.textContent = `Could not mark "${german}" as known: ${err.message}`;
      vocabActionStatus.hidden = false;
    }
  });

  // Removes the word from this account's list entirely (unlike "Mark as
  // known", which only changes status) - see routes/vocab.js's DELETE
  // /api/vocab/:german.
  vocabBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.deleteWordBtn');
    if (!btn) return;
    const german = btn.dataset.word;
    if (!confirm(`Delete "${german}" from your word list?`)) return;
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    vocabActionStatus.hidden = true;
    try {
      await api.deleteVocabWord(german);
      vocab.words = vocab.words.filter((w) => w.german !== german);
      for (const list of [learning, passive, learned]) {
        const idx = list.findIndex((w) => w.german === german);
        if (idx !== -1) list.splice(idx, 1);
      }
      vocabTabBtns.forEach((b) => {
        b.textContent = `${b.dataset.tab[0].toUpperCase()}${b.dataset.tab.slice(1)} (${VOCAB_LISTS[b.dataset.tab].length})`;
      });
      renderVocabRows();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Delete';
      vocabActionStatus.textContent = `Could not delete "${german}": ${err.message}`;
      vocabActionStatus.hidden = false;
    }
  });

  vocabTabBtns.forEach((btn) => {
    btn.onclick = () => {
      activeVocabTab = btn.dataset.tab;
      vocabTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      renderVocabRows();
    };
  });
  vocabSort.addEventListener('change', renderVocabRows);
  renderVocabRows();

  const tbody = host.querySelector('#wordsBody');
  const filterInput = host.querySelector('#filterInput');
  const wordsSort = host.querySelector('#wordsSort');
  const emptyState = host.querySelector('#emptyState');

  function renderRows(filterText) {
    let filtered = filterText
      ? rows.filter((r) => normalizeWord(r.word).includes(filterText.toLowerCase()))
      : rows;
    if (wordsSort.value === 'frequency') {
      filtered = [...filtered].sort((a, b) => rankOf(a.word) - rankOf(b.word));
    }

    tbody.innerHTML = '';
    if (!filtered.length) {
      emptyState.hidden = false;
      emptyState.textContent = rows.length
        ? 'No words match that search.'
        : "You haven't clicked any words yet.";
      return;
    }
    emptyState.hidden = true;

    for (const row of filtered) {
      const tr = document.createElement('tr');
      const gloss = dictionary[normalizeWord(row.word)] || '—';
      const bookList = Object.entries(row.books)
        .map(([bookId, info]) => `${titleById[bookId] || bookId} (${info.count})`)
        .join(', ');

      tr.innerHTML = `
        <td dir="ltr" class="wordCell">${escapeHtml(row.word)}</td>
        <td dir="rtl">${escapeHtml(gloss)}</td>
        <td>${row.count}</td>
        <td>${frequencyCell(row.word)}</td>
        <td class="wrapCell">${escapeHtml(bookList)}</td>
        <td>${formatRelative(row.lastClickedAt)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  filterInput.addEventListener('input', () => renderRows(filterInput.value.trim()));
  wordsSort.addEventListener('change', () => renderRows(filterInput.value.trim()));
  renderRows('');

  // --- Structure (saved multi-word phrases/patterns) ---------------------

  const structureBody = host.querySelector('#structureBody');
  const structureEmptyState = host.querySelector('#structureEmptyState');
  const structureActionStatus = vocabActionStatus; // shares the same status line as Vocabulary's "Mark as known"

  function renderStructureRows() {
    structureBody.innerHTML = '';
    if (!structures.length) {
      structureEmptyState.hidden = false;
      return;
    }
    structureEmptyState.hidden = true;
    const sorted = [...structures].sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    for (const w of sorted) {
      const tr = document.createElement('tr');
      const meaning = w.persian; // phrases aren't in the shared single-word dictionary
      const markKnownBtn =
        w.status === 'learned'
          ? ''
          : `<button class="linkButton markKnownBtn" data-word="${escapeAttr(w.german)}" data-persian="${escapeAttr(w.persian || '')}" title="Mark as known" aria-label="Mark as known">${CHECK_ICON}</button>`;
      const actionCell = `${markKnownBtn} <button class="linkButton deleteWordBtn" data-word="${escapeAttr(w.german)}" title="Delete" aria-label="Delete">${TRASH_ICON}</button>`;
      tr.innerHTML = `
        <td dir="ltr" class="wordCell">${escapeHtml(w.german)}</td>
        <td dir="rtl">${meaning ? escapeHtml(meaning) : '—'}</td>
        <td>${escapeHtml(w.status)}</td>
        <td>${formatRelative(w.lastSeenAt)}</td>
        <td>${actionCell}</td>
      `;
      structureBody.appendChild(tr);
    }
  }

  // Shares the Vocabulary table's "Mark as known" handling (same button
  // class, same endpoint) - delegated here too since structureBody is a
  // separate tbody from vocabBody.
  structureBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.markKnownBtn');
    if (!btn) return;
    const german = btn.dataset.word;
    const persian = btn.dataset.persian;
    btn.disabled = true;
    btn.textContent = 'Marking…';
    structureActionStatus.hidden = true;
    try {
      await api.markWordKnown(german, persian);
      const w = structures.find((entry) => entry.german === german);
      if (w) w.status = 'learned';
      renderStructureRows();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = CHECK_ICON;
      structureActionStatus.textContent = `Could not mark "${german}" as known: ${err.message}`;
      structureActionStatus.hidden = false;
    }
  });

  // Same "remove entirely" action as the Vocabulary table's delete button,
  // delegated here too since structureBody is a separate tbody.
  structureBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.deleteWordBtn');
    if (!btn) return;
    const german = btn.dataset.word;
    if (!confirm(`Delete "${german}" from Structure?`)) return;
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    structureActionStatus.hidden = true;
    try {
      await api.deleteVocabWord(german);
      vocab.words = vocab.words.filter((w) => w.german !== german);
      const idx = structures.findIndex((w) => w.german === german);
      if (idx !== -1) structures.splice(idx, 1);
      host.querySelector('.toLearnTabBtn[data-section="structure"]').textContent = `Structure (${structures.length})`;
      renderStructureRows();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Delete';
      structureActionStatus.textContent = `Could not delete "${german}": ${err.message}`;
      structureActionStatus.hidden = false;
    }
  });

  renderStructureRows();

  // --- Top-level Words / Structure tabs -----------------------------------

  const toLearnTabBtns = host.querySelectorAll('.toLearnTabBtn');
  const wordsSection = host.querySelector('#wordsSection');
  const structureSection = host.querySelector('#structureSection');
  toLearnTabBtns.forEach((btn) => {
    btn.onclick = () => {
      toLearnTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      wordsSection.hidden = btn.dataset.section !== 'words';
      structureSection.hidden = btn.dataset.section !== 'structure';
    };
  });
}

function formatRelative(isoString) {
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
