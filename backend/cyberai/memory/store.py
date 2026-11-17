"""Mémoire intelligente : conversations + souvenirs (recherche plein texte + vectorielle)."""
from __future__ import annotations

import json
import re
import time
from typing import Any, Awaitable, Callable, Optional

import numpy as np

from .db import db

CATEGORIES = ["profil", "preference", "projet", "connaissance", "conversation", "general"]

Embedder = Callable[[list[str]], Awaitable[Optional[list[list[float]]]]]


# ------------------------------------------------------------ conversations
def create_conversation(title: str) -> int:
    now = time.time()
    with db.lock:
        cur = db.conn.execute(
            "INSERT INTO conversations(title, created, updated) VALUES (?,?,?)", (title[:80] or "Conversation", now, now)
        )
        db.conn.commit()
        return cur.lastrowid


def add_message(conv_id: int, role: str, content: str, meta: Any = None) -> int:
    now = time.time()
    with db.lock:
        cur = db.conn.execute(
            "INSERT INTO messages(conv_id, role, content, meta, ts) VALUES (?,?,?,?,?)",
            (conv_id, role, content, json.dumps(meta, ensure_ascii=False) if meta is not None else None, now),
        )
        db.conn.execute("UPDATE conversations SET updated=? WHERE id=?", (now, conv_id))
        db.conn.commit()
        return cur.lastrowid


