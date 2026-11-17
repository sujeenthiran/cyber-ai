"""Exécution de processus sécurisée (sans shell implicite, délai, sortie tronquée)."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time

IS_WINDOWS = sys.platform == "win32"
MAX_OUTPUT = 12000


def which(*names: str) -> str | None:
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    if IS_WINDOWS:
        guesses = {
            "nmap": [r"C:\Program Files (x86)\Nmap\nmap.exe", r"C:\Program Files\Nmap\nmap.exe"],
            "tshark": [r"C:\Program Files\Wireshark\tshark.exe"],
            "wireshark": [r"C:\Program Files\Wireshark\Wireshark.exe"],
            "docker": [r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"],
            "zap": [r"C:\Program Files\ZAP\Zed Attack Proxy\zap.bat", r"C:\Program Files\OWASP\Zed Attack Proxy\zap.bat"],
        }
        for n in names:
            for g in guesses.get(n, []):
                if os.path.exists(g):
                    return g
    return None


def truncate(text: str, limit: int = MAX_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + f"\n\n[... {len(text) - limit} caractères coupés ...]\n\n" + text[-half:]


def run(argv: list[str], timeout: int = 120, cwd: str | None = None) -> dict:
    """Lance une commande (liste d'arguments, jamais de chaîne interprétée)."""
    start = time.time()
    flags = subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0
    try:
        p = subprocess.run(
            argv, capture_output=True, timeout=timeout, cwd=cwd, creationflags=flags,
            stdin=subprocess.DEVNULL,
        )
        out = p.stdout.decode("utf-8", "replace")
        err = p.stderr.decode("utf-8", "replace")
        return {
            "code": p.returncode,
            "stdout": truncate(out),
            "stderr": truncate(err, 4000),
            "duration": round(time.time() - start, 2),
        }
    except subprocess.TimeoutExpired:
        return {"code": -1, "stdout": "", "stderr": f"Délai dépassé ({timeout} s) : commande arrêtée.", "duration": timeout}
    except FileNotFoundError:
        return {"code": -1, "stdout": "", "stderr": f"Programme introuvable : {argv[0]}", "duration": 0}


def shell_argv(command: str, shell: str = "powershell") -> list[str]:
    if IS_WINDOWS:
        if shell == "cmd":
            return ["cmd.exe", "/d", "/c", command]
        ps = which("pwsh", "powershell") or "powershell"
        return [ps, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + command]
    return ["/bin/bash", "-c", command]
