"""Reconnaissance vocale locale (Whisper via faster-whisper, CPU int8)."""
from __future__ import annotations

import io
import threading
import wave

import numpy as np

from ..config import MODELS_DIR, settings

_model = None
_model_name = None
_lock = threading.Lock()


def _load():
    global _model, _model_name
    name = settings.get("stt_model") or "small"
    if _model is not None and _model_name == name:
        return _model
    from faster_whisper import WhisperModel
    _model = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(MODELS_DIR / "whisper"))
    _model_name = name
    return _model


def preload() -> None:
    with _lock:
        _load()


def stt_ready() -> dict:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return {"ok": False, "error": "faster-whisper non installé"}
    return {"ok": True, "loaded": _model is not None, "model": settings.get("stt_model")}


def _wav_to_float(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("WAV 16 bits attendu.")
        frames = w.readframes(w.getnframes())
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        if w.getnchannels() > 1:
            audio = audio.reshape(-1, w.getnchannels()).mean(axis=1)
        rate = w.getframerate()
    if rate != 16000:
        n = int(len(audio) * 16000 / rate)
        audio = np.interp(np.linspace(0, len(audio), n, endpoint=False), np.arange(len(audio)), audio).astype(np.float32)
    return audio


def transcribe(wav_bytes: bytes) -> dict:
    audio = _wav_to_float(wav_bytes)
    if len(audio) < 16000 * 0.3:
        return {"text": "", "duration": len(audio) / 16000}
    with _lock:
        model = _load()
        segments, info = model.transcribe(
            audio, language="fr", beam_size=1, vad_filter=True,
            initial_prompt="CYBER AI, cybersécurité, pfSense, Nmap, PowerShell, Linux, Windows, homelab.",
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    # Hallucinations classiques de Whisper sur du silence
    if text.lower().strip(" .!") in {"sous-titres réalisés par la communauté d'amara.org", "merci", "sous-titrage st' 501",
                                     "sous-titres par la communauté d'amara.org", "merci d'avoir regardé"}:
        text = ""
    return {"text": text, "duration": round(len(audio) / 16000, 2)}
