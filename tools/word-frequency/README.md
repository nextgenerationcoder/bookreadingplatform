# German product-management word-frequency tool

Finds which German words show up most often in product-management text, by
collecting ~1M words (70% LinkedIn job postings via JobSpy, 30% articles/
blogs) and running German NLP (lemmatization + POS filtering) over it.

Kept independent from the main Node.js app (own Python venv, own
dependencies) and from cv-maker's JobSpy install - reuses the same
approach (JobSpy, LinkedIn-only since Indeed/Glassdoor block this VPS's
IP), but as its own tool so it doesn't depend on cv-maker's containers
being up.

## One-time setup (on the VPS)

```bash
cd ~/bookreadingplatform/tools/word-frequency
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m spacy download de_core_news_sm
```

## Running it

By hand (safe to run anytime - pauses cv-maker/n8n while it runs, always
resumes them after, even on failure):

```bash
./run_nightly.sh
```

Or the three steps separately (each is incremental - re-running just tops
up toward the word target instead of starting over):

```bash
.venv/bin/python scrape_jobs.py       # -> data/jobs.jsonl
.venv/bin/python scrape_articles.py   # -> data/articles.jsonl
.venv/bin/python analyze.py           # -> data/word_frequency.json / .csv
```

## Running it nightly at midnight

```bash
crontab -e
```

Add:

```
0 0 * * * /bin/bash /root/bookreadingplatform/tools/word-frequency/run_nightly.sh >> /root/bookreadingplatform/tools/word-frequency/run.log 2>&1
```

(Adjust the path if the repo isn't at `/root/bookreadingplatform`.)

## Output

`data/word_frequency.json` and `data/word_frequency.csv` - German content
words (nouns, verbs, adjectives - stopwords already excluded), ranked by
how often they appeared across the collected postings/articles.

## Notes / things to check after the first run

- **Article feed URLs in `scrape_articles.py`'s `FEEDS` list are a
  starting guess** - this tool was built without general internet access
  to verify each one still resolves. A dead/changed feed just logs a
  warning and gets skipped, so it won't break the run, but check
  `run.log` after the first night and swap out any that come back empty.
- **Reaching the full 1M-word target may take a few nights**, especially
  the article side (RSS feeds only have so many recent posts at once) -
  `scrape_articles.py`/`scrape_jobs.py` are incremental, so this is
  expected and self-corrects as feeds publish new posts.
- The VPS has no swap - if `free -h` shows little headroom before a run,
  reduce `RESULTS_PER_CALL` in `scrape_jobs.py` or run this at a time when
  fewer other containers are active.
