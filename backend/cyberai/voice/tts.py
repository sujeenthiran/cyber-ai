"""Synthèse vocale locale avec Piper + découpage du texte en phrases pour parler pendant la génération."""
from __future__ import annotations

import io
import re
import threading
import wave
from pathlib import Path

from ..config import VOICES_DIR, settings

_voice = None
_voice_name = None
_lock = threading.Lock()


def available_voices() -> list[str]:
    return sorted(p.stem for p in VOICES_DIR.glob("*.onnx") if (p.parent / (p.name + ".json")).exists())


def _load():
    global _voice, _voice_name
    name = settings.get("tts_voice")
    if _voice is not None and _voice_name == name:
        return _voice
    path = VOICES_DIR / f"{name}.onnx"
    if not path.exists():
        voices = available_voices()
        if not voices:
            raise RuntimeError("Aucune voix Piper installée (relance install.bat).")
        path = VOICES_DIR / f"{voices[0]}.onnx"
    from piper import PiperVoice  # import tardif : démarrage plus rapide
    _voice = PiperVoice.load(str(path))
    _voice_name = name
    return _voice


def tts_ready() -> dict:
    try:
        import piper  # noqa: F401
    except ImportError:
        return {"ok": False, "error": "piper-tts non installé"}
    v = available_voices()
    return {"ok": bool(v), "voices": v, "error": None if v else "Aucune voix dans backend/voices"}


def synthesize(text: str) -> bytes:
    """Retourne un WAV (bytes)."""
    from piper.config import SynthesisConfig
    speed = max(0.5, min(2.0, float(settings.get("tts_speed") or 1.0)))
    with _lock:
        voice = _load()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=1.0 / speed))
    return buf.getvalue()


# ------------------------------------------------------------ texte -> phrases parlables
def clean_for_speech(text: str) -> str:
    t = re.sub(r"`([^`]*)`", r"\1", text)
    t = re.sub(r"https?://\S+", "le lien affiché", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"[*_#>|~]+", " ", t)
    t = re.sub(r"^\s*[-•]\s+", "", t, flags=re.M)
    t = re.sub(r"^\s*\d+[.)]\s+", "", t, flags=re.M)
    t = t.replace("->", " vers ").replace("=>", " donc ").replace("&", " et ")
    t = re.sub(r"\s+", " ", t).strip()
    return t if re.search(r"\w", t) else ""


class SentenceSplitter:
    """Reçoit le texte en flux et renvoie les phrases complètes à prononcer (sans les blocs de code)."""

    END = re.compile(r"([.!?…:;])(\s+|$)|\n+")

    def __init__(self):
        self.buf = ""
        self.in_code = False

    def feed(self, text: str) -> list[str]:
        self.buf += text
        out: list[str] = []
        while True:
            if self.in_code:
                end = self.buf.find("```")
                if end == -1:
                    self.buf = self.buf[-3:] if self.buf.endswith(("`", "``")) else ""
                    return out
                self.buf = self.buf[end + 3:]
                self.in_code = False
                continue
            fence = self.buf.find("```")
            scan = self.buf if fence == -1 else self.buf[:fence]
            m = None
            for cand in self.END.finditer(scan):
                if cand.end() >= 12 or cand.group(0).startswith("\n"):
                    if cand.end() < len(scan) or fence != -1 or cand.group(0).startswith("\n"):
                        m = cand
                        break
            if m:
                sentence = scan[: m.end()]
                self.buf = self.buf[m.end():]
                s = clean_for_speech(sentence)
                if s:
                    out.append(s)
                continue
            if fence != -1:
                s = clean_for_speech(scan)
                if s:
                    out.append(s)
                self.buf = self.buf[fence + 3:]
                self.in_code = True
                continue
            return out

    def flush(self) -> list[str]:
        if self.in_code:
            self.buf = ""
            return []
        s = clean_for_speech(self.buf)
        self.buf = ""
        return [s] if s else []
