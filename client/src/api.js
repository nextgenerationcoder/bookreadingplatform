async function extractError(res) {
  try {
    const body = await res.json();
    return body?.error || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

// credentials: 'include' sends/accepts the session cookie so login works the
// same in dev (client on :5173, API on :4000) and in production (same origin).
async function get(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function patch(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export const api = {
  signup: (email, password) => post('/api/auth/signup', { email, password }),
  login: (email, password) => post('/api/auth/login', { email, password }),
  logout: () => post('/api/auth/logout', {}),
  me: () => get('/api/auth/me'),

  listBooks: () => get('/api/books'),
  getBook: (bookId) => get(`/api/books/${bookId}`),
  importBook: (text) => post('/api/books/import', { text }),
  appendToBook: (bookId, text) => post(`/api/books/${bookId}/append`, { text }),
  renameBook: (bookId, title) => patch(`/api/books/${bookId}`, { title }),
  getDictionary: () => get('/api/dictionary'),
  importDictionary: (text) => post('/api/dictionary/import', { text }),
  getProgress: (bookId) => get(`/api/progress/${bookId}`),
  setProgress: (bookId, page) => post(`/api/progress/${bookId}`, { page }),
  recordWordClick: (bookId, page, word) => post('/api/word-clicks', { bookId, page, word }),
  getWordClicks: () => get('/api/word-clicks'),
};
