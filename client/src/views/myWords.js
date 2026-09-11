import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';

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

  const learned = vocab.words.filter((w) => w.status === 'learned');
  const learning = vocab.words.filter((w) => w.status === 'learning');
  const passive = vocab.words.filter((w) => w.status === 'passive');

  host.innerHTML = `
    <div class="formPage">
      <h1>My Words</h1>

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
              <th>Streak</th>
              <th>Frequency</th>
              <th>Last Practiced</th>
            </tr>
          </thead>
          <tbody id="vocabBody"></tbody>
        </table>
      </div>
      <div id="vocabEmptyState" class="loading" hidden></div>

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
  `;

  const vocabBody = host.querySelector('#vocabBody');
  const vocabEmptyState = host.querySelector('#vocabEmptyState');
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
      tr.innerHTML = `
        <td dir="ltr" class="wordCell">${escapeHtml(w.german)}</td>
        <td dir="rtl">${w.persian ? escapeHtml(w.persian) : '—'}</td>
        <td>${streakCell}</td>
        <td>${frequencyCell(w.german)}</td>
        <td>${formatRelative(w.lastSeenAt)}</td>
      `;
      vocabBody.appendChild(tr);
    }
  }

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
