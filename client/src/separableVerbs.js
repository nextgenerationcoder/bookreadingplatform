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
// Purely mechanical, not dictionary-gated: German main-clause word order
// (V2 - the finite verb sits early, near the subject) plus two cheap,
// reliable signals are what actually confirm a match, not whether the
// resulting compound happens to already be a dictionary word:
//   - capitalization: every German noun is capitalized wherever it appears,
//     verbs never are (except literally the first word of a sentence) - so
//     excluding capitalized words from verb-candidacy rules out nouns
//     without needing part-of-speech data.
//   - conjugation shape: a lowercase, non-stopword word is only treated as
//     the clause's finite verb if it's a recognized irregular form (see the
//     PRESENT_FORMS/PRETERITE_FORMS tables) or matches a regular weak-verb
//     present-tense ending (-e/-st/-t/-est/-et), from which the infinitive
//     is reconstructed directly (stem + "en").
// This used to additionally require the combined infinitive to already be
// a dictionary word before accepting a match - reliable, but meant
// detection quality depended entirely on how much dictionary coverage a
// particular book happened to have built up, which is exactly why this
// worked well in heavily-tested book content and poorly in freshly
// translated/shared text. Word order + conjugation shape alone are enough
// to confirm a split verb; the dictionary is only consulted afterward, for
// a gloss to show (falls back to a live lookup - see reader.js - if the
// resulting infinitive isn't already known).

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
// common particles) — without this, a short function word that happens to
// also match a conjugation-ending pattern could be misread as a verb.
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

// du-/er-forms of common strong (stem-vowel-changing) verbs, mapped back to
// their infinitive - e.g. "trägst" -> "tragen". Needed because these don't
// fit the regular weak-verb ending pattern below at all (the stem vowel
// itself changes), so there's no mechanical way to reconstruct them -
// they just have to be listed.
const PRESENT_FORMS = {
  trägst: 'tragen', trägt: 'tragen',
  fährst: 'fahren', fährt: 'fahren',
  schläfst: 'schlafen', schläft: 'schlafen',
  läufst: 'laufen', läuft: 'laufen',
  hältst: 'halten', hält: 'halten',
  lässt: 'lassen',
  fällst: 'fallen', fällt: 'fallen',
  rätst: 'raten', rät: 'raten',
  brätst: 'braten', brät: 'braten',
  gräbst: 'graben', gräbt: 'graben',
  schlägst: 'schlagen', schlägt: 'schlagen',
  wächst: 'wachsen',
  wäschst: 'waschen', wäscht: 'waschen',
  fängst: 'fangen', fängt: 'fangen',
  nimmst: 'nehmen', nimmt: 'nehmen',
  gibst: 'geben', gibt: 'geben',
  siehst: 'sehen', sieht: 'sehen',
  liest: 'lesen',
  isst: 'essen',
  vergisst: 'vergessen',
  misst: 'messen',
  trittst: 'treten', tritt: 'treten',
  sprichst: 'sprechen', spricht: 'sprechen',
  brichst: 'brechen', bricht: 'brechen',
  hilfst: 'helfen', hilft: 'helfen',
  stirbst: 'sterben', stirbt: 'sterben',
  wirfst: 'werfen', wirft: 'werfen',
  triffst: 'treffen', trifft: 'treffen',
  giltst: 'gelten', gilt: 'gelten',
  empfiehlst: 'empfehlen', empfiehlt: 'empfehlen',
  befiehlst: 'befehlen', befiehlt: 'befehlen',
  stiehlst: 'stehlen', stiehlt: 'stehlen',
  wirst: 'werden', wird: 'werden',
  weist: 'weisen', reist: 'reisen', heizt: 'heizen', reizt: 'reizen',
  lädst: 'laden', lädt: 'laden',
  stößt: 'stoßen',
};

// Simple-past (Präteritum) forms of common strong verbs - these are often
// short, irregular, monosyllabic forms (ging, kam, nahm, gab...) that don't
// end in any conjugation pattern at all, so - like the present-tense table
// above - they can only be recognized by listing them, not derived. Strong
// verbs' 1st/3rd-person preterite forms are identical (no ending), which is
// why each entry here covers both "ich"/"er" at once.
const PRETERITE_FORMS = {
  ging: 'gehen', kam: 'kommen', nahm: 'nehmen', gab: 'geben', sah: 'sehen',
  sprach: 'sprechen', fand: 'finden', half: 'helfen', warf: 'werfen', traf: 'treffen',
  blieb: 'bleiben', schrieb: 'schreiben', trug: 'tragen', fuhr: 'fahren', lief: 'laufen',
  hielt: 'halten', fiel: 'fallen', schlug: 'schlagen', wusch: 'waschen', fing: 'fangen',
  las: 'lesen', aß: 'essen', vergaß: 'vergessen', maß: 'messen', trat: 'treten',
  brach: 'brechen', starb: 'sterben', empfahl: 'empfehlen', befahl: 'befehlen', stahl: 'stehlen',
  wurde: 'werden', lud: 'laden', stieß: 'stoßen', wies: 'weisen', zog: 'ziehen',
  flog: 'fliegen', bot: 'bieten', bat: 'bitten', litt: 'leiden', schnitt: 'schneiden',
  saß: 'sitzen', stand: 'stehen', gewann: 'gewinnen', begann: 'beginnen', schwamm: 'schwimmen',
  sank: 'sinken', sang: 'singen', trank: 'trinken', band: 'binden', fand: 'finden',
  rief: 'rufen', lief: 'laufen', hieß: 'heißen', ließ: 'lassen', schloss: 'schließen',
  goss: 'gießen', schoss: 'schießen', verlor: 'verlieren', bog: 'biegen', flog: 'fliegen',
  stieg: 'steigen', schwieg: 'schweigen',
};

