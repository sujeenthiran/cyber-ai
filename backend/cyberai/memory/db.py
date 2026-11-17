"""Base SQLite locale unique (conversations, mémoire, journal)."""
from __future__ import annotations

import sqlite3
import threading

from ..config import DATA_DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created REAL NOT NULL,
  updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, id);
CREATE TABLE IF NOT EXISTS memories(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  created REAL NOT NULL,
  last_used REAL,
  embedding BLOB,
  embed_model TEXT
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT
);
"""


class Database:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self.fts = self._init_fts()
        self.conn.commit()

    def _init_fts(self) -> bool:
        try:
            self.conn.executescript(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, category, content='memories', content_rowid='id');
                CREATE TRIGGER IF NOT EXISTS mem_ai AFTER INSERT ON memories BEGIN
                  INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
                END;
                CREATE TRIGGER IF NOT EXISTS mem_ad AFTER DELETE ON memories BEGIN
                  INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
                END;
                CREATE TRIGGER IF NOT EXISTS mem_au AFTER UPDATE OF content, category ON memories BEGIN
                  INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
                  INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
                END;
                """
            )
            return True
        except sqlite3.OperationalError:
            return False


db = Database(DATA_DIR / "cyberai.db")
