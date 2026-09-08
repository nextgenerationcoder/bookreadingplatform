"""Collects German product-management articles/blog posts (the ~30% of
the corpus that isn't job postings) via RSS feeds, as raw text for the
word-frequency analysis in analyze.py.

RSS was picked over crawling each site's listing pages because listing-page
HTML structure varies per site and breaks silently when a site redesigns;
an RSS feed is a stable, purpose-built "list of article URLs" almost every
blog already publishes. FEEDS below is a starting set of well-known German
product-management blogs - verify each feed URL still resolves before
relying on this (this tool was built somewhere without general internet
access, so these couldn't be tested end-to-end; a 404/empty feed just gets
skipped and logged, so a stale entry doesn't break the run).

Usage: python scrape_articles.py [--target-words 300000]
"""
import argparse
import json
import logging
import re
import time
from pathlib import Path

import feedparser
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("scrape_articles")

DATA_DIR = Path(__file__).parent / "data"
OUT_FILE = DATA_DIR / "articles.jsonl"
SEEN_FILE = DATA_DIR / "articles_seen_urls.txt"

FEEDS = [
    "https://t3n.de/tag/produktmanagement/feed/",
    "https://www.omr.com/de/feed",
    "https://www.produktbezogen.de/feed/",
    "https://mixed.de/feed/",
]
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}
REQUEST_TIMEOUT = 15
SLEEP_BETWEEN_REQUESTS = 3
MIN_ARTICLE_WORDS = 80  # below this it's probably a nav/teaser page, not real content


def word_count(text: str) -> int:
    return len(text.split()) if text else 0


def extract_article_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()
    container = soup.find("article") or soup.find("main") or soup
    paragraphs = [p.get_text(" ", strip=True) for p in container.find_all("p")]
    text = "\n".join(p for p in paragraphs if p)
    text = re.sub(r"\n{2,}", "\n", text).strip()
    return text


def load_seen() -> set[str]:
    if not SEEN_FILE.exists():
        return set()
    return set(SEEN_FILE.read_text(encoding="utf-8").splitlines())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-words", type=int, default=300_000)
    args = parser.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    seen = load_seen()
    total_words = 0
    if OUT_FILE.exists():
        for line in OUT_FILE.read_text(encoding="utf-8").splitlines():
            total_words += word_count(json.loads(line).get("text", ""))
    log.info("Starting with %d words already collected (%d articles seen).", total_words, len(seen))

    if total_words >= args.target_words:
        log.info("Target already reached - nothing to do.")
        return

    with OUT_FILE.open("a", encoding="utf-8") as out, SEEN_FILE.open("a", encoding="utf-8") as seen_out:
        for feed_url in FEEDS:
            if total_words >= args.target_words:
                break
            log.info("Reading feed: %s (have %d/%d words)", feed_url, total_words, args.target_words)
            try:
                # feedparser.parse(url) has no timeout of its own and can
                # hang indefinitely against a slow/unresponsive server
                # (confirmed live - a run got stuck on this exact line).
                # Fetching with requests first (which does have a timeout)
                # and handing feedparser the bytes avoids that.
                feed_resp = requests.get(feed_url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT)
                feed_resp.raise_for_status()
                feed = feedparser.parse(feed_resp.content)
            except requests.RequestException:
                log.warning("Failed to fetch feed %s - skipping.", feed_url)
                continue
            except Exception:
                log.exception("Failed to parse feed %s - skipping.", feed_url)
                continue
            if getattr(feed, "bozo", False) and not feed.entries:
                log.warning("Feed %s returned no entries (dead/changed URL?) - skipping.", feed_url)
                continue

            for entry in feed.entries:
                if total_words >= args.target_words:
                    break
                url = entry.get("link")
                if not url or url in seen:
                    continue
                seen.add(url)
                seen_out.write(url + "\n")

                try:
                    resp = requests.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT)
                    resp.raise_for_status()
                except requests.RequestException:
                    log.warning("Failed to fetch %s - skipping.", url)
                    continue

                text = extract_article_text(resp.text)
                if word_count(text) < MIN_ARTICLE_WORDS:
                    continue

                out.write(json.dumps({"url": url, "title": entry.get("title"), "text": text}, ensure_ascii=False) + "\n")
                total_words += word_count(text)
                time.sleep(SLEEP_BETWEEN_REQUESTS)

            out.flush()
            seen_out.flush()

    log.info("Done. Collected %d words total across articles.", total_words)
    if total_words < args.target_words:
        log.warning(
            "Ran out of feed entries before reaching the target (%d/%d words). "
            "Add more feeds to FEEDS, or re-run another night once feeds have new posts.",
            total_words, args.target_words,
        )


if __name__ == "__main__":
    main()
