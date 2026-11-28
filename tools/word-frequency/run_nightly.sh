#!/usr/bin/env bash
# Runs the full word-frequency pipeline: pause the non-essential containers
# to free RAM (this VPS has ~3.8GB total and no swap - see the RAM check
# from setup), scrape+analyze, then always bring them back - even if a
# step fails, so a crashed run doesn't leave cv-maker/n8n down.
#
# Intended to run nightly via cron (added manually, see README.md) so it
# lands during low-traffic hours. Safe to run by hand too.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/.venv"
LOG_PREFIX="[word-frequency $(date '+%Y-%m-%d %H:%M:%S')]"

PAUSE_CONTAINERS=(cv-maker-backend-1 cv-maker-frontend-1 n8n-compose-emailmarketing-1 root-n8n-1 n8n-compose-n8n-1)
# Deliberately NOT included: n8n-compose-traefik-1 (the reverse proxy that
# also routes book.amirseyti.de - stopping it takes the book app offline
# too, not just n8n), and the book app / whisper containers themselves.

resume_containers() {
  echo "$LOG_PREFIX Resuming paused containers..."
  docker start "${PAUSE_CONTAINERS[@]}"
}
trap resume_containers EXIT

echo "$LOG_PREFIX Pausing non-essential containers to free RAM..."
docker stop "${PAUSE_CONTAINERS[@]}"

echo "$LOG_PREFIX Scraping job postings (LinkedIn, via JobSpy)..."
"$VENV/bin/python" "$SCRIPT_DIR/scrape_jobs.py"

echo "$LOG_PREFIX Scraping articles..."
"$VENV/bin/python" "$SCRIPT_DIR/scrape_articles.py"

echo "$LOG_PREFIX Running NLP word-frequency analysis..."
"$VENV/bin/python" "$SCRIPT_DIR/analyze.py"

echo "$LOG_PREFIX Done."
