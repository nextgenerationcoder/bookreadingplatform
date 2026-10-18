// Normalizes a German answer before comparison: trims, collapses internal
// whitespace, lowercases, and makes a trailing "." or "?" optional - so
// "Es ist gut", "es ist gut", and "Es ist gut." all compare equal, but
// word order still matters (nothing is reordered).
export function normalizeAnswer(str) {
  return (str || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?]+$/, '')
    .toLowerCase();
}

export function answersMatch(given, expected) {
  return normalizeAnswer(given) === normalizeAnswer(expected);
}
