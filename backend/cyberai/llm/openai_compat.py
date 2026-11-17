"""Moteur compatible OpenAI local (LM Studio, llama.cpp server, vLLM...)."""
from __future__ import annotations

import json
import uuid
from typing import AsyncIterator

import httpx

from ..security import check_local_url
from .base import LLMError, Provider, ThinkFilter


def _to_openai(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        if m["role"] == "assistant" and m.get("tool_calls"):
            out.append({
                "role": "assistant",
                "content": m.get("content") or None,
                "tool_calls": [
                    {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["arguments"], ensure_ascii=False)}}
                    for c in m["tool_calls"]
                ],
            })
        elif m["role"] == "tool":
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
        else:
            out.append({"role": m["role"], "content": m["content"]})
    return out


class OpenAICompatProvider(Provider):
    name = "openai"

    def __init__(self, base_url: str):
        check_local_url(base_url)
        self.base = base_url.rstrip("/")

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{self.base}/models")
                r.raise_for_status()
                return {"ok": True, "version": "API OpenAI locale"}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Serveur IA injoignable sur {self.base} ({type(e).__name__})"}

    async def chat_stream(self, model, messages, tools, options) -> AsyncIterator[dict]:
        payload = {
            "model": model,
            "messages": _to_openai(messages),
            "stream": True,
            "temperature": options.get("temperature", 0.6),
        }
        if tools:
            payload["tools"] = tools
        think = ThinkFilter()
        partial: dict[int, dict] = {}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as c:
                async with c.stream("POST", f"{self.base}/chat/completions", json=payload) as r:
                    if r.status_code != 200:
                        raise LLMError(f"Erreur du serveur IA ({r.status_code}) : {(await r.aread()).decode('utf-8', 'replace')[:500]}")
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        chunk = json.loads(data)
                        for choice in chunk.get("choices", []):
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                txt = think.feed(delta["content"])
                                if txt:
                                    yield {"type": "token", "text": txt}
                            for tc in delta.get("tool_calls") or []:
                                p = partial.setdefault(tc.get("index", 0), {"id": None, "name": "", "args": ""})
                                p["id"] = tc.get("id") or p["id"]
                                fn = tc.get("function") or {}
                                p["name"] += fn.get("name") or ""
                                p["args"] += fn.get("arguments") or ""
        except httpx.ConnectError:
            raise LLMError(f"Impossible de joindre le serveur IA sur {self.base}.")
        rest = think.flush()
        if rest:
            yield {"type": "token", "text": rest}
        if partial:
            calls = []
            for p in partial.values():
                try:
                    args = json.loads(p["args"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                calls.append({"id": p["id"] or uuid.uuid4().hex[:12], "name": p["name"], "arguments": args})
            yield {"type": "tool_calls", "calls": calls}
        yield {"type": "done", "stats": {}}

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{self.base}/models")
            r.raise_for_status()
            return [{"name": m["id"], "size": 0} for m in r.json().get("data", [])]

    async def embed(self, model, texts):
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(f"{self.base}/embeddings", json={"model": model, "input": texts})
                if r.status_code != 200:
                    return None
                return [d["embedding"] for d in r.json()["data"]]
        except Exception:  # noqa: BLE001
            return None
