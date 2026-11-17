"""Agent conversationnel : cerveau local + outils + confirmations + voix en flux."""
from __future__ import annotations

import asyncio
import base64
import json
import re
import time
import uuid
from typing import Any, Awaitable, Callable

from . import audit
from .config import settings
from .llm import LLMError, get_provider
from .memory import store
from .persona import build_system_prompt
from .security import PolicyError
from .tools import registry
from .tools.memory_tools import embedder
from .voice import tts

Send = Callable[[dict], Awaitable[None]]
MAX_STEPS = 8
CONFIRM_TIMEOUT = 300


def guess_emotion(text: str) -> str:
    t = text.lower()
    if re.search(r"attention|danger|risqu|malveill|alerte|critique|suspect|refus|bloqu|impossible|erreur|échou", t):
        return "concerned"
    if re.search(r"bravo|parfait|super|génial|excellent|ravi|content|bonne nouvelle|félicitations|avec plaisir|bienvenue|salut|bonjour", t):
        return "happy"
    if re.search(r"incroyable|étonnant|surprenant|wow|oh !", t):
        return "surprised"
    if "?" in t:
        return "curious"
    return "neutral"


def _result_to_text(result: Any) -> str:
    if isinstance(result, str):
        text = result
    else:
        text = json.dumps(result, ensure_ascii=False, indent=1, default=str)
    if len(text) > 12000:
        text = text[:12000] + "\n[... résultat tronqué ...]"
    return text


