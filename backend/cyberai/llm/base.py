"""Interface commune des moteurs IA.

Format de message neutre utilisé par l'agent :
  {"role": "system"|"user"|"assistant", "content": str}
  {"role": "assistant", "content": str, "tool_calls": [{"id", "name", "arguments": dict}]}
  {"role": "tool", "tool_call_id": str, "name": str, "content": str}

Évènements produits par chat_stream :
  {"type": "token", "text": str}
  {"type": "tool_calls", "calls": [{"id", "name", "arguments": dict}]}
  {"type": "done", "stats": dict}
"""
from __future__ import annotations

import re
from typing import Any, AsyncIterator


class LLMError(Exception):
    pass


class ThinkFilter:
    """Retire les blocs <think>...</think> que certains modèles (Qwen3, DeepSeek-R1) émettent."""

    def __init__(self):
        self.buf = ""
        self.inside = False

    def feed(self, text: str) -> str:
        self.buf += text
        out = ""
        while True:
            if self.inside:
                end = self.buf.find("</think>")
                if end == -1:
                    self.buf = self.buf[-8:]
                    return out
                self.buf = self.buf[end + 8:]
                self.inside = False
            else:
                start = self.buf.find("<think>")
                if start == -1:
                    # garde une petite fin au cas où une balise est coupée
                    keep = 0
                    for k in range(min(6, len(self.buf)), 0, -1):
                        if "<think>".startswith(self.buf[-k:]):
                            keep = k
                            break
                    out += self.buf[: len(self.buf) - keep]
                    self.buf = self.buf[len(self.buf) - keep:]
                    return out
                out += self.buf[:start]
                self.buf = self.buf[start + 7:]
                self.inside = True

    def flush(self) -> str:
        out = "" if self.inside else self.buf
        self.buf = ""
        return out


def strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


class Provider:
    name = "base"

    async def chat_stream(
        self, model: str, messages: list[dict], tools: list[dict] | None, options: dict[str, Any]
    ) -> AsyncIterator[dict]:
        raise NotImplementedError
        yield {}

    async def list_models(self) -> list[dict]:
        raise NotImplementedError

    async def running(self) -> list[dict]:
        return []

    async def embed(self, model: str, texts: list[str]) -> list[list[float]] | None:
        return None

    async def health(self) -> dict:
        raise NotImplementedError

    async def pull(self, model: str) -> AsyncIterator[dict]:
        raise LLMError("Téléchargement non supporté par ce moteur.")
        yield {}

    async def delete(self, model: str) -> None:
        raise LLMError("Suppression non supportée par ce moteur.")