def get_messages(conv_id: int, limit: int | None = None) -> list[dict]:
    with db.lock:
        if limit:
            rows = db.conn.execute(
                "SELECT * FROM (SELECT id, role, content, meta, ts FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT ?) ORDER BY id",
                (conv_id, limit),
            ).fetchall()
        else:
            rows = db.conn.execute(
                "SELECT id, role, content, meta, ts FROM messages WHERE conv_id=? ORDER BY id", (conv_id,)
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["meta"] = json.loads(d["meta"]) if d["meta"] else None
        out.append(d)
    return out


def list_conversations(limit: int = 100) -> list[dict]:
    with db.lock:
        rows = db.conn.execute(
            """SELECT c.id, c.title, c.created, c.updated, COUNT(m.id) AS count
               FROM conversations c LEFT JOIN messages m ON m.conv_id=c.id
               GROUP BY c.id ORDER BY c.updated DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def conversation_exists(conv_id: int) -> bool:
    with db.lock:
        return db.conn.execute("SELECT 1 FROM conversations WHERE id=?", (conv_id,)).fetchone() is not None


def delete_conversation(conv_id: int) -> None:
    with db.lock:
        db.conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
        db.conn.commit()


# ------------------------------------------------------------ souvenirs
def _to_blob(vec: list[float]) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def _from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


async def add_memory(
    content: str, category: str = "general", importance: int = 3,
    embedder: Embedder | None = None, embed_model: str = "",
) -> dict:
    content = content.strip()
    if not content:
        raise ValueError("Souvenir vide.")
    category = category if category in CATEGORIES else "general"
    importance = max(1, min(5, int(importance)))
    # Évite les doublons exacts
    with db.lock:
        dup = db.conn.execute("SELECT id FROM memories WHERE lower(content)=lower(?)", (content,)).fetchone()
    if dup:
        return get_memory(dup["id"])
    vec = None
    if embedder:
        res = await embedder([content])
        if res:
            vec = res[0]
    with db.lock:
        cur = db.conn.execute(
            "INSERT INTO memories(category, content, importance, created, embedding, embed_model) VALUES (?,?,?,?,?,?)",
            (category, content, importance, time.time(), _to_blob(vec) if vec else None, embed_model if vec else None),
        )
        db.conn.commit()
        return get_memory(cur.lastrowid)


def get_memory(mem_id: int) -> dict:
    with db.lock:
        r = db.conn.execute(
            "SELECT id, category, content, importance, created, last_used, embedding IS NOT NULL AS vector FROM memories WHERE id=?",
            (mem_id,),
        ).fetchone()
    return dict(r) if r else {}


def list_memories(category: str | None = None) -> list[dict]:
    q = "SELECT id, category, content, importance, created, last_used, embedding IS NOT NULL AS vector FROM memories"
    args: tuple = ()
    if category:
        q += " WHERE category=?"
        args = (category,)
    q += " ORDER BY importance DESC, created DESC"
    with db.lock:
        return [dict(r) for r in db.conn.execute(q, args).fetchall()]


def delete_memory(mem_id: int) -> None:
    with db.lock:
        db.conn.execute("DELETE FROM memories WHERE id=?", (mem_id,))
        db.conn.commit()


def _keyword_search(query: str, limit: int) -> dict[int, float]:
    words = [w for w in re.findall(r"\w{3,}", query.lower())][:12]
    if not words:
        return {}
    scores: dict[int, float] = {}
    with db.lock:
        if db.fts:
            fts_q = " OR ".join(f'"{w}"' for w in words)
            try:
                rows = db.conn.execute(
                    "SELECT rowid, bm25(memories_fts) AS s FROM memories_fts WHERE memories_fts MATCH ? ORDER BY s LIMIT ?",
                    (fts_q, limit),
                ).fetchall()
                for r in rows:
                    scores[r["rowid"]] = 1.0 / (1.0 + max(0.0, r["s"] + 10))  # bm25: plus petit = meilleur
                return scores
            except Exception:
                pass
        for w in words:
            for r in db.conn.execute("SELECT id FROM memories WHERE lower(content) LIKE ?", (f"%{w}%",)).fetchall():
                scores[r["id"]] = scores.get(r["id"], 0) + 0.2
    return scores


async def search_memories(query: str, limit: int = 5, embedder: Embedder | None = None, embed_model: str = "") -> list[dict]:
    """Recherche hybride : sémantique (vecteurs) + mots-clés + importance."""
    scores: dict[int, float] = {}
    if embedder and query.strip():
        res = await embedder([query])
        if res:
            q = np.asarray(res[0], dtype=np.float32)
            qn = np.linalg.norm(q) or 1.0
            with db.lock:
                rows = db.conn.execute(
                    "SELECT id, embedding FROM memories WHERE embedding IS NOT NULL AND embed_model=?", (embed_model,)
                ).fetchall()
            for r in rows:
                v = _from_blob(r["embedding"])
                if v.shape != q.shape:
                    continue
                sim = float(np.dot(q, v) / (qn * (np.linalg.norm(v) or 1.0)))
                if sim > 0.45:
                    scores[r["id"]] = sim
    for mid, s in _keyword_search(query, limit * 3).items():
        scores[mid] = scores.get(mid, 0) + s * 0.5
    if not scores:
        return []
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:limit]
    now = time.time()
    out = []
    with db.lock:
        for mid, s in ranked:
            m = get_memory(mid)
            if m:
                m["score"] = round(s, 3)
                out.append(m)
                db.conn.execute("UPDATE memories SET last_used=? WHERE id=?", (now, mid))
        db.conn.commit()
    return out


def profile_memories(limit: int = 8) -> list[dict]:
    """Souvenirs toujours injectés : profil + préférences importantes."""
    with db.lock:
        rows = db.conn.execute(
            """SELECT id, category, content, importance FROM memories
               WHERE category IN ('profil','preference') OR importance>=5
               ORDER BY importance DESC, created DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


async def reindex(embedder: Embedder, embed_model: str) -> int:
    """Calcule les vecteurs manquants (ex. après installation du modèle d'embedding)."""
    with db.lock:
        rows = db.conn.execute(
            "SELECT id, content FROM memories WHERE embedding IS NULL OR embed_model IS NOT ?", (embed_model,)
        ).fetchall()
    n = 0
    for r in rows:
        res = await embedder([r["content"]])
        if not res:
            break
        with db.lock:
            db.conn.execute("UPDATE memories SET embedding=?, embed_model=? WHERE id=?", (_to_blob(res[0]), embed_model, r["id"]))
            db.conn.commit()
        n += 1
    return n
