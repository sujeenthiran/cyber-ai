"""Outils système : infos machine, réseau, applications, commandes."""
from __future__ import annotations

import os
import platform
import socket
import subprocess
import time

import psutil

from ..config import settings
from ..security import PolicyError, allowed_roots, check_command, safe_path
from .proc import IS_WINDOWS, run, shell_argv, which
from .registry import registry


@registry.register(
    name="get_system_info",
    description="Donne l'état de l'ordinateur : système, processeur, mémoire, disques, temps d'allumage, processus les plus gourmands.",
    parameters={"properties": {}},
    category="systeme",
)
def get_system_info() -> dict:
    vm = psutil.virtual_memory()
    disks = []
    for p in psutil.disk_partitions(all=False):
        try:
            u = psutil.disk_usage(p.mountpoint)
            disks.append({"montage": p.mountpoint, "total_go": round(u.total / 1e9, 1), "utilise_pct": u.percent})
        except (PermissionError, OSError):
            continue
    procs = []
    for pr in psutil.process_iter(["name", "memory_info"]):
        try:
            procs.append((pr.info["memory_info"].rss, pr.info["name"]))
        except (psutil.Error, AttributeError, TypeError):
            continue
    procs.sort(reverse=True)
    return {
        "systeme": f"{platform.system()} {platform.release()} ({platform.version()})",
        "machine": socket.gethostname(),
        "processeur": platform.processor() or platform.machine(),
        "coeurs": psutil.cpu_count(logical=True),
        "cpu_pct": psutil.cpu_percent(interval=0.3),
        "ram_go": round(vm.total / 1e9, 1),
        "ram_pct": vm.percent,
        "disques": disks,
        "allume_depuis_h": round((time.time() - psutil.boot_time()) / 3600, 1),
        "top_memoire": [{"nom": n, "mo": round(r / 1e6)} for r, n in procs[:8]],
    }


@registry.register(
    name="network_info",
    description="Liste les interfaces réseau, adresses IP locales et les ports en écoute sur cet ordinateur (lecture seule).",
    parameters={"properties": {}},
    category="reseau",
)
def network_info() -> dict:
    ifaces = {}
    for name, addrs in psutil.net_if_addrs().items():
        ips = [a.address for a in addrs if a.family in (socket.AF_INET, socket.AF_INET6) and not a.address.startswith("fe80")]
        if ips:
            ifaces[name] = ips
    listening = []
    try:
        for c in psutil.net_connections(kind="inet"):
            if c.status == psutil.CONN_LISTEN and c.laddr:
                try:
                    pname = psutil.Process(c.pid).name() if c.pid else "?"
                except psutil.Error:
                    pname = "?"
                listening.append({"port": c.laddr.port, "adresse": c.laddr.ip, "processus": pname})
    except (psutil.AccessDenied, PermissionError):
        listening.append({"info": "Lance CYBER AI en administrateur pour voir tous les ports."})
    listening.sort(key=lambda x: x.get("port", 0))
    return {"interfaces": ifaces, "ports_en_ecoute": listening[:60]}


# ------------------------------------------------------------ applications
def _apps() -> dict[str, list[str] | str]:
    if IS_WINDOWS:
        edge = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        return {
            "bloc-notes": ["notepad.exe"],
            "calculatrice": ["calc.exe"],
            "explorateur": ["explorer.exe"],
            "terminal": [which("wt") or "powershell.exe"],
            "powershell": ["powershell.exe"],
            "gestionnaire des taches": ["taskmgr.exe"],
            "paint": ["mspaint.exe"],
            "parametres": "ms-settings:",
            "navigateur": [edge] if os.path.exists(edge) else "https://",
            "vscode": [which("code") or "code"],
            "wireshark": [which("wireshark") or "wireshark"],
            "zap": [which("zap") or "zap.bat"],
            "docker": [r"C:\Program Files\Docker\Docker\Docker Desktop.exe"],
            "observateur d'evenements": ["eventvwr.msc"],
            "moniteur de ressources": ["resmon.exe"],
        }
    return {"terminal": ["x-terminal-emulator"], "explorateur": ["xdg-open", os.path.expanduser("~")],
            "wireshark": ["wireshark"], "vscode": ["code"], "calculatrice": ["gnome-calculator"]}


