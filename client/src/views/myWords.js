import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';

export async function renderMyWords(host) {
  host.innerHTML = '<div class="loading">Loading words…</div>';

  let clicks, dictionary, books;
  try {
    [clicks, dictionary, books] = await Promise.all([
      api.getWordClicks(),
      getDictionary(),
      api.listBooks(),
    ]);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load your words.<br><small>${err.message}</small></div>`;
    return;
  }

  const titleById = Object.fromEntries(books.map((b) => [b.id, b.title]));
  const rows = Object.values(clicks).sort((a, b) => b.count - a.count);

  host.innerHTML = `
    <div class="formPage">
      <h1>My Words</h1>
      <p class="hint">
        Every German word you've tapped while reading shows up here, with how many times and which book/page it was on.
      </p>
      <input id="filterInput" class="filterInput" type="text" placeholder="Search words…" dir="ltr">
      <div class="wordsTableWrap">
        <table class="wordsTable">
          <thead>
            <tr>
              <th>Word</th>
              <th>Meaning</th>
              <th>Clicks</th>
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

  const tbody = host.querySelector('#wordsBody');
  const filterInput = host.querySelector('#filterInput');
  const emptyState = host.querySelector('#emptyState');

  function renderRows(filterText) {
    const filtered = filterText
      ? rows.filter((r) => normalizeWord(r.word).includes(filterText.toLowerCase()))
      : rows;

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
        <td>${escapeHtml(bookList)}</td>
        <td>${formatRelative(row.lastClickedAt)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  filterInput.addEventListener('input', () => renderRows(filterInput.value.trim()));
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
