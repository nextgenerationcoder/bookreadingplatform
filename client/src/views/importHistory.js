import { api } from '../api.js';

const STATUS_LABEL = {
  running: 'Running…',
  done: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
};

export async function renderImportHistory(host) {
  host.innerHTML = '<div class="loading">Loading…</div>';

  let jobs;
  try {
    jobs = await api.getPdfImportHistory();
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load import history.<br><small>${err.message}</small></div>`;
    return;
  }

  if (!jobs.length) {
    host.innerHTML = `
      <div class="loading">
        No PDF imports yet.
        <br><br>
        <a class="button" href="#/add">Import a book</a>
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Import History</h1>
    </div>
    <div class="historyList"></div>
  `;

  const list = host.querySelector('.historyList');
  for (const job of jobs) {
    list.appendChild(renderHistoryItem(job));
  }
}

function renderHistoryItem(job) {
  const item = document.createElement('div');
  item.className = 'bookCard';

  const when = formatWhen(job.finishedAt || job.createdAt);
  const failCount = job.errors?.length || 0;
  const progress = job.totalPages
    ? `Part ${job.currentChunk || 1} of ${job.totalChunks || 1} — page ${job.currentPage} of ${job.totalPages}`
    : 'Reading the PDF…';

  item.innerHTML = `
    <a class="bookCardTitle" href="#/book/${encodeURIComponent(job.bookId)}">${escapeHtml(job.title || job.bookId)}</a>
    <div class="bookCardMeta">
      <span class="historyBadge historyBadge-${job.status}">${STATUS_LABEL[job.status] || job.status}</span>
      · ${job.pagesFound} page${job.pagesFound === 1 ? '' : 's'} added
      ${job.totalPages ? ` of ${job.totalPages}` : ''}
      ${failCount ? ` · ${failCount} skipped` : ''}
      · ${when}
    </div>
    ${job.status === 'running' ? `<div class="hint" style="padding:6px 0 0">${progress}</div>` : ''}
    ${job.status === 'error' && job.error ? `<div class="hint" style="padding:6px 0 0;color:#b3261e">${escapeHtml(job.error)}</div>` : ''}
    ${failCount ? '<details class="exampleBox" style="margin:8px 0 0"><summary>Skipped pages</summary></details>' : ''}
  `;

  if (failCount) {
    const list = document.createElement('ul');
    list.style.margin = '10px 0 0';
    for (const e of job.errors) {
      const li = document.createElement('li');
      li.textContent = `Page ${e.pageNumber}: ${e.error}`;
      list.appendChild(li);
    }
    item.querySelector('.exampleBox').appendChild(list);
  }

  return item;
}

function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
