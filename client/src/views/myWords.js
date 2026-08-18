import { api } from '../api.js';
import { getDictionary, normalizeWord } from '../state.js';

export async function renderMyWords(host) {
  host.innerHTML = '<div class="loading">در حال بارگذاری واژه‌ها…</div>';

  let clicks, dictionary, books;
  try {
    [clicks, dictionary, books] = await Promise.all([
      api.getWordClicks(),
      getDictionary(),
      api.listBooks(),
    ]);
  } catch (err) {
    host.innerHTML = `<div class="error">دریافت واژه‌ها با خطا مواجه شد.<br><small>${err.message}</small></div>`;
    return;
  }

  const titleById = Object.fromEntries(books.map((b) => [b.id, b.title]));
  const rows = Object.values(clicks).sort((a, b) => b.count - a.count);

  host.innerHTML = `
    <div class="formPage" dir="rtl">
      <h1>واژه‌های من</h1>
      <p class="hint">
        هر واژهٔ آلمانی که در حین مطالعه رویش کلیک کرده‌ای، همراه با تعداد دفعات و اینکه در کدام کتاب/صفحه بوده، اینجا نشان داده می‌شود.
      </p>
      <input id="filterInput" class="filterInput" type="text" placeholder="جست‌وجوی واژه…" dir="ltr">
      <div class="wordsTableWrap">
        <table class="wordsTable">
          <thead>
            <tr>
              <th>واژه</th>
              <th>معنی</th>
              <th>تعداد کلیک</th>
              <th>کتاب‌ها</th>
              <th>آخرین بار</th>
            </tr>
          </thead>
          <tbody id="wordsBody"></tbody>
        </table>
      </div>
      <div id="emptyState" class="loading" hidden>هنوز روی هیچ واژه‌ای کلیک نکرده‌ای.</div>
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
        ? 'هیچ واژه‌ای با این جست‌وجو پیدا نشد.'
        : 'هنوز روی هیچ واژه‌ای کلیک نکرده‌ای.';
      return;
    }
    emptyState.hidden = true;

    for (const row of filtered) {
      const tr = document.createElement('tr');
      const gloss = dictionary[normalizeWord(row.word)] || '—';
      const bookList = Object.entries(row.books)
        .map(([bookId, info]) => `${titleById[bookId] || bookId} (${info.count})`)
        .join('، ');

      tr.innerHTML = `
        <td dir="ltr" class="wordCell">${escapeHtml(row.word)}</td>
        <td>${escapeHtml(gloss)}</td>
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
  if (minutes < 1) return 'همین الان';
  if (minutes < 60) return `${minutes} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.floor(hours / 24);
  return `${days} روز پیش`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