def _normalize(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower().strip())
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def _find_app(name: str):
    n = _normalize(name)
    aliases = {"notepad": "bloc-notes", "bloc notes": "bloc-notes", "calc": "calculatrice", "calculette": "calculatrice",
               "explorer": "explorateur", "explorateur de fichiers": "explorateur", "code": "vscode",
               "visual studio code": "vscode", "edge": "navigateur", "chrome": "navigateur", "task manager": "gestionnaire des taches",
               "owasp zap": "zap", "settings": "parametres", "cmd": "terminal"}
    n = aliases.get(n, n)
    apps = _apps()
    if n in apps:
        return n, apps[n]
    for k, v in apps.items():
        if n in k or k in n:
            return k, v
    # Programme dans un dossier autorisé (.exe / .lnk / .bat)
    try:
        p = safe_path(name, must_exist=True)
        if p.suffix.lower() in (".exe", ".lnk", ".bat", ".cmd", ".msc"):
            return p.name, [str(p)]
    except PolicyError:
        pass
    return None, None


def _app_preview(args: dict) -> dict:
    key, target = _find_app(args.get("name", ""))
    if not key:
        return {"command": f"Ouvrir « {args.get('name')} »", "consequences": "Application inconnue : l'action échouera.", "risk": "medium"}
    cmd = target if isinstance(target, str) else " ".join(target)
    return {"command": cmd, "consequences": f"Lance l'application {key} sur ton bureau. Aucune donnée n'est modifiée."}


@registry.register(
    name="open_application",
    description="Ouvre une application sur l'ordinateur. Noms connus : bloc-notes, calculatrice, explorateur, terminal, powershell, "
                "gestionnaire des taches, paint, parametres, navigateur, vscode, wireshark, zap, docker, observateur d'evenements, moniteur de ressources.",
    parameters={"properties": {"name": {"type": "string", "description": "Nom de l'application"}}, "required": ["name"]},
    risk="medium",
    category="systeme",
    preview=_app_preview,
)
def open_application(name: str) -> str:
    key, target = _find_app(name)
    if not key:
        return f"Application « {name} » inconnue. Applications disponibles : {', '.join(_apps())}."
    if isinstance(target, str):
        if IS_WINDOWS:
            os.startfile(target)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", target])
    else:
        exe = target[0]
        if IS_WINDOWS and exe.lower().endswith((".lnk", ".msc", ".bat")):
            os.startfile(exe)  # type: ignore[attr-defined]
        else:
            flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if IS_WINDOWS else 0
            subprocess.Popen(target, creationflags=flags, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return f"Application {key} ouverte."


# ------------------------------------------------------------ commandes
def _cmd_preview(args: dict) -> dict:
    cmd = args.get("command", "")
    shell = args.get("shell", "powershell")
    try:
        risk = check_command(cmd)
    except PolicyError as e:
        return {"command": cmd, "consequences": str(e), "risk": "blocked"}
    cons = ("Peut modifier, supprimer ou télécharger des éléments sur ta machine." if risk == "high"
            else "Exécute la commande avec tes droits utilisateur.")
    return {"command": f"[{shell}] {cmd}", "consequences": cons + f" Dossier de travail : {_cwd()}. Délai max {settings.get('command_timeout')} s.", "risk": risk}


def _cwd() -> str:
    roots = allowed_roots()
    return str(roots[0]) if roots else os.path.expanduser("~")


def execute_command(command: str, shell: str = "powershell") -> dict:
    check_command(command)
    shell = "cmd" if shell == "cmd" else "powershell"
    res = run(shell_argv(command, shell), timeout=int(settings.get("command_timeout")), cwd=_cwd())
    res["command"] = command
    return res


@registry.register(
    name="run_command",
    description="Exécute une commande PowerShell (ou cmd) sur l'ordinateur et renvoie la sortie. À utiliser seulement si aucun "
                "autre outil ne convient. L'utilisateur doit valider la commande avant exécution.",
    parameters={
        "properties": {
            "command": {"type": "string", "description": "Commande exacte à exécuter"},
            "shell": {"type": "string", "enum": ["powershell", "cmd"], "description": "Interpréteur (powershell par défaut)"},
        },
        "required": ["command"],
    },
    risk="high",
    category="systeme",
    preview=_cmd_preview,
)
def run_command(command: str, shell: str = "powershell") -> dict:
    return execute_command(command, shell)
