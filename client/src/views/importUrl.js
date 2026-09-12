import { api } from '../api.js';

// Reachable two ways: manually via the drawer's "Import Web Page" link
// (sharedUrl undefined/empty, field starts blank), or via Android's share
// sheet - main.js's redirectShareTargetToHash() turns the real
// /share-target?... landing (see client/public/manifest.json's
// share_target) into #/import-url?url=..., pre-filling the field here.
export async function renderImportUrl(host, sharedUrl) {
  let llmSettings = { configured: false };
  try {
    llmSettings = await api.getLlmSettings();
  } catch {
    // leave unconfigured - the page below just shows the Settings link
  }

  host.innerHTML = `
    <div class="formPage">
      <h1>Import Web Page</h1>
      <p class="hint">
        Paste a link (or share one into this app from Chrome/another app), and it's fetched, translated
        into German + Persian, and added to your Books library page by page - just like the PDF import,
        but for a webpage instead of a file.
      </p>
      ${
        llmSettings.configured
          ? ''
          : `<div class="ocrBox">
               <p class="hint" style="padding:0">
                 This needs a Translation API key configured first — <a href="#/settings">add one in Settings</a>.
               </p>
             </div>`
      }
      <input id="urlInput" class="filterInput" type="url" placeholder="https://example.com/article" dir="ltr" value="${escapeAttr(sharedUrl || '')}">
      <div class="formActions">
        <button id="importUrlBtn" ${llmSettings.configured ? '' : 'disabled'}>Import & Translate</button>
        <a href="#/">Cancel</a>
      </div>
      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const input = host.querySelector('#urlInput');
  const btn = host.querySelector('#importUrlBtn');
  const status = host.querySelector('#importStatus');

  btn.onclick = async () => {
    const url = input.value.trim();
    if (!url) {
      status.textContent = 'Paste a URL first.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Fetching and translating… this can take a little while for a long page.';
    status.className = 'importStatus';
    try {
      const meta = await api.importUrl(url);
      const errorNote = meta.errors?.length ? ` (${meta.errors.length} page${meta.errors.length === 1 ? '' : 's'} failed to translate)` : '';
      status.textContent = `"${meta.title}" was added successfully (${meta.pageCount} pages)${errorNote}.`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/book/${encodeURIComponent(meta.id)}`;
      }, 800);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      btn.disabled = false;
    }
  };

  if (sharedUrl) input.focus();
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
