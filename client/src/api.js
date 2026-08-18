const USER_ID_KEY = 'bookPlatformUserId';

export function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

export const api = {
  listBooks: () => get('/api/books'),
  getBook: (bookId) => get(`/api/books/${bookId}`),
  getDictionary: () => get('/api/dictionary'),
  getProgress: (bookId) => get(`/api/progress/${bookId}?userId=${getUserId()}`),
  setProgress: (bookId, page) =>
    post(`/api/progress/${bookId}`, { userId: getUserId(), page }),
  recordWordClick: (bookId, page, word) =>
    post('/api/word-clicks', { userId: getUserId(), bookId, page, word }),
  getWordClicks: () => get(`/api/word-clicks?userId=${getUserId()}`),
};
