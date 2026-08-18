import { api } from './api.js';

let dictionaryPromise = null;

// The dictionary is shared across the reader and the "My Words" view, and
// rarely changes within a session, so fetch it once and reuse it.
export function getDictionary() {
  if (!dictionaryPromise) dictionaryPromise = api.getDictionary();
  return dictionaryPromise;
}

// Call after importing new dictionary entries so the next read (e.g.
// navigating back to the reader) picks them up instead of the stale cache.
export function invalidateDictionaryCache() {
  dictionaryPromise = null;
}

export function normalizeWord(word) {
  return word.toLowerCase();
}
