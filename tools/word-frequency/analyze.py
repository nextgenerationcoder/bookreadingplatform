"""Runs German NLP (lemmatization + POS filtering) over the job postings
and articles collected by scrape_jobs.py/scrape_articles.py, and outputs
a word-frequency ranking - which German words show up most often in
product-management text.

Only content words (nouns, proper nouns, verbs, adjectives) are counted;
stopwords ("und", "die", "ist", ...) and punctuation are dropped, since
those would just dominate any raw German frequency count without telling
us anything about this domain specifically. Text is streamed through
spaCy's nlp.pipe() in batches - never all loaded into memory at once - so
memory stays bounded regardless of corpus size (important on this VPS,
which has no swap - see run_nightly.sh).

Boilerplate paragraphs (cookie/privacy notices, "click to show external
content" placeholders, related-article widgets) repeat nearly word-for-
word across many different articles on the same site - confirmed live,
where they dominated the top results ("Datenschutzerklärung",
"Drittplattformen", "extern ... anzeigen" were among the most frequent
"words" in a first run). A paragraph that appears in many different
documents isn't page content, it's chrome, so paragraphs seen in more
than BOILERPLATE_MIN_DOCS documents are dropped before counting -
generic across sites, unlike hardcoding each site's specific class names.

German separable-prefix verbs ("ausstellen" -> "Wir stellen ... aus")
split apart in normal sentences - without handling this, "stellen" and
"ausstellen" (different meanings: "to put" vs. "to exhibit/issue") would
get silently merged into one bare "stellen" count, and the detached "aus"
would either get dropped or miscounted as its own word. The parser is
kept enabled specifically for this: it tags a detached prefix with
dep_ == "svp" ("separable verb prefix") pointing at its verb, so the two
can be recombined into the real word ("aus" + "stellen" -> "ausstellen")
before counting. (Confirmed empirically - de_core_news_sm's lemmatizer is
still imperfect on compound verbs even when NOT separated, e.g.
"ausbaut" -> lemma "ausbaut" instead of "ausbauen" - a known small-model
limitation with no clean fix short of a bigger model.)

Searching LinkedIn by German city (see scrape_jobs.py's LOCATIONS) only
filters by where the job is based, not what language it's posted in -
confirmed live, where English postings from international/startup
companies dominated a run's top words ("and", "Product", "Team", "with",
"The", ...). Every document is language-detected and non-German ones are
dropped before counting, rather than trying to catch this at scrape time
per-source.

Usage: python analyze.py [--top 300]
Requires: python -m spacy download de_core_news_sm  (~15MB, no word vectors -
the small model is the right call here: this only needs lemmatization/POS
tagging, not the similarity features the larger models add RAM for.)
"""
import argparse
import json
from collections import Counter
from pathlib import Path

import spacy
from langdetect import DetectorFactory, LangDetectException, detect

# Otherwise langdetect's detection is non-deterministic run to run (it
# samples internally) - fixed seed makes results reproducible.
DetectorFactory.seed = 0

DATA_DIR = Path(__file__).parent / "data"
JOBS_FILE = DATA_DIR / "jobs.jsonl"
ARTICLES_FILE = DATA_DIR / "articles.jsonl"
OUT_JSON = DATA_DIR / "word_frequency.json"
OUT_CSV = DATA_DIR / "word_frequency.csv"

KEEP_POS = {"NOUN", "PROPN", "VERB", "ADJ"}
BATCH_SIZE = 50
# A paragraph seen in at least this many distinct documents (or this
# fraction of all documents, whichever is larger) is treated as
# boilerplate rather than real content.
BOILERPLATE_MIN_DOCS = 5
BOILERPLATE_MIN_FRACTION = 0.01


def is_german(text: str) -> bool:
    try:
        return detect(text) == "de"
    except LangDetectException:
        # Too short/ambiguous to classify confidently - treat as not
        # confirmed German rather than risk letting non-German text in.
        return False


