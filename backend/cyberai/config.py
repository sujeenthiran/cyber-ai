"""Chemins et réglages persistants (data/settings.json)."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = Path(os.environ.get("CYBERAI_DATA", BACKEND_DIR / "data"))
VOICES_DIR = BACKEND_DIR / "voices"
MODELS_DIR = DATA_DIR / "models"
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
DEFAULT_WORKSPACE = Path.home() / "CyberAI_Workspace"

for d in (DATA_DIR, MODELS_DIR, VOICES_DIR):
    d.mkdir(parents=True, exist_ok=True)

DEFAULTS: dict[str, Any] = {
    # Cerveau
    "provider": "ollama",                     # "ollama" ou "openai" (LM Studio, llama.cpp server...)
    "ollama_url": "http://127.0.0.1:11434",
    "openai_url": "http://127.0.0.1:1234/v1",
    "model": "qwen3:8b",
    "embed_model": "nomic-embed-text",
    "temperature": 0.6,
    "num_ctx": 8192,
    "history_messages": 20,
    # Identité
    "user_name": "",
    "persona_extra": "",
    # Voix
    "tts_enabled": True,
    "tts_voice": "fr_FR-siwis-medium",
    "tts_speed": 1.0,
    "stt_model": "small",
    "vad_threshold": 0.02,
    "vad_silence_ms": 900,
    # Sécurité
    "allowed_roots": [str(DEFAULT_WORKSPACE)],
    "authorized_targets": ["127.0.0.1", "192.168.50.0/24"],
    "offline_mode": True,
    "command_timeout": 120,
}


class Settings:
    """Réglages thread-safe, sauvegardés en JSON."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._data: dict[str, Any] = dict(DEFAULTS)
        if path.exists():
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                self._data.update({k: v for k, v in saved.items() if k in DEFAULTS})
            except (OSError, json.JSONDecodeError):
                pass
        DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
        self.save()

    def get(self, key: str) -> Any:
        with self._lock:
            return self._data.get(key, DEFAULTS.get(key))

    def all(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._data)

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            for k, v in values.items():
                if k not in DEFAULTS:
                    continue
                default = DEFAULTS[k]
                # Contrôle de type simple pour éviter des réglages cassés
                if isinstance(default, bool):
                    v = bool(v)
                elif isinstance(default, int) and not isinstance(default, bool):
                    v = int(v)
                elif isinstance(default, float):
                    v = float(v)
                elif isinstance(default, list):
                    if not isinstance(v, list):
                        continue
                    v = [str(x).strip() for x in v if str(x).strip()]
                else:
                    v = str(v)
                self._data[k] = v
        self.save()
        return self.all()

    def save(self) -> None:
        with self._lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.path)


settings = Settings(DATA_DIR / "settings.json")
