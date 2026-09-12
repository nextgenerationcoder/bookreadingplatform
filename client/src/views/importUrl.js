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
        Fetched (or pasted) text gets translated into German + Persian and added to your Books library
        page by page - just like the PDF import, but for a webpage instead of a file.
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
      <div class="vocabTabs">
        <button class="vocabTabBtn active" data-tab="url" type="button">From URL</button>
        <button class="vocabTabBtn" data-tab="paste" type="button">Paste Page Text</button>
      </div>

      <div id="urlPane">
        <p class="hint" style="padding:0">
          Works for ordinary public pages (articles, blog posts). Won't work for pages that need a
          login or run mostly on JavaScript to show their content (LinkedIn job postings, for
          example) - use "Paste Page Text" for those instead.
        </p>
        <input id="urlInput" class="filterInput" type="url" placeholder="https://example.com/article" dir="ltr" value="${escapeAttr(sharedUrl || '')}">
        <div class="formActions">
          <button id="importUrlBtn" ${llmSettings.configured ? '' : 'disabled'}>Import & Translate</button>
          <a href="#/">Cancel</a>
        </div>
      </div>

      <div id="pastePane" hidden>
        <p class="hint" style="padding:0">
          Open the page on your phone (logged in if it needs that), select all the text you want,
          copy it, and paste it below.
        </p>
        <input id="pasteTitleInput" class="filterInput" type="text" placeholder="Title (optional)" dir="ltr">
        <textarea id="pasteTextInput" dir="ltr" placeholder="Paste the page's text here…"></textarea>
        <div class="formActions">
          <button id="importPasteBtn" ${llmSettings.configured ? '' : 'disabled'}>Import & Translate</button>
          <a href="#/">Cancel</a>
        </div>
      </div>

      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const tabBtns = host.querySelectorAll('.vocabTabBtn');
  const urlPane = host.querySelector('#urlPane');
  const pastePane = host.querySelector('#pastePane');
  const status = host.querySelector('#importStatus');

  tabBtns.forEach((btn) => {
    btn.onclick = () => {
      tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      urlPane.hidden = btn.dataset.tab !== 'url';
      pastePane.hidden = btn.dataset.tab !== 'paste';
      status.textContent = '';
      status.className = 'importStatus';
    };
  });

  function goToNewBook(meta) {
    const errorNote = meta.errors?.length ? ` (${meta.errors.length} page${meta.errors.length === 1 ? '' : 's'} failed to translate)` : '';
    status.textContent = `"${meta.title}" was added successfully (${meta.pageCount} pages)${errorNote}.`;
    status.className = 'importStatus success';
    setTimeout(() => {
      window.location.hash = `#/book/${encodeURIComponent(meta.id)}`;
    }, 800);
  }

  const urlInput = host.querySelector('#urlInput');
  const importUrlBtn = host.querySelector('#importUrlBtn');
  importUrlBtn.onclick = async () => {
    const url = urlInput.value.trim();
    if (!url) {
      status.textContent = 'Paste a URL first.';
      status.className = 'importStatus error';
      return;
    }
    importUrlBtn.disabled = true;
    status.textContent = 'Fetching and translating… this can take a little while for a long page.';
    status.className = 'importStatus';
    try {
      goToNewBook(await api.importUrl(url));
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      importUrlBtn.disabled = false;
    }
  };

  const pasteTitleInput = host.querySelector('#pasteTitleInput');
  const pasteTextInput = host.querySelector('#pasteTextInput');
  const importPasteBtn = host.querySelector('#importPasteBtn');
  importPasteBtn.onclick = async () => {
    const text = pasteTextInput.value.trim();
    if (!text) {
      status.textContent = 'Paste some text first.';
      status.className = 'importStatus error';
      return;
    }
    importPasteBtn.disabled = true;
    status.textContent = 'Translating… this can take a little while for a long page.';
    status.className = 'importStatus';
    try {
      goToNewBook(await api.importPastedText(text, pasteTitleInput.value.trim()));
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      importPasteBtn.disabled = false;
    }
  };

  if (sharedUrl) urlInput.focus();
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