def iter_raw_texts():
    skipped_non_german = 0
    for path, field in ((JOBS_FILE, "description"), (ARTICLES_FILE, "text")):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            # A prior scrape run killed mid-write can leave a truncated
            # last line - skip it rather than crash the whole analysis.
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = row.get(field)
            if not text:
                continue
            if not is_german(text):
                skipped_non_german += 1
                continue
            yield text
    if skipped_non_german:
        print(f"Skipped {skipped_non_german} non-German document(s).")


def find_boilerplate_paragraphs() -> set[str]:
    doc_count = 0
    para_doc_counts: Counter[str] = Counter()
    for text in iter_raw_texts():
        doc_count += 1
        # A set, not a list - a paragraph repeated twice within the SAME
        # document (a pull-quote, say) shouldn't count double toward
        # "how many different documents" it appears in.
        for para in {p.strip() for p in text.split("\n") if p.strip()}:
            para_doc_counts[para] += 1
    if doc_count == 0:
        return set()
    threshold = max(BOILERPLATE_MIN_DOCS, int(doc_count * BOILERPLATE_MIN_FRACTION))
    return {para for para, count in para_doc_counts.items() if count >= threshold}


def iter_texts(boilerplate: set[str]):
    for text in iter_raw_texts():
        kept = [p.strip() for p in text.split("\n") if p.strip() and p.strip() not in boilerplate]
        if kept:
            yield "\n".join(kept)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=300)
    args = parser.parse_args()

    # NER is disabled (not needed here), but the parser is kept enabled -
    # it's the only pipe that exposes the svp (separable verb prefix)
    # dependency relation used to reunite split verbs below. Costs a bit
    # more time/memory than tagger+lemmatizer alone, but de_core_news_sm's
    # parser is still small - not worth losing correctness on such a
    # common German sentence pattern to avoid it.
    nlp = spacy.load("de_core_news_sm", disable=["ner"])

    boilerplate = find_boilerplate_paragraphs()
    if boilerplate:
        print(f"Filtered {len(boilerplate)} boilerplate paragraph(s) repeated across many documents "
              "(cookie notices, related-article widgets, etc.) before counting.")

    counts: Counter[str] = Counter()
    doc_count = 0
    token_count = 0

    for doc in nlp.pipe(iter_texts(boilerplate), batch_size=BATCH_SIZE):
        doc_count += 1
        # Map each verb (by token index) to its detached prefix's text, so
        # the verb can be counted under its real combined form below
        # instead of the bare stem.
        svp_prefix = {token.head.i: token.text.lower() for token in doc if token.dep_ == "svp"}

        for token in doc:
            if token.dep_ == "svp":
                continue  # merged into its head verb below - not a word of its own
            if token.pos_ not in KEEP_POS or not token.is_alpha or token.is_stop:
                continue
            # Single letters (e.g. "m/w/d" tokenizing into "m", "w", "d")
            # pass is_alpha but aren't real words - drop them.
            if len(token.text) < 2:
                continue
            lemma = token.lemma_
            prefix = svp_prefix.get(token.i)
            if prefix:
                lemma = prefix + lemma
            counts[lemma] += 1
            token_count += 1

    if doc_count == 0:
        print("No input text found - run scrape_jobs.py and scrape_articles.py first.")
        return

    top = counts.most_common(args.top)

    OUT_JSON.write_text(
        json.dumps(
            {"documents": doc_count, "content_words_counted": token_count, "top_words": top},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    with OUT_CSV.open("w", encoding="utf-8") as f:
        f.write("word,count\n")
        for word, count in top:
            f.write(f"{word},{count}\n")

    print(f"Processed {doc_count} documents, {token_count} content-word tokens.")
    print(f"Top {min(args.top, 20)} words:")
    for word, count in top[:20]:
        print(f"  {word}: {count}")
    print(f"\nFull results: {OUT_JSON} / {OUT_CSV}")


if __name__ == "__main__":
    main()