// Regular (weak) verbs need no lookup table at all - their present-tense
// conjugation is a fully mechanical pattern: strip the personal ending off
// the stem and add back "en" for the infinitive. Checked longest-suffix
// first so a stem ending in d/t (which inserts an extra "e": "arbeitest",
// "arbeitet") isn't mis-stripped by the shorter "-st"/"-t" rule first.
// Order matters: preterite endings ("-te"/"-test"/"-tet"/"-ten", added onto
// the stem for regular/weak verbs) are tried before the shorter present-tense
// endings, so e.g. "teilte" strips to "teil" (-> "teilen") rather than being
// mistaken for present-tense "teilt" + "e" (-> the wrong "teilten").
const WEAK_VERB_ENDINGS = ['test', 'tet', 'ten', 'te', 'est', 'et', 'st', 't', 'e'];
const MIN_STEM_LENGTH = 2;

function reconstructWeakInfinitive(word) {
  for (const ending of WEAK_VERB_ENDINGS) {
    if (word.length > ending.length + MIN_STEM_LENGTH - 1 && word.endsWith(ending)) {
      return `${word.slice(0, -ending.length)}en`;
    }
  }
  return null;
}

// A lowercase, non-stopword word's most likely infinitive, from whichever
// source recognizes it - irregular present, irregular preterite, or the
// regular weak-verb pattern (tried last, since it's a guess rather than a
// lookup - an irregular form that happens to also fit a weak ending
// pattern, e.g. none of the tables' entries do, should never reach it, but
// this keeps the precedence explicit).
function likelyInfinitive(word) {
  const key = normalize(word);
  if (PRESENT_FORMS[key]) return PRESENT_FORMS[key];
  if (PRETERITE_FORMS[key]) return PRETERITE_FORMS[key];
  return reconstructWeakInfinitive(key);
}

function hintFromDictionary(token, dictionary) {
  const entry = dictionary[normalize(token)];
  const idx = entry ? entry.lastIndexOf(' • ') : -1;
  return idx === -1 ? [] : entry.slice(idx + 3).split('/').map((s) => s.trim());
}

// isSentenceStart: true only for the clause's very first word AND that word
// is also the whole sentence's first token - the one case a genuine verb is
// allowed to be capitalized (sentence-initial, or an imperative like "Geh
// doch mit."). Anywhere else, a capitalized word is a noun and is never a
// verb candidate - German capitalizes every noun, wherever it falls in the
// sentence, and never capitalizes a verb mid-sentence.
function resolveCompound(clauseWords, prefix, dictionary, isSentenceStart) {
  for (const { index, word } of clauseWords) {
    const capitalized = word[0] !== word[0].toLowerCase();
    const isFirstWordOfSentence = isSentenceStart && index === clauseWords[0].index;
    if (capitalized && !isFirstWordOfSentence) continue;
    if (STOPWORDS.has(normalize(word))) continue;

    const candidates = new Set();
    // A dictionary hint (hand-curated " • infinitive" annotation) is tried
    // first when present - it's an exact, curated answer, not a guess.
    for (const h of hintFromDictionary(word, dictionary)) {
      const hLower = h.toLowerCase();
      const longestMatch = SEPARABLE_PREFIXES.filter((p) => hLower.startsWith(p)).sort((a, b) => b.length - a.length)[0];
      if (longestMatch && longestMatch !== prefix) continue;
      candidates.add(longestMatch ? h : prefix + h);
    }
    const guessed = likelyInfinitive(word);
    if (guessed) candidates.add(prefix + guessed);

    if (candidates.size) {
      const infinitive = [...candidates][0];
      return { index, infinitive, gloss: dictionary[normalize(infinitive)] || null };
    }
  }
  return null;
}

/**
 * @param {string[]} tokens - the sentence split via TOKEN_RE (words + punctuation, in order)
 * @param {Record<string,string>} dictionary
 * @returns {Array<{verbIndex:number, prefixIndex:number, infinitive:string, gloss:string|null}>}
 */
export function findSeparableCompounds(tokens, dictionary) {
  const results = [];
  let clause = [];
  const sentenceStartIndex = tokens.findIndex((t) => WORD_RE.test(t));

  const flush = () => {
    if (clause.length) {
      const last = clause[clause.length - 1];
      if (SEPARABLE_PREFIX_SET.has(normalize(last.word))) {
        const rest = clause.slice(0, -1);
        if (rest.length) {
          const isSentenceStart = rest[0].index === sentenceStartIndex;
          const match = resolveCompound(rest, normalize(last.word), dictionary, isSentenceStart);
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
