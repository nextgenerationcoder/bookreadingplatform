// Service worker: the only place in the extension that holds the session
// token and talks to the API. Content scripts run inside arbitrary
// third-party pages, so their own fetch() calls would be subject to that
// page's CSP (many sites block cross-origin connect-src) - routing every
// request through here sidesteps that entirely, and keeps the token out of
// the page's JS context.

const API_BASE = 'https://book.amirseyti.de';

async function getToken() {
  const { authToken } = await chrome.storage.local.get('authToken');
  return authToken || null;
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // no/invalid JSON body
  }
  if (res.status === 401) {
    await chrome.storage.local.remove(['authToken', 'authEmail']);
  }
  if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
  return body;
}

async function login(email, password) {
  const data = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await chrome.storage.local.set({ authToken: data.token, authEmail: data.email });
  return data;
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    // token may already be invalid/expired - still clear local state below
  }
  await chrome.storage.local.remove(['authToken', 'authEmail']);
}

async function getAuthState() {
  const token = await getToken();
  if (!token) return { loggedIn: false };
  try {
    const me = await apiFetch('/api/auth/me');
    return { loggedIn: true, email: me.email };
  } catch {
    await chrome.storage.local.remove(['authToken', 'authEmail']);
    return { loggedIn: false };
  }
}

async function lookupWord(word) {
  return apiFetch(`/api/dictionary/lookup/${encodeURIComponent(word)}`);
}

async function getVocabStatus() {
  const data = await apiFetch('/api/vocab');
  const statusMap = {};
  for (const w of data.words) statusMap[w.german.toLowerCase()] = w.status;
  return statusMap;
}

async function syncReadingPage(toLearn, passive) {
  return apiFetch('/api/vocab/reading-page', {
    method: 'POST',
    body: JSON.stringify({ toLearn, passive }),
  });
}

async function markWordKnown(german, persian) {
  return apiFetch('/api/vocab/mark-known', {
    method: 'POST',
    body: JSON.stringify({ german, persian }),
  });
}

async function markWordUnknown(german, persian) {
  return apiFetch('/api/vocab/mark-unknown', {
    method: 'POST',
    body: JSON.stringify({ german, persian }),
  });
}

// Reuses the same bulk "word = gloss" import parser the website's Add Words
// admin page uses - see dictionaryImporter.js - so a single-word translation
// change from Reading Mode's menu updates the shared dictionary exactly like
// a manual re-import would.
async function updateDictionaryGloss(word, gloss) {
  return apiFetch('/api/dictionary/import', {
    method: 'POST',
    body: JSON.stringify({ text: `${word} = ${gloss}` }),
  });
}

const HANDLERS = {
  GET_AUTH_STATE: () => getAuthState(),
  LOGIN: (msg) => login(msg.email, msg.password),
  LOGOUT: () => logout(),
  LOOKUP_WORD: (msg) => lookupWord(msg.word),
  GET_VOCAB_STATUS: () => getVocabStatus(),
  SYNC_READING_PAGE: (msg) => syncReadingPage(msg.toLearn, msg.passive),
  MARK_WORD_KNOWN: (msg) => markWordKnown(msg.german, msg.persian),
  MARK_WORD_UNKNOWN: (msg) => markWordUnknown(msg.german, msg.persian),
  UPDATE_DICTIONARY_GLOSS: (msg) => updateDictionaryGloss(msg.word, msg.gloss),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown message type: ${msg?.type}` });
    return false;
  }
  handler(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // keep the message channel open for the async response above
});

// Right-click "Import to Book Reading Platform" on any selected text - the
// same browser-chrome entry point tools like Language Reactor use. Reuses
// the site's existing #/import-url page (client/src/views/importUrl.js)
// rather than inventing a second import path: opens it in a new tab and
// fills in the selection, exactly as if the user had pasted it themselves.
// The page itself already handles "not logged in" and "no Translation key
// configured" - nothing extra to do here for either case.
const IMPORT_SELECTION_MENU_ID = 'lex-import-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: IMPORT_SELECTION_MENU_ID,
      title: 'Import to Book Reading Platform',
      contexts: ['selection'],
    });
  });
});

function fillImportForm(selectedText, pageTitle) {
  const tryFill = () => {
    const textarea = document.querySelector('#pasteTextInput');
    if (!textarea) return false;
    textarea.value = selectedText;
    const titleInput = document.querySelector('#pasteTitleInput');
    if (titleInput && !titleInput.value) titleInput.value = pageTitle || '';
    textarea.focus();
    return true;
  };
  if (tryFill()) return;
  // The SPA may still be mounting the import view right after navigation -
  // poll briefly rather than assuming the DOM is ready.
  let attempts = 0;
  const interval = setInterval(() => {
    attempts += 1;
    if (tryFill() || attempts > 20) clearInterval(interval);
  }, 100);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== IMPORT_SELECTION_MENU_ID) return;
  const text = info.selectionText || '';
  if (!text.trim()) return;

  chrome.tabs.create({ url: `${API_BASE}/#/import-url` }, (newTab) => {
    const onUpdated = (tabId, info2) => {
      if (tabId !== newTab.id || info2.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.scripting.executeScript({
        target: { tabId: newTab.id },
        func: fillImportForm,
        args: [text, tab?.title || ''],
      });
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
});
