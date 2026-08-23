"""
Generate outreach email text via the Anthropic API. Falls back to a plain
template if ANTHROPIC_API_KEY isn't set, so the rest of the pipeline can
still be tested end-to-end without it.
"""
import sqlite3

from . import config

PROMPT_TEMPLATE = """Write a short, genuine business inquiry email -- NOT an
advertisement or sales pitch. This is a question being asked to a shop we
found, sent to a contact address they publish for business inquiries.

Sender company: {sender_company}
What the sender makes: {product_description}
Recipient shop / contact name: {name}
Recipient company: {company}

The email must ask exactly these things, woven in naturally (not as a
bullet list):
1. What their process is for reviewing new suppliers/brands, or whether
   they're open to stocking new products at all.
2. Who the right contact person is, and what email address to reach them
   at, if it isn't the person being written to.
3. Whether it would be okay to send over a catalog / more information, if
   they're interested -- explicitly ask for permission rather than
   attaching or describing any catalog, product details, pricing, or
   images now.

The email must:
- Mention what the sender's company makes in one short clause, only as
  context for why the question is being asked -- never describe features,
  benefits, or make any pitch/claims about the product. No "you should
  stock this because...", no persuasive language.
- Contain no catalog, price list, product images, or links to product
  pages -- the whole point of this email is to ask permission to send
  those later, not to include them now.
- Read like a person asking a straightforward question, not a marketing
  template. Vary the phrasing so it doesn't sound mass-produced.
- Be under 120 words, plain text, no markdown.
- End with a brief, polite line making clear a reply isn't obligatory and
  they're welcome to say if they'd rather not be contacted again -- phrase
  it naturally, not as a formal legal notice.
- Output exactly two lines:
  Subject: <subject, under 60 characters, phrased as a question or neutral,
  never as an ad>
  Body: <body, single paragraph, \\n for line breaks if needed>
"""


def generate_email(contact: sqlite3.Row) -> tuple[str, str]:
    name = contact["name"] or "there"
    company = contact["company"] or ""

    if not config.ANTHROPIC_API_KEY:
        subject = "Question about becoming a supplier"
        body = (
            f"Hi {name},\n\n"
            f"I'm reaching out from {config.SENDER_COMPANY_NAME}, where we make "
            f"{config.PRODUCT_DESCRIPTION}. I wanted to ask what your process is "
            f"for reviewing new suppliers/brands at {company or 'your shop'}, and "
            f"who the right contact person (and their email) would be if that's "
            f"not you. If it sounds like a possible fit, would it be okay to send "
            f"over a short catalog?\n\n"
            f"No worries at all if now isn't a good time -- happy to not follow up "
            f"if you'd rather I didn't.\n\n"
            f"Thanks!"
        )
        return subject, body

    import anthropic

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    prompt = PROMPT_TEMPLATE.format(
        name=name,
        company=company,
        sender_company=config.SENDER_COMPANY_NAME,
        product_description=config.PRODUCT_DESCRIPTION,
    )
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
