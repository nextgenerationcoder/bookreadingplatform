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

  getGrammarLevels: () => get('/api/grammar/levels'),
  listGrammarLessons: (level) => get(`/api/grammar${level ? `?level=${encodeURIComponent(level)}` : ''}`),
  getGrammarLesson: (id) => get(`/api/grammar/lesson/${encodeURIComponent(id)}`),
  explainMistake: (body) => post('/api/grammar/explain-mistake', body),

  listPracticeCourses: () => get('/api/practice/courses'),
  getPracticeCourse: (courseId) => get(`/api/practice/courses/${encodeURIComponent(courseId)}`),
  generatePracticeCourse: (title) => post('/api/practice/generate', { title }),
  deletePracticeCourse: (courseId) => del(`/api/practice/courses/${encodeURIComponent(courseId)}`),

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

  getAsrSettings: () => get('/api/settings/asr'),
  saveAsrSettings: (provider, apiKey) => post('/api/settings/asr', { provider, apiKey }),
  clearAsrSettings: () => del('/api/settings/asr'),

  getVoices: () => get('/api/tts/voices'),
  getVoiceSettings: () => get('/api/settings/voice'),
  saveVoiceSettings: (voiceId, speechRate) => post('/api/settings/voice', { voiceId, speechRate }),
  synthesize: (text) => post('/api/tts/synthesize', { text }),

  // wavBlob: a Blob already converted to WAV (see lessonEngine/audioToWav.js).
  // hotwords: already-taught words to bias recognition toward - see asr.js.
  transcribeAudio: (wavBlob, { hotwords } = {}) => {
    const fd = new FormData();
    fd.append('audio', wavBlob, 'audio.wav');
    for (const word of hotwords || []) fd.append('hotwords', word);
    return postForm('/api/asr/transcribe', fd);
  },

  listInterviewLessons: () => get('/api/interview-lessons'),
  getInterviewLesson: (courseId) => get(`/api/interview-lessons/${encodeURIComponent(courseId)}`),
  importInterviewLesson: (text) => post('/api/interview-lessons/import', { text }),
  deleteInterviewLesson: (courseId) => del(`/api/interview-lessons/${encodeURIComponent(courseId)}`),

  // words: [{german, persian}] - every word a lesson step introduced, sent
  // together in one call per answer-check. See routes/vocab.js.
  recordVocab: (words, correct) => post('/api/vocab/record', { words, correct }),
  getVocabProgress: () => get('/api/vocab'),

  // toLearn/passive: [{german, persian}] - every word on a finished reading
  // page, split by whether it was clicked (see reader.js's "Finish Page").
  recordReadingPage: (toLearn, passive) => post('/api/vocab/reading-page', { toLearn, passive }),

  // Manual "I already know this" override - right-click a word in the
  // reader/Reading Mode, or the "Mark as known" button on My Words.
  markWordKnown: (german, persian) => post('/api/vocab/mark-known', { german, persian }),

  // The opposite manual override - right-click menu's "Mark unknown".
  markWordUnknown: (german, persian) => post('/api/vocab/mark-unknown', { german, persian }),

  // Forcibly overwrites a word's saved translation, unlike markWordKnown/
  // markWordUnknown (which only fill persian in if blank) - used by
  // clickableGermanText.js's Ctrl/Cmd+Alt+click to fix a wrong translation
  // that was already saved.
  updateWordTranslation: (german, persian) => post('/api/vocab/update-translation', { german, persian }),

  // Removes a word/structure from My Words/To Learn entirely - the delete
  // button on both the Words and Structure tabs (see myWords.js).
  deleteVocabWord: (german) => del(`/api/vocab/${encodeURIComponent(german)}`),

  // Right-click menu's "Change translation" for a single word - reuses the
  // same "word = gloss" bulk-import parser the Add Words admin page uses
  // (see dictionaryImporter.js), just with one line, so it updates the
  // shared dictionary the same way a manual re-import would.
  updateDictionaryGloss: (word, gloss) => post('/api/dictionary/import', { text: `${word} = ${gloss}` }),

  // Right-click menu's "Extract pattern (AI)" for a multi-word selection:
  // generalizes it into a reusable construction and translates that
  // pattern, using the account's own Translation API key - see
  // server/src/llm.js's extractPhrasePattern. Returns {pattern, translation}
  // for the client to show in an editable confirm step before saving.
  extractPattern: (text, sentence, persian) => post('/api/dictionary/extract-pattern', { text, sentence, persian }),

  // clickableGermanText.js's "Ctrl/Cmd+Alt+click" - a context-aware
  // re-translation of one word, for when the dictionary's standalone gloss
  // doesn't fit how it's used in this specific sentence.
  contextualTranslate: (word, sentence) => post('/api/dictionary/contextual-translate', { word, sentence }),

  // words: string[] - returns { word: rank } for whichever of these words
  // are in the top 200k frequency list (see server/data/word-frequency.seed.json).
  getWordFrequency: (words) => post('/api/word-frequency/lookup', { words }),

  // Translates pasted/shared text into German + Persian and saves it as a
  // readable book - see server/src/urlImport.js. Requires a Translation API
  // key configured in Settings (same one PDF import uses).
  importPastedText: (text, title) => post('/api/import-url', { text, title }),

  // Worksheets: upload a self-contained HTML page and get it back exactly
  // as uploaded, shown in an iframe - no parsing, see server/src/worksheets.js.
  uploadWorksheet: (file, title) => {
    const fd = new FormData();
    fd.append('file', file);
    if (title) fd.append('title', title);
    return postForm('/api/worksheets', fd);
  },
  listWorksheets: () => get('/api/worksheets'),
  worksheetViewUrl: (id) => `/api/worksheets/${id}/view`,
  deleteWorksheet: (id) => del(`/api/worksheets/${id}`),

  // Freely-placed notes (right-click -> "Notiz" anywhere in a worksheet).
  listWorksheetNotes: (worksheetId) => get(`/api/worksheets/${worksheetId}/notes`),
  createWorksheetNote: (worksheetId, blockIndex, charOffset, text) =>
    post(`/api/worksheets/${worksheetId}/notes`, { blockIndex, charOffset, text }),
  updateWorksheetNoteText: (worksheetId, noteId, text) => put(`/api/worksheets/${worksheetId}/notes/${noteId}`, { text }),
  deleteWorksheetNote: (worksheetId, noteId) => del(`/api/worksheets/${worksheetId}/notes/${noteId}`),

  // Backs the "/ai <question> --- " command typeable into any worksheet
  // note (free-form or the worksheet's own static boxes) - see
  // worksheets.js's parseAiCommand and routes/worksheets.js's /ask-ai.
  askWorksheetAi: (question) => post('/api/worksheets/ask-ai', { question }),
};
