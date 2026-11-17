"""Lance CYBER AI : serveur local + fenêtre d'application."""
from __future__ import annotations

import argparse
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def free_port(preferred: int) -> int:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


def find_browser() -> str | None:
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    for name in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser"):
        p = shutil.which(name)
        if p:
            return p
    return None


def open_window(url: str, data_dir: Path) -> None:
    browser = find_browser()
    if browser:
        profile = data_dir / "app-window"
        profile.mkdir(parents=True, exist_ok=True)
        subprocess.Popen([
            browser, f"--app={url}", f"--user-data-dir={profile}", "--window-size=1600,960",
            "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-features=Translate",
            "--autoplay-policy=no-user-gesture-required",
        ])
    else:
        webbrowser.open(url)


def wait_ready(port: int, timeout: float = 60) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.3)
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description="CYBER AI")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-window", action="store_true", help="ne pas ouvrir la fenêtre")
    args = ap.parse_args()

    token = os.environ.get("CYBERAI_TOKEN") or secrets.token_urlsafe(32)
    os.environ["CYBERAI_TOKEN"] = token
    port = free_port(args.port)

    import uvicorn
    from cyberai.config import DATA_DIR

    url = f"http://127.0.0.1:{port}/#token={token}"
    print("=" * 60)
    print("  CYBER AI démarre...")
    print(f"  Interface : http://127.0.0.1:{port}  (jeton dans le raccourci)")
    print("  Ferme cette fenêtre pour arrêter CYBER AI.")
    print("=" * 60)
    if not args.no_window:
        threading.Thread(target=lambda: wait_ready(port) and open_window(url, DATA_DIR), daemon=True).start()
    else:
        print(f"  URL complète : {url}")
    uvicorn.run("cyberai.main:app", host="127.0.0.1", port=port, log_level="warning", ws_max_size=32 * 1024 * 1024)


if __name__ == "__main__":
    main()
