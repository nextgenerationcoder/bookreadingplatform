// Detects German separable-prefix verbs (trennbare Verben) split across a
// clause, e.g. "... teilte weiter aus." = austeilen, so the reader can treat
// "teilte" and "aus" as one word instead of two unrelated fragments.
//
// The rule is general, not per-sentence: any of SEPARABLE_PREFIXES standing
// alone at the end of a clause is a candidate split-off prefix. Clause
// boundaries are punctuation (.,;:!?) and coordinating conjunctions (und,
// oder, aber, sondern, denn) — sentences can run several clauses together
// ("... und ...", "..., ...") and each is checked independently.
//
// A candidate is only confirmed — never guessed — when the resulting
// combined infinitive (found via the finite verb's "• infinitive" dictionary
// hint, or the verb token itself concatenated with the prefix) exists as its
// own dictionary entry. That keeps false positives out: as more separable
// verbs get curated dictionary entries, more get recognized automatically —
// nothing here is hardcoded to a specific sentence or book.

export const SEPARABLE_PREFIXES = [
  'ab', 'an', 'auf', 'aus', 'bei', 'da', 'dar', 'ein', 'empor', 'entgegen',
  'entlang', 'entzwei', 'fern', 'fest', 'fort', 'frei', 'gegenüber', 'gleich',
  'heim', 'her', 'herab', 'heran', 'herauf', 'heraus', 'herbei', 'herein',
  'herüber', 'herum', 'herunter', 'hervor', 'hin', 'hinab', 'hinan', 'hinauf',
  'hinaus', 'hindurch', 'hinein', 'hinüber', 'hinunter', 'hinweg', 'hoch',
  'los', 'mit', 'nach', 'nieder', 'statt', 'teil', 'über', 'um', 'unter',
  'vor', 'voran', 'voraus', 'vorbei', 'vorüber', 'weg', 'weiter', 'wieder',
  'zu', 'zurecht', 'zurück', 'zusammen',
];
const SEPARABLE_PREFIX_SET = new Set(SEPARABLE_PREFIXES.map((p) => p.toLowerCase()));

// Closed-class words that must never be guessed as the finite verb of a
// separable-verb pair (articles, pronouns, prepositions, conjunctions,
// common particles) — without this, short coincidences like "der" + "an"
// happening to spell an unrelated real dictionary word ("ander") would be
// misread as a compound verb.
const STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mich', 'dich', 'ihn', 'uns', 'euch', 'ihm', 'ihnen', 'mir', 'dir',
  'sein', 'seine', 'seiner', 'seinem', 'seinen', 'ihre', 'ihrer', 'ihren', 'ihrem', 'unser', 'euer', 'man',
  'wer', 'was', 'wen', 'wem', 'wessen', 'dieser', 'diese', 'dieses', 'diesem', 'diesen', 'jener', 'jene', 'jenes',
  'in', 'an', 'auf', 'für', 'mit', 'von', 'zu', 'bei', 'nach', 'aus', 'über', 'unter', 'vor', 'hinter', 'neben',
  'zwischen', 'durch', 'gegen', 'ohne', 'um', 'seit', 'während', 'wegen', 'trotz', 'statt', 'außer',
  'und', 'oder', 'aber', 'denn', 'sondern', 'dass', 'weil', 'wenn', 'als', 'ob', 'obwohl', 'bevor', 'nachdem',
  'damit', 'sodass', 'indem',
  'nicht', 'auch', 'noch', 'schon', 'nur', 'sehr', 'immer', 'dann', 'so', 'wie', 'hier', 'dort', 'da', 'jetzt',
  'heute', 'morgen', 'gestern', 'doch', 'ja', 'nein', 'eben', 'gerade', 'gerne', 'einfach', 'ganz', 'gar',
]);

const CLAUSE_CONJ_RE = /^(und|oder|aber|sondern|denn)$/i;
const CLAUSE_PUNCT_RE = /[.,;:!?]/;
const WORD_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/;

function normalize(word) {
  return word.toLowerCase();
}

function hintsFor(token, dictionary) {
  const entry = dictionary[normalize(token)];
  if (!entry) return [];
  const idx = entry.lastIndexOf(' • ');
  if (idx === -1) return [];
  return entry.slice(idx + 3).split('/').map((s) => s.trim());
}

function resolveCompound(clauseWords, prefix, dictionary) {
  for (const { index, word } of clauseWords) {
    const candidates = new Set();
    for (const h of hintsFor(word, dictionary)) {
      const hLower = h.toLowerCase();
      // A hint like "zurückrollen" starts with both "zu" and "zurück" as
      // bare substrings; only the longest matching prefix is the real split.
      const longestMatch = SEPARABLE_PREFIXES.filter((p) => hLower.startsWith(p)).sort(
        (a, b) => b.length - a.length
      )[0];
      if (longestMatch && longestMatch !== prefix) continue;
      candidates.add(longestMatch ? h : prefix + h);
    }
    if (!STOPWORDS.has(normalize(word))) candidates.add(prefix + word);
    for (const candidate of candidates) {
      const gloss = dictionary[normalize(candidate)];
      if (gloss) return { index, infinitive: candidate, gloss };
    }
  }
  return null;
}

/**
 * @param {string[]} tokens - the sentence split via TOKEN_RE (words + punctuation, in order)
 * @param {Record<string,string>} dictionary
 * @returns {Array<{verbIndex:number, prefixIndex:number, infinitive:string, gloss:string}>}
 */
export function findSeparableCompounds(tokens, dictionary) {
  const results = [];
  let clause = [];

  const flush = () => {
    if (clause.length) {
      const last = clause[clause.length - 1];
      if (SEPARABLE_PREFIX_SET.has(normalize(last.word))) {
        const rest = clause.slice(0, -1);
        const match = resolveCompound(rest, normalize(last.word), dictionary);
        if (match) {
          results.push({
            verbIndex: match.index,
            prefixIndex: last.index,
            infinitive: match.infinitive,
            gloss: match.gloss,
          });
        }
      }
    }
    clause = [];
  };

  tokens.forEach((token, index) => {
    if (WORD_RE.test(token)) {
      if (CLAUSE_CONJ_RE.test(token)) {
        flush();
        return;
      }
      clause.push({ index, word: token });
    } else if (CLAUSE_PUNCT_RE.test(token)) {
      flush();
    }
  });
  flush();

  return results;
}
