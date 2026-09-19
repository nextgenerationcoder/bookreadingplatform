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

const HANDLERS = {
  GET_AUTH_STATE: () => getAuthState(),
  LOGIN: (msg) => login(msg.email, msg.password),
  LOGOUT: () => logout(),
  LOOKUP_WORD: (msg) => lookupWord(msg.word),
  GET_VOCAB_STATUS: () => getVocabStatus(),
  SYNC_READING_PAGE: (msg) => syncReadingPage(msg.toLearn, msg.passive),
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
