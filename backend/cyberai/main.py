"""API locale de CYBER AI (FastAPI) : WebSocket de conversation + REST pour les espaces de l'interface."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, audit, monitor
from .agent import AgentSession
from .config import FRONTEND_DIST, settings
from .llm import LLMError, get_provider
from .memory import store
from .security import PolicyError, allowed_roots, check_command, check_host, check_target, check_token, safe_path
from .tools import registry
from .tools.cyber_tools import analyze_file, analyze_log, nmap_scan, tools_status, NMAP_PROFILES
from .tools.file_tools import _entry, open_in_system, read_text
from .tools.memory_tools import embedder
from .tools.system_tools import execute_command
from .voice import stt, tts

app = FastAPI(title="CYBER AI", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def guard(request: Request, call_next):
    # Anti DNS-rebinding : seul l'hôte local est accepté
    if not check_host(request.headers.get("host")):
        return JSONResponse({"detail": "Hôte refusé"}, status_code=403)
    if request.url.path.startswith("/api/") and not check_token(request.headers.get("x-cyberai-token")):
        return JSONResponse({"detail": "Jeton de session invalide. Relance CYBER AI avec le raccourci."}, status_code=401)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; "
        "font-src 'self' data:; worker-src 'self' blob:"
    )
    return resp


def _err(e: Exception, code: int = 400):
    raise HTTPException(status_code=code, detail=str(e))


# ------------------------------------------------------------------ état général
@app.get("/api/status")
async def status():
    prov = get_provider()
    health = await prov.health()
    models = []
    if health.get("ok"):
        try:
            models = [m["name"] for m in await prov.list_models()]
        except Exception:  # noqa: BLE001
            pass
    model = settings.get("model")
    return {
        "version": __version__,
        "provider": prov.name,
        "llm": health,
        "model": model,
        "model_installed": any(m == model or m.split(":")[0] == model or m == f"{model}:latest" for m in models),
        "embed_installed": any(m.startswith(settings.get("embed_model")) for m in models),
        "tts": tts.tts_ready(),
        "stt": stt.stt_ready(),
        "tools": tools_status(),
    }


@app.get("/api/system")
async def system():
    snap = monitor.snapshot()
    snap["llm_running"] = await get_provider().running()
    return snap


# ------------------------------------------------------------------ réglages
@app.get("/api/settings")
async def get_settings():
    return {**settings.all(), "voices": tts.available_voices()}


@app.put("/api/settings")
async def put_settings(values: dict = Body(...)):
    if "ollama_url" in values or "openai_url" in values or "offline_mode" in values:
        from .security import check_local_url
        merged = {**settings.all(), **values}
        try:
            if merged.get("offline_mode"):
                check_local_url(merged["ollama_url"])
                check_local_url(merged["openai_url"])
        except PolicyError as e:
            _err(e)
    new = settings.update(values)
    for r in new["allowed_roots"]:
        try:
            Path(os.path.expandvars(os.path.expanduser(r))).mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
    audit.log("parametres", "Paramètres modifiés", {k: values[k] for k in values if k != "persona_extra"})
    return {**new, "voices": tts.available_voices()}


# ------------------------------------------------------------------ modèles IA
@app.get("/api/models")
async def models():
    prov = get_provider()
    try:
        return {"models": await prov.list_models(), "running": await prov.running(), "active": settings.get("model")}
    except Exception as e:  # noqa: BLE001
        _err(LLMError(f"Moteur IA injoignable : {e}"), 503)


@app.post("/api/models/pull")
async def pull_model(body: dict = Body(...)):
    name = str(body.get("name", "")).strip()
    if not name or len(name) > 120:
        _err(ValueError("Nom de modèle invalide"))
    if settings.get("offline_mode"):
        _err(PolicyError("Mode hors ligne actif : désactive-le dans Paramètres le temps du téléchargement."))
    prov = get_provider()
    audit.log("modele", f"Téléchargement {name}")

    async def gen():
        try:
            async for ev in prov.pull(name):
                yield json.dumps(ev) + "\n"
        except Exception as e:  # noqa: BLE001
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.delete("/api/models/{name:path}")
async def delete_model(name: str):
    try:
        await get_provider().delete(name)
        audit.log("modele", f"Suppression {name}")
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        _err(e)


# ------------------------------------------------------------------ voix
@app.post("/api/stt")
async def speech_to_text(request: Request):
    data = await request.body()
    if len(data) > 30 * 1024 * 1024:
        _err(ValueError("Audio trop long"))
    try:
        return await asyncio.to_thread(stt.transcribe, data)
    except Exception as e:  # noqa: BLE001
        _err(RuntimeError(f"Reconnaissance vocale impossible : {e}"), 500)


@app.post("/api/tts")
async def text_to_speech(body: dict = Body(...)):
    text = tts.clean_for_speech(str(body.get("text", "")))[:1000]
    if not text:
        _err(ValueError("Texte vide"))
    try:
        wav = await asyncio.to_thread(tts.synthesize, text)
    except Exception as e:  # noqa: BLE001
        _err(RuntimeError(str(e)), 500)
    return Response(wav, media_type="audio/wav")


# ------------------------------------------------------------------ mémoire & conversations
@app.get("/api/conversations")
async def conversations():
    return store.list_conversations()


@app.get("/api/conversations/{cid}")
async def conversation(cid: int):
    if not store.conversation_exists(cid):
        _err(KeyError("Conversation introuvable"), 404)
    return store.get_messages(cid)


@app.delete("/api/conversations/{cid}")
async def delete_conversation(cid: int):
    store.delete_conversation(cid)
    return {"ok": True}


@app.get("/api/memories")
async def memories(q: str = "", category: str = ""):
    if q:
        return await store.search_memories(q, 30, embedder, settings.get("embed_model"))
    return store.list_memories(category or None)


@app.post("/api/memories")
async def add_memory(body: dict = Body(...)):
    try:
        return await store.add_memory(str(body.get("content", "")), str(body.get("category", "general")),
                                      int(body.get("importance", 3)), embedder, settings.get("embed_model"))
    except ValueError as e:
        _err(e)


@app.delete("/api/memories/{mid}")
async def delete_memory(mid: int):
    store.delete_memory(mid)
    return {"ok": True}


@app.post("/api/memories/reindex")
async def reindex():
    n = await store.reindex(embedder, settings.get("embed_model"))
    return {"indexed": n}


# ------------------------------------------------------------------ fichiers
@app.get("/api/files/roots")
async def file_roots():
    return [str(r) for r in allowed_roots()]


@app.get("/api/files/list")
async def file_list(path: str):
    try:
        p = safe_path(path, must_exist=True)
    except PolicyError as e:
        _err(e, 403)
    if not p.is_dir():
        _err(ValueError("Pas un dossier"))
    items = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    roots = allowed_roots()
    return {"path": str(p), "parent": str(p.parent) if p not in roots else None,
            "items": [{**_entry(i), "path": str(i)} for i in items[:500]]}


@app.get("/api/files/read")
async def file_read(path: str):
    try:
        p = safe_path(path, must_exist=True)
        return {"path": str(p), "content": read_text(p, 200_000)}
    except (PolicyError, ValueError, OSError) as e:
        _err(e)


@app.post("/api/files/open")
async def file_open(body: dict = Body(...)):
    try:
        p = safe_path(str(body.get("path", "")), must_exist=True)
        open_in_system(p)
        audit.log("fichier", f"Ouverture {p.name}", str(p), "ok")
        return {"ok": True}
    except (PolicyError, OSError) as e:
        _err(e)


# ------------------------------------------------------------------ terminal (commande tapée par l'utilisateur)
@app.post("/api/terminal")
async def terminal(body: dict = Body(...)):
    command = str(body.get("command", ""))
    shell = str(body.get("shell", "powershell"))
    try:
        check_command(command)
    except PolicyError as e:
        audit.log("terminal", command[:120], str(e), "blocked")
        _err(e, 403)
    res = await asyncio.to_thread(execute_command, command, shell)
    audit.log("terminal", command[:120], {"code": res["code"]}, "ok" if res["code"] == 0 else "error")
    return res


# ------------------------------------------------------------------ cyber lab
@app.get("/api/cyber/tools")
async def cyber_tools():
    return {"installed": tools_status(), "catalog": registry.catalog(), "nmap_profiles": {k: v[1] for k, v in NMAP_PROFILES.items()},
            "authorized_targets": settings.get("authorized_targets")}


@app.post("/api/cyber/analyze-file")
async def cyber_analyze_file(body: dict = Body(...)):
    try:
        res = await asyncio.to_thread(analyze_file, str(body.get("path", "")))
        audit.log("cyber", "Analyse de fichier", {"fichier": body.get("path"), "niveau": res.get("niveau")}, "ok")
        return res
    except (PolicyError, OSError) as e:
        _err(e)


@app.post("/api/cyber/analyze-log")
async def cyber_analyze_log(body: dict = Body(...)):
    try:
        res = await asyncio.to_thread(analyze_log, str(body.get("path", "")))
        audit.log("cyber", "Analyse de logs", {"fichier": body.get("path"), "alertes": len(res.get("alertes", []))}, "ok")
        return res
    except (PolicyError, OSError) as e:
        _err(e)


@app.post("/api/cyber/nmap")
async def cyber_nmap(body: dict = Body(...)):
    # L'interface affiche une confirmation avant d'appeler cette route.
    try:
        check_target(str(body.get("target", "")))
        res = await asyncio.to_thread(nmap_scan, str(body.get("target")), str(body.get("profile", "rapide")))
        audit.log("cyber", f"Nmap {body.get('target')}", {"profil": body.get("profile")}, "ok" if res.get("code") == 0 else "error")
        return res
    except PolicyError as e:
        _err(e, 403)


@app.get("/api/activity")
async def activity(limit: int = 100):
    return audit.recent(limit)


# ------------------------------------------------------------------ WebSocket de conversation
@app.websocket("/ws")
async def ws(websocket: WebSocket):
    if not check_host(websocket.headers.get("host")) or not check_token(websocket.query_params.get("token")):
        await websocket.close(code=4401)
        return
    origin = websocket.headers.get("origin", "")
    if origin and not check_host(origin.split("://", 1)[-1]):
        await websocket.close(code=4403)
        return
    await websocket.accept()
    lock = asyncio.Lock()

    async def send(msg: dict):
        async with lock:
            await websocket.send_json(msg)

    session = AgentSession(send)

    def listener(entry: dict):
        return send({"type": "activity", "entry": entry})

    audit.subscribe(listener)
    try:
        while True:
            msg = await websocket.receive_json()
            t = msg.get("type")
            if t == "user_message":
                await session.user_message(str(msg.get("text", ""))[:8000], msg.get("conversation_id"), bool(msg.get("voice")))
            elif t == "confirm_response":
                session.confirm(str(msg.get("id")), bool(msg.get("approved")))
            elif t == "interrupt":
                await session.interrupt()
            elif t == "new_conversation":
                await session.interrupt(silent=True)
                session.new_conversation()
            elif t == "ping":
                await send({"type": "pong"})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        audit.unsubscribe(listener)
        await session.close()


# ------------------------------------------------------------------ interface
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        f = (FRONTEND_DIST / path).resolve()
        if path and f.is_file() and FRONTEND_DIST.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
