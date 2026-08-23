import sqlite3
from contextlib import contextmanager

from . import config


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    schema_path = __file__.replace("db.py", "schema.sql")
    with open(schema_path) as f:
        schema = f.read()
    with get_connection() as conn:
        conn.executescript(schema)


@contextmanager
def connection():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