class AgentSession:
    def __init__(self, send: Send):
        self._send = send
        self.conv_id: int | None = None
        self.pending: dict[str, asyncio.Future] = {}
        self.task: asyncio.Task | None = None
        self.tts_queue: asyncio.Queue = asyncio.Queue()
        self.tts_task = asyncio.create_task(self._tts_worker())
        self.generation = 0

    async def send(self, msg: dict) -> None:
        try:
            await self._send(msg)
        except Exception:  # noqa: BLE001  (client déconnecté)
            pass

    async def close(self) -> None:
        await self.interrupt(silent=True)
        self.tts_task.cancel()

    # -------------------------------------------------------------- entrées client
    async def user_message(self, text: str, conv_id: int | None, voice: bool) -> None:
        text = (text or "").strip()
        if not text:
            return
        await self.interrupt(silent=True)
        if conv_id and store.conversation_exists(conv_id):
            self.conv_id = conv_id
        else:
            self.conv_id = store.create_conversation(text[:60])
            await self.send({"type": "conversation", "id": self.conv_id, "title": text[:60]})
        self.generation += 1
        self.task = asyncio.create_task(self._run(text, voice, self.generation))

    def confirm(self, call_id: str, approved: bool) -> None:
        fut = self.pending.get(call_id)
        if fut and not fut.done():
            fut.set_result(bool(approved))

    async def interrupt(self, silent: bool = False) -> None:
        self.generation += 1
        while not self.tts_queue.empty():
            self.tts_queue.get_nowait()
        for fut in self.pending.values():
            if not fut.done():
                fut.set_result(False)
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            if not silent:
                await self.send({"type": "interrupted"})
        self.task = None

    def new_conversation(self) -> None:
        self.conv_id = None

    # -------------------------------------------------------------- voix
    async def _tts_worker(self) -> None:
        while True:
            gen, seq, text = await self.tts_queue.get()
            if gen != self.generation:
                continue
            try:
                wav = await asyncio.to_thread(tts.synthesize, text)
            except Exception as e:  # noqa: BLE001
                await self.send({"type": "tts_error", "text": text, "error": str(e)})
                continue
            if gen != self.generation:
                continue
            await self.send({"type": "audio", "seq": seq, "text": text, "emotion": guess_emotion(text),
                             "data": base64.b64encode(wav).decode("ascii")})

    # -------------------------------------------------------------- boucle principale
    async def _run(self, text: str, voice: bool, gen: int) -> None:
        provider = get_provider()
        speak = voice and settings.get("tts_enabled") and tts.tts_ready()["ok"]
        splitter = tts.SentenceSplitter()
        seq = 0
        full = ""
        trace: list[dict] = []
        start = time.time()
        conv_id = self.conv_id
        store.add_message(conv_id, "user", text)
        await self.send({"type": "state", "state": "thinking"})
        try:
            profile = store.profile_memories()
            relevant = await store.search_memories(text, 5, embedder, settings.get("embed_model"))
            history = store.get_messages(conv_id, settings.get("history_messages"))[:-1]
            msgs: list[dict] = [{"role": "system", "content": build_system_prompt(profile, relevant)}]
            msgs += [{"role": m["role"], "content": m["content"]} for m in history if m["role"] in ("user", "assistant") and m["content"]]
            msgs.append({"role": "user", "content": text})
            if relevant:
                await self.send({"type": "memory_used", "items": [m["content"] for m in relevant]})
            options = {"temperature": settings.get("temperature"), "num_ctx": settings.get("num_ctx")}
            tools = registry.schemas()
            stats: dict = {}
            for _step in range(MAX_STEPS):
                content = ""
                calls = None
                async for ev in provider.chat_stream(settings.get("model"), msgs, tools, options):
                    if ev["type"] == "token":
                        content += ev["text"]
                        await self.send({"type": "token", "text": ev["text"]})
                        if speak:
                            for s in splitter.feed(ev["text"]):
                                seq += 1
                                self.tts_queue.put_nowait((gen, seq, s))
                    elif ev["type"] == "tool_calls":
                        calls = ev["calls"]
                    elif ev["type"] == "warning":
                        await self.send({"type": "warning", "text": ev["text"]})
                    elif ev["type"] == "done":
                        stats = ev.get("stats") or {}
                if speak:
                    for s in splitter.flush():
                        seq += 1
                        self.tts_queue.put_nowait((gen, seq, s))
                if content.strip():
                    full += ("\n\n" if full else "") + content.strip()
                if not calls:
                    break
                msgs.append({"role": "assistant", "content": content, "tool_calls": calls})
                for call in calls:
                    result, status = await self._execute_tool(call)
                    trace.append({"tool": call["name"], "args": {k: v for k, v in call["arguments"].items() if k != "content"}, "status": status})
                    msgs.append({"role": "tool", "tool_call_id": call["id"], "name": call["name"], "content": result})
                await self.send({"type": "token", "text": "\n\n"})
                await self.send({"type": "state", "state": "thinking"})
            else:
                full += "\n\n(J'ai atteint la limite d'actions enchaînées pour cette demande.)"
            if not full.strip():
                full = "(pas de réponse)"
            mid = store.add_message(conv_id, "assistant", full, {"tools": trace, "stats": stats})
            await self.send({"type": "done", "message_id": mid, "stats": {**stats, "seconds": round(time.time() - start, 1)},
                             "speech": seq, "emotion": guess_emotion(full[-300:])})
        except asyncio.CancelledError:
            if full or trace:
                store.add_message(conv_id, "assistant", (full + " [interrompu]").strip(), {"tools": trace, "interrupted": True})
            raise
        except LLMError as e:
            await self.send({"type": "error", "text": str(e)})
            audit.log("erreur", "Moteur IA", str(e), "error")
        except Exception as e:  # noqa: BLE001
            await self.send({"type": "error", "text": f"Erreur interne : {type(e).__name__}: {e}"})
            audit.log("erreur", "Agent", repr(e), "error")
        finally:
            if gen == self.generation:
                await self.send({"type": "state", "state": "idle"})

    async def _execute_tool(self, call: dict) -> tuple[str, str]:
        name, args = call.get("name", ""), call.get("arguments") or {}
        call_id = call.get("id") or uuid.uuid4().hex[:12]
        tool = registry.get(name)
        if not tool:
            return f"Outil inconnu : {name}. Outils disponibles : {', '.join(registry.tools)}", "error"
        if not tool.available():
            return f"L'outil {name} n'est pas disponible (logiciel non installé).", "error"
        info = tool.describe(args)
        await self.send({"type": "tool_start", "id": call_id, "name": name, "risk": info["risk"], "command": info["command"]})
        if info["risk"] == "blocked":
            audit.log("outil", f"{name} bloqué", info, "blocked")
            await self.send({"type": "tool_end", "id": call_id, "status": "blocked", "summary": info["consequences"]})
            return f"Action bloquée par la politique de sécurité : {info['consequences']}", "blocked"
        if tool.risk != "safe":
            await self.send({"type": "state", "state": "waiting"})
            fut = asyncio.get_running_loop().create_future()
            self.pending[call_id] = fut
            await self.send({
                "type": "confirm_request", "id": call_id, "tool": name, "command": info["command"],
                "objectif": args.get("objectif") or "(non précisé par l'IA)", "consequences": info.get("consequences", ""),
                "risk": info["risk"], "preview": info.get("preview"),
            })
            try:
                approved = await asyncio.wait_for(fut, CONFIRM_TIMEOUT)
            except asyncio.TimeoutError:
                approved = False
            finally:
                self.pending.pop(call_id, None)
            if not approved:
                audit.log("outil", f"{name} refusé", info, "denied")
                await self.send({"type": "tool_end", "id": call_id, "status": "denied", "summary": "Refusé par toi."})
                await self.send({"type": "state", "state": "thinking"})
                return "L'utilisateur a REFUSÉ cette action. Ne la relance pas ; explique brièvement et propose une alternative.", "denied"
        await self.send({"type": "state", "state": "executing"})
        try:
            result = await tool.run(args)
            text, status = _result_to_text(result), "ok"
        except PolicyError as e:
            text, status = f"Refusé par la politique de sécurité : {e}", "blocked"
        except Exception as e:  # noqa: BLE001
            text, status = f"Erreur pendant {name} : {type(e).__name__}: {e}", "error"
        audit.log("outil", name, {"commande": info["command"], "resultat": text[:2000]}, status)
        await self.send({"type": "tool_end", "id": call_id, "status": status, "summary": text[:600]})
        await self.send({"type": "state", "state": "thinking"})
        return text, status
