// Fallback for words nobody has added to the dictionary yet: looks the word
// up via MyMemory's free translation API (no key required, low volume is
// fine) so the reader always gets some answer instead of "not yet in the
// dictionary." The caller is responsible for caching the result in the
// dictionary table, so this only ever runs once per missing word.

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

export async function translateWord(word) {
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(word)}&langpair=de|fa`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  const text = data?.responseData?.translatedText;
  if (!text || data.responseStatus !== 200) return null;

  // On a miss MyMemory often echoes the query back untranslated instead of
  // returning an error - treat that as "no translation found."
  if (text.trim().toLowerCase() === word.trim().toLowerCase()) return null;

  return text.trim();
}
