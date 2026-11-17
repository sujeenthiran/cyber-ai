"""Moteur Ollama (http://127.0.0.1:11434)."""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator

import httpx

from ..security import check_local_url
from .base import LLMError, Provider, ThinkFilter


def _to_ollama(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        if m["role"] == "assistant" and m.get("tool_calls"):
            out.append({
                "role": "assistant",
                "content": m.get("content", ""),
                "tool_calls": [{"function": {"name": c["name"], "arguments": c["arguments"]}} for c in m["tool_calls"]],
            })
        elif m["role"] == "tool":
            out.append({"role": "tool", "content": m["content"], "tool_name": m.get("name", "")})
        else:
            msg = {"role": m["role"], "content": m["content"]}
            if m.get("images"):
                msg["images"] = m["images"]
            out.append(msg)
    return out


class OllamaProvider(Provider):
    name = "ollama"

    def __init__(self, base_url: str):
        check_local_url(base_url)
        self.base = base_url.rstrip("/")

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{self.base}/api/version")
                r.raise_for_status()
                return {"ok": True, "version": r.json().get("version", "?")}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Ollama injoignable sur {self.base} ({type(e).__name__})"}

    async def chat_stream(self, model, messages, tools, options) -> AsyncIterator[dict]:
        payload: dict[str, Any] = {
            "model": model,
            "messages": _to_ollama(messages),
            "stream": True,
            "keep_alive": "30m",
            "think": False,
            "options": {"temperature": options.get("temperature", 0.6), "num_ctx": options.get("num_ctx", 8192)},
        }
        if tools:
            payload["tools"] = tools
        for attempt in range(2):
            try:
                async for ev in self._stream(payload):
                    yield ev
                return
            except LLMError as e:
                # Modèle sans mode "réflexion" : on réessaie sans le paramètre think
                if attempt == 0 and "think" in str(e).lower():
                    payload.pop("think", None)
                    continue
                if attempt == 0 and tools and "does not support tools" in str(e).lower():
                    payload.pop("tools", None)
                    yield {"type": "warning", "text": f"Le modèle {model} ne gère pas les outils : actions désactivées."}
                    continue
                raise

    async def _stream(self, payload) -> AsyncIterator[dict]:
        think = ThinkFilter()
        calls: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as c:
                async with c.stream("POST", f"{self.base}/api/chat", json=payload) as r:
                    if r.status_code != 200:
                        body = (await r.aread()).decode("utf-8", "replace")
                        try:
                            body = json.loads(body).get("error", body)
                        except json.JSONDecodeError:
                            pass
                        if r.status_code == 404 and "not found" in body.lower():
                            raise LLMError(f"Modèle introuvable : {payload['model']}. Télécharge-le dans l'espace Modèles IA.")
                        raise LLMError(f"Erreur Ollama ({r.status_code}) : {body}")
                    async for line in r.aiter_lines():
                        if not line.strip():
                            continue
                        data = json.loads(line)
                        if data.get("error"):
                            raise LLMError(data["error"])
                        msg = data.get("message") or {}
                        if msg.get("content"):
                            txt = think.feed(msg["content"])
                            if txt:
                                yield {"type": "token", "text": txt}
                        for tc in msg.get("tool_calls") or []:
                            fn = tc.get("function", {})
                            args = fn.get("arguments") or {}
                            if isinstance(args, str):
                                try:
                                    args = json.loads(args)
                                except json.JSONDecodeError:
                                    args = {}
                            calls.append({"id": tc.get("id") or uuid.uuid4().hex[:12], "name": fn.get("name", ""), "arguments": args})
                        if data.get("done"):
                            rest = think.flush()
                            if rest:
                                yield {"type": "token", "text": rest}
                            if calls:
                                yield {"type": "tool_calls", "calls": calls}
                            ev = data.get("eval_count") or 0
                            dur = (data.get("eval_duration") or 0) / 1e9
                            yield {"type": "done", "stats": {"tokens": ev, "tok_s": round(ev / dur, 1) if dur else None}}
                            return
        except httpx.ConnectError:
            raise LLMError(f"Impossible de joindre Ollama sur {self.base}. Lance l'application Ollama puis réessaie.")
        except httpx.ReadTimeout:
            raise LLMError("Le modèle met trop de temps à répondre (délai dépassé).")

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{self.base}/api/tags")
            r.raise_for_status()
            out = []
            for m in r.json().get("models", []):
                det = m.get("details") or {}
                out.append({
                    "name": m["name"], "size": m.get("size", 0), "modified": m.get("modified_at"),
                    "family": det.get("family"), "params": det.get("parameter_size"), "quant": det.get("quantization_level"),
                })
            return out

    async def running(self) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{self.base}/api/ps")
                r.raise_for_status()
                return [
                    {"name": m["name"], "size": m.get("size", 0), "vram": m.get("size_vram", 0), "until": m.get("expires_at")}
                    for m in r.json().get("models", [])
                ]
        except Exception:  # noqa: BLE001
            return []

    async def embed(self, model, texts):
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(f"{self.base}/api/embed", json={"model": model, "input": texts, "keep_alive": "30m"})
                if r.status_code != 200:
                    return None
                return r.json().get("embeddings")
        except Exception:  # noqa: BLE001
            return None

    async def pull(self, model) -> AsyncIterator[dict]:
        async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=5)) as c:
            async with c.stream("POST", f"{self.base}/api/pull", json={"model": model, "stream": True}) as r:
                async for line in r.aiter_lines():
                    if line.strip():
                        yield json.loads(line)

    async def delete(self, model) -> None:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.request("DELETE", f"{self.base}/api/delete", json={"model": model})
            if r.status_code != 200:
                raise LLMError(r.text)
