const USER_ID_KEY = 'bookPlatformUserId';

export function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

async function extractError(res) {
  try {
    const body = await res.json();
    return body?.error || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function patch(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export const api = {
  listBooks: () => get('/api/books'),
  getBook: (bookId) => get(`/api/books/${bookId}`),
  importBook: (text) => post('/api/books/import', { text }),
  appendToBook: (bookId, text) => post(`/api/books/${bookId}/append`, { text }),
  renameBook: (bookId, title) => patch(`/api/books/${bookId}`, { title }),
  getDictionary: () => get('/api/dictionary'),
  getProgress: (bookId) => get(`/api/progress/${bookId}?userId=${getUserId()}`),
  setProgress: (bookId, page) =>
    post(`/api/progress/${bookId}`, { userId: getUserId(), page }),
  recordWordClick: (bookId, page, word) =>
    post('/api/word-clicks', { userId: getUserId(), bookId, page, word }),
  getWordClicks: () => get(`/api/word-clicks?userId=${getUserId()}`),
};
