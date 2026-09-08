"""Collects German 'Produktmanager' job postings from LinkedIn via JobSpy,
as raw text for the word-frequency analysis in analyze.py.

Only LinkedIn is used - Indeed/Glassdoor block search requests from this
VPS's IP (see cv-maker/backend/job_parse.py's docstring, confirmed on the
same server). A single JobSpy call caps out well before the ~700k words
this needs, so this loops over several German cities and search-term
variants, deduplicating by job URL, until the word target is hit or the
search space is exhausted.

Usage: python scrape_jobs.py [--target-words 700000]
"""
import argparse
import json
import logging
import time
from pathlib import Path

from jobspy import scrape_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("scrape_jobs")

DATA_DIR = Path(__file__).parent / "data"
OUT_FILE = DATA_DIR / "jobs.jsonl"
SEEN_FILE = DATA_DIR / "jobs_seen_urls.txt"

SEARCH_TERMS = ["Produktmanager", "Product Manager", "Produktmanagement"]
# Cities rather than a single nationwide search - LinkedIn's per-search
# result count is capped well below what's needed, so spreading the same
# terms across cities is how volume is reached without duplicate-heavy
# pagination.
LOCATIONS = [
    "Berlin, Germany", "München, Germany", "Hamburg, Germany",
    "Frankfurt, Germany", "Köln, Germany", "Stuttgart, Germany",
    "Düsseldorf, Germany", "Leipzig, Germany", "Germany",
]
RESULTS_PER_CALL = 50
SLEEP_BETWEEN_CALLS = 8  # seconds - polite pacing, not just speed for its own sake


def word_count(text: str) -> int:
    return len(text.split()) if text else 0


def load_seen() -> set[str]:
    if not SEEN_FILE.exists():
        return set()
    return set(SEEN_FILE.read_text(encoding="utf-8").splitlines())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-words", type=int, default=700_000)
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    seen = load_seen()
    total_words = 0
    if OUT_FILE.exists():
        for line in OUT_FILE.read_text(encoding="utf-8").splitlines():
            total_words += word_count(json.loads(line).get("description", ""))
    log.info("Starting with %d words already collected (%d postings seen).", total_words, len(seen))

    if total_words >= args.target_words:
        log.info("Target already reached - nothing to do.")
        return

    with OUT_FILE.open("a", encoding="utf-8") as out, SEEN_FILE.open("a", encoding="utf-8") as seen_out:
        for term in SEARCH_TERMS:
            for location in LOCATIONS:
                if total_words >= args.target_words:
                    break
                log.info("Searching LinkedIn: term=%r location=%r (have %d/%d words)",
                          term, location, total_words, args.target_words)
                try:
                    jobs = scrape_jobs(
                        site_name=["linkedin"],
                        search_term=term,
                        location=location,
                        results_wanted=RESULTS_PER_CALL,
                        linkedin_fetch_description=True,
                    )
                except Exception:
                    log.exception("Search failed for term=%r location=%r - skipping.", term, location)
                    time.sleep(SLEEP_BETWEEN_CALLS)
                    continue

                if jobs is None or jobs.empty:
                    time.sleep(SLEEP_BETWEEN_CALLS)
                    continue

                for _, row in jobs.iterrows():
                    url = row.get("job_url")
                    description = row.get("description")
                    if not url or url in seen or not description:
                        continue
                    seen.add(url)
                    seen_out.write(url + "\n")
                    out.write(json.dumps({
                        "job_url": url,
                        "title": row.get("title"),
                        "location": str(row.get("location") or ""),
                        "description": description,
                    }, ensure_ascii=False) + "\n")
                    total_words += word_count(description)

                out.flush()
                seen_out.flush()
                time.sleep(SLEEP_BETWEEN_CALLS)
            if total_words >= args.target_words:
                break

    log.info("Done. Collected %d words total across %d postings.", total_words, len(seen))
    if total_words < args.target_words:
        log.warning(
            "Ran out of search combinations before reaching the target (%d/%d words). "
            "Widen SEARCH_TERMS/LOCATIONS, or re-run another night once new postings exist.",
            total_words, args.target_words,
        )


if __name__ == "__main__":
    main()
