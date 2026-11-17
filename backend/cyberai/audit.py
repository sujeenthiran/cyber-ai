"""Journal des actions (SQLite) + diffusion en direct au panneau d'activité."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Callable

from .memory.db import db

_listeners: set[Callable[[dict], Any]] = set()


def subscribe(cb: Callable[[dict], Any]) -> None:
    _listeners.add(cb)


def unsubscribe(cb: Callable[[dict], Any]) -> None:
    _listeners.discard(cb)


def log(kind: str, title: str, detail: Any = None, status: str = "info") -> dict:
    entry = {
        "ts": time.time(),
        "kind": kind,
        "title": title,
        "detail": detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False) if detail is not None else "",
        "status": status,
    }
    with db.lock:
        cur = db.conn.execute(
            "INSERT INTO audit(ts, kind, title, detail, status) VALUES (?,?,?,?,?)",
            (entry["ts"], kind, title, entry["detail"][:20000], status),
        )
        db.conn.commit()
        entry["id"] = cur.lastrowid
    for cb in list(_listeners):
        try:
            res = cb(entry)
            if asyncio.iscoroutine(res):
                asyncio.ensure_future(res)
        except Exception:
            pass
    return entry


def recent(limit: int = 100) -> list[dict]:
    with db.lock:
        rows = db.conn.execute(
            "SELECT id, ts, kind, title, detail, status FROM audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]
