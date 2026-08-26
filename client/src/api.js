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

async function del(url) {
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function postForm(url, formData) {
  const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
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
  deleteBook: (bookId) => del(`/api/books/${bookId}`),
  deletePage: (bookId, pageNumber) => del(`/api/books/${bookId}/pages/${pageNumber}`),
  analyzePages: (files, startPage, chapter) => {
    const fd = new FormData();
    for (const file of files) fd.append('images', file);
    fd.append('startPage', startPage);
    fd.append('chapter', chapter || '');
    return postForm('/api/ocr/batch', fd);
  },
  // Kicks off background PDF processing and returns { jobId, bookId }
  // immediately - poll getPdfImportStatus(jobId) for progress. Pages are
  // saved to the book as they complete, so it can be read while still
  // importing.
  importBookFromPdf: (file, bookId, title, startPage, chapter) => {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('bookId', bookId);
    fd.append('title', title || '');
    fd.append('startPage', startPage);
    fd.append('chapter', chapter || '');
    return postForm('/api/books/import-pdf', fd);
  },
  getPdfImportStatus: (jobId) => get(`/api/books/import-pdf/${jobId}/status`),
  cancelPdfImport: (jobId) => post(`/api/books/import-pdf/${jobId}/cancel`, {}),
  getActivePdfImports: () => get('/api/books/import-pdf/active'),
  getPdfImportHistory: () => get('/api/books/import-pdf/history'),
  getCourseLevels: () => get('/api/courses/levels'),
  listCourses: (level) => get(`/api/courses${level ? `?level=${encodeURIComponent(level)}` : ''}`),
  getCourse: (courseId) => get(`/api/courses/${courseId}`),
  importCourse: (text) => post('/api/courses/import', { text }),
  appendToCourse: (courseId, text) => post(`/api/courses/${courseId}/append`, { text }),
  renameCourse: (courseId, title) => patch(`/api/courses/${courseId}`, { title }),
  deleteCoursePage: (courseId, pageNumber) => del(`/api/courses/${courseId}/pages/${pageNumber}`),

  getDictionary: () => get('/api/dictionary'),
  importDictionary: (text) => post('/api/dictionary/import', { text }),
  lookupWord: (word) => get(`/api/dictionary/lookup/${encodeURIComponent(word)}`),
  getProgress: (bookId) => get(`/api/progress/${bookId}`),
  setProgress: (bookId, page) => post(`/api/progress/${bookId}`, { page }),
  recordWordClick: (bookId, page, word) => post('/api/word-clicks', { bookId, page, word }),
  getWordClicks: () => get('/api/word-clicks'),

  getLlmSettings: () => get('/api/settings/llm'),
  saveLlmSettings: (provider, apiKey) => post('/api/settings/llm', { provider, apiKey }),
  clearLlmSettings: () => del('/api/settings/llm'),

  getVisionSettings: () => get('/api/settings/vision'),
  saveVisionSettings: (provider, apiKey) => post('/api/settings/vision', { provider, apiKey }),
  clearVisionSettings: () => del('/api/settings/vision'),

  getVoices: () => get('/api/tts/voices'),
  getVoiceSettings: () => get('/api/settings/voice'),
  saveVoiceSettings: (voiceId, speechRate) => post('/api/settings/voice', { voiceId, speechRate }),
  synthesize: (text) => post('/api/tts/synthesize', { text }),

  listLearningCourses: () => get('/api/learning/courses'),
  getLearningCourse: (courseId) => get(`/api/learning/courses/${courseId}`),
  getLearningLesson: (courseId, lessonId) => get(`/api/learning/courses/${courseId}/lessons/${lessonId}`),
  saveLearningStep: (courseId, lessonId, body) =>
    post(`/api/learning/courses/${courseId}/lessons/${lessonId}/progress`, body),
  submitExitCheck: (courseId, lessonId, responses) =>
    post(`/api/learning/courses/${courseId}/lessons/${lessonId}/exit-check`, { responses }),
  submitRetrievalChallenge: (courseId, lessonId, responses) =>
    post(`/api/learning/courses/${courseId}/lessons/${lessonId}/retrieval`, { responses }),
  uploadRecording: (blob) => {
    const fd = new FormData();
    fd.append('audio', blob, `recording.${blob.type.includes('mp4') ? 'mp4' : blob.type.includes('wav') ? 'wav' : 'webm'}`);
    return postForm('/api/learning/recordings', fd);
  },
  recordingUrl: (recordingId) => `/api/learning/recordings/${recordingId}`,
};
