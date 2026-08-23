"""
Generate outreach email text via the Anthropic API. Falls back to a plain
template if ANTHROPIC_API_KEY isn't set, so the rest of the pipeline can
still be tested end-to-end without it.
"""
import sqlite3

from . import config

PROMPT_TEMPLATE = """Write a short, friendly cold outreach email.

Recipient name: {name}
Recipient company: {company}

Requirements:
- Subject line under 60 characters
- Body under 120 words, plain text, no markdown
- Natural, non-generic tone; vary phrasing so it doesn't read as a template
- End with a one-line reply-to-unsubscribe note: "Reply UNSUBSCRIBE to opt out."
- Output exactly two lines:
  Subject: <subject>
  Body: <body, single paragraph, \\n for line breaks if needed>
"""


def generate_email(contact: sqlite3.Row) -> tuple[str, str]:
    name = contact["name"] or "there"
    company = contact["company"] or ""

    if not config.ANTHROPIC_API_KEY:
        subject = f"Quick question, {name}"
        body = (
            f"Hi {name},\n\n"
            f"Wanted to reach out about something that might be useful for "
            f"{company or 'your team'}. Happy to share more if you're interested.\n\n"
            f"Reply UNSUBSCRIBE to opt out."
        )
        return subject, body

    import anthropic

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    prompt = PROMPT_TEMPLATE.format(name=name, company=company)
    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text

    subject = "Quick question"
    body = text
    for line in text.splitlines():
        if line.lower().startswith("subject:"):
            subject = line.split(":", 1)[1].strip()
        elif line.lower().startswith("body:"):
            body = line.split(":", 1)[1].strip()
    return subject, body
