import { api } from '../api.js';

// Copy text on your phone (a job posting, an article) and share it into
// this app - Android's share sheet sends the selection as plain text, not
// a URL, so there's nothing to fetch server-side; the shared text lands
// straight in the box below, pre-filled and ready to translate. See
// main.js's redirectShareTargetToHash(), which is what actually stashes it
// in sessionStorage before this view ever runs.
//
// Also reachable manually via the drawer's "Import Text" link, with the
// box starting empty.
export async function renderImportUrl(host) {
  const pendingText = sessionStorage.getItem('pendingShareText') || '';
  const pendingTitle = sessionStorage.getItem('pendingShareTitle') || '';
  sessionStorage.removeItem('pendingShareText');
  sessionStorage.removeItem('pendingShareTitle');

  let llmSettings = { configured: false };
  try {
    llmSettings = await api.getLlmSettings();
  } catch {
    // leave unconfigured - the page below just shows the Settings link
  }

  host.innerHTML = `
    <div class="formPage">
      <h1>Import Text</h1>
      <p class="hint">
        Copy text from anywhere (a job posting, an article) and share it into this app, or paste it
        below yourself. It's translated into German + Persian and added to your Books library - just
        like the PDF import, but for copied text instead of a file.
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
      <input id="pasteTitleInput" class="filterInput" type="text" placeholder="Title (optional)" dir="ltr" value="${escapeAttr(pendingTitle)}">
      <textarea id="pasteTextInput" dir="ltr" placeholder="Paste text here…">${escapeHtml(pendingText)}</textarea>
      <div class="formActions">
        <button id="importPasteBtn" ${llmSettings.configured ? '' : 'disabled'}>Import & Translate</button>
        <a href="#/">Cancel</a>
      </div>
      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const titleInput = host.querySelector('#pasteTitleInput');
  const textInput = host.querySelector('#pasteTextInput');
  const btn = host.querySelector('#importPasteBtn');
  const status = host.querySelector('#importStatus');

  btn.onclick = async () => {
    const text = textInput.value.trim();
    if (!text) {
      status.textContent = 'Paste some text first.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Translating… this can take a little while for a long page.';
    status.className = 'importStatus';
    try {
      const meta = await api.importPastedText(text, titleInput.value.trim());
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

  if (pendingText) textInput.focus();
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
