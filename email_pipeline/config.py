"""
Configuration loaded from environment variables. Nothing is hardcoded here,
so no secrets ever need to live in the repo.

For each of the 4 mailboxes, set:
  MAILBOX{N}_SMTP_HOST
  MAILBOX{N}_SMTP_PORT   (defaults to 587)
  MAILBOX{N}_USERNAME
  MAILBOX{N}_PASSWORD
  MAILBOX{N}_FROM_NAME   (optional display name)

Plus:
  SENDER_COMPANY_NAME    (your company name, used in the generated email)
  PRODUCT_DESCRIPTION    (one line describing what you make/sell, used to
                          phrase the inquiry question)
  DB_PATH               (defaults to email_pipeline/pipeline.db)
  ANTHROPIC_API_KEY      (used to generate email text; falls back to a
                          plain template if unset, so the pipeline still
                          runs end-to-end without it)
  DAILY_MIN_PER_MAILBOX  (defaults to 10)
  DAILY_MAX_PER_MAILBOX  (defaults to 15)
  SEND_WINDOW_START_HOUR (defaults to 8)
  SEND_WINDOW_END_HOUR   (defaults to 21)
"""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Mailbox:
    id: int
    smtp_host: str
    smtp_port: int
    username: str
    password: str
    from_name: str


DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(__file__), "pipeline.db"),
)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

SENDER_COMPANY_NAME = os.environ.get("SENDER_COMPANY_NAME", "our company")
PRODUCT_DESCRIPTION = os.environ.get("PRODUCT_DESCRIPTION", "our product")

DAILY_MIN_PER_MAILBOX = int(os.environ.get("DAILY_MIN_PER_MAILBOX", "10"))
DAILY_MAX_PER_MAILBOX = int(os.environ.get("DAILY_MAX_PER_MAILBOX", "15"))
SEND_WINDOW_START_HOUR = int(os.environ.get("SEND_WINDOW_START_HOUR", "8"))
SEND_WINDOW_END_HOUR = int(os.environ.get("SEND_WINDOW_END_HOUR", "21"))
MAX_SEND_ATTEMPTS = int(os.environ.get("MAX_SEND_ATTEMPTS", "3"))


def load_mailboxes() -> list[Mailbox]:
    mailboxes = []
    for n in range(1, 5):
        prefix = f"MAILBOX{n}_"
        host = os.environ.get(prefix + "SMTP_HOST")
        if not host:
            continue
        mailboxes.append(
            Mailbox(
                id=n,
                smtp_host=host,
                smtp_port=int(os.environ.get(prefix + "SMTP_PORT", "587")),
                username=os.environ[prefix + "USERNAME"],
                password=os.environ[prefix + "PASSWORD"],
                from_name=os.environ.get(prefix + "FROM_NAME", ""),
            )
        )
    return mailboxes
