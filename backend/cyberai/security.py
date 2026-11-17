"""Sécurité : jeton de session, chemins autorisés, commandes et cibles autorisées."""
from __future__ import annotations

import ipaddress
import os
import re
import secrets
import socket
from pathlib import Path
from urllib.parse import urlparse

from .config import settings

# Jeton aléatoire généré à chaque démarrage. Sans lui, aucun site web ouvert
# dans un navigateur ne peut piloter l'API locale (protection CSRF / DNS rebinding).
SESSION_TOKEN = os.environ.get("CYBERAI_TOKEN") or secrets.token_urlsafe(32)
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


def check_token(token: str | None) -> bool:
    return bool(token) and secrets.compare_digest(token, SESSION_TOKEN)


def check_host(host_header: str | None) -> bool:
    if not host_header:
        return False
    host = host_header.rsplit(":", 1)[0] if not host_header.startswith("[") else host_header.split("]")[0] + "]"
    return host in ALLOWED_HOSTS


class PolicyError(Exception):
    """Action refusée par la politique de sécurité."""


# ---------------------------------------------------------------- chemins
def allowed_roots() -> list[Path]:
    roots = []
    for r in settings.get("allowed_roots"):
        try:
            p = Path(os.path.expandvars(os.path.expanduser(r))).resolve()
            roots.append(p)
        except OSError:
            continue
    return roots


def safe_path(path: str, must_exist: bool = False) -> Path:
    """Résout un chemin et vérifie qu'il est dans un dossier autorisé."""
    if not path or not str(path).strip():
        raise PolicyError("Chemin vide.")
    raw = Path(os.path.expandvars(os.path.expanduser(str(path).strip())))
    roots = allowed_roots()
    if not raw.is_absolute():
        if not roots:
            raise PolicyError("Aucun dossier autorisé n'est configuré.")
        raw = roots[0] / raw
    resolved = raw.resolve()
    for root in roots:
        try:
            resolved.relative_to(root)
            break
        except ValueError:
            continue
    else:
        raise PolicyError(
            f"Accès refusé : {resolved} n'est pas dans un dossier autorisé "
            f"({', '.join(str(r) for r in roots)}). Ajoute-le dans Paramètres si tu le souhaites."
        )
    if must_exist and not resolved.exists():
        raise PolicyError(f"Introuvable : {resolved}")
    return resolved


# ---------------------------------------------------------------- commandes
# Commandes destructrices refusées même si l'utilisateur clique sur Autoriser.
BLOCKED_PATTERNS = [
    (r"\bformat(\.com)?\s+[a-z]:", "formatage d'un disque"),
    (r"\bdiskpart\b", "partitionnement de disque"),
    (r"\bbcdedit\b", "modification du démarrage Windows"),
    (r"\bvssadmin\b.*\bdelete\b", "suppression des clichés instantanés"),
    (r"\bwbadmin\b.*\bdelete\b", "suppression des sauvegardes"),
    (r"\bcipher\b.*\s/w", "effacement de l'espace libre"),
    (r"\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(/|~|\*|[a-z]:)\s*($|\s)", "suppression récursive de la racine"),
    (r"(?=.*\b(remove-item|ri|del|erase)\b)(?=.*-r(ecurse)?\b)(?=.*(^|\s)['\"]?([a-z]:\\?|\\|\$env:(systemroot|windir|userprofile))['\"]?(\s|$))", "suppression récursive d'un disque ou dossier système"),
    (r"\b(rd|rmdir)\s+/s\s+/q\s+[a-z]:\\?(\s|$)", "suppression d'un disque"),
    (r"\bdel\s+/[a-z\s/]*\s[a-z]:\\(windows|\*)", "suppression de fichiers système"),
    (r"\breg(\.exe)?\s+delete\s+hk(lm|ey_local_machine)", "suppression dans le registre système"),
    (r"set-mppreference\b.*disable", "désactivation de Microsoft Defender"),
    (r"\bnetsh\s+advfirewall\s+set\s+\w+\s+state\s+off", "désactivation du pare-feu"),
    (r"\b(invoke-expression|iex)\b.*\b(downloadstring|invoke-webrequest|iwr|curl|wget)\b", "exécution de code téléchargé"),
    (r"\b(downloadstring|invoke-webrequest|iwr)\b.*\|\s*(iex|invoke-expression)", "exécution de code téléchargé"),
    (r"-e(nc|ncodedcommand)?\s+[a-z0-9+/=]{40,}", "commande PowerShell encodée (masquée)"),
    (r":\(\)\s*\{\s*:\|:&\s*\};:", "fork bomb"),
    (r"\bmkfs(\.\w+)?\b", "formatage d'un disque"),
    (r"\bdd\s+.*of=/dev/(sd|nvme|hd)", "écriture brute sur un disque"),
    (r"\bshutdown\b|\bstop-computer\b|\brestart-computer\b", "arrêt ou redémarrage de la machine"),
]
_BLOCKED = [(re.compile(p, re.IGNORECASE), why) for p, why in BLOCKED_PATTERNS]

# Mots qui rendent une commande "risquée" (affichée en rouge) mais restent autorisables.
RISKY_WORDS = re.compile(
    r"\b(del|erase|remove-item|rm|rmdir|rd|move|mv|move-item|rename|ren|set-|new-service|sc\s+(create|delete|config)|"
    r"reg\s+add|schtasks|net\s+user|net\s+localgroup|icacls|takeown|attrib|stop-process|taskkill|kill|"
    r"invoke-webrequest|iwr|curl|wget|start-bitstransfer|pip\s+install|npm\s+install|winget|choco)\b",
    re.IGNORECASE,
)


def check_command(command: str) -> str:
    """Retourne le niveau de risque ('medium' / 'high') ou lève PolicyError si interdit."""
    cmd = (command or "").strip()
    if not cmd:
        raise PolicyError("Commande vide.")
    if len(cmd) > 4000:
        raise PolicyError("Commande trop longue.")
    if "\x00" in cmd:
        raise PolicyError("Caractère nul interdit.")
    for rx, why in _BLOCKED:
        if rx.search(cmd):
            raise PolicyError(f"Commande bloquée par sécurité ({why}). CYBER AI ne l'exécutera jamais.")
    return "high" if RISKY_WORDS.search(cmd) else "medium"


# ---------------------------------------------------------------- cibles réseau
def check_target(target: str) -> str:
    """Vérifie qu'une cible de scan est dans la liste des cibles autorisées."""
    t = (target or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9.\-:/]{1,100}", t):
        raise PolicyError("Cible invalide (adresse IP, réseau CIDR ou nom d'hôte uniquement).")
    try:
        net = ipaddress.ip_network(t, strict=False)
    except ValueError:
        try:
            net = ipaddress.ip_network(socket.gethostbyname(t))
        except OSError:
            raise PolicyError(f"Impossible de résoudre {t}.")
    for allowed in settings.get("authorized_targets"):
        try:
            a = ipaddress.ip_network(allowed, strict=False)
        except ValueError:
            continue
        if net.version == a.version and net.subnet_of(a):
            return t
    raise PolicyError(
        f"Cible {t} non autorisée. Seules ces cibles peuvent être testées : "
        f"{', '.join(settings.get('authorized_targets'))}. Ajoute une cible dans Paramètres "
        "uniquement si tu as le droit de la tester."
    )


def check_local_url(url: str) -> None:
    """En mode hors ligne, le cerveau doit être sur la machine ou le réseau local."""
    if not settings.get("offline_mode"):
        return
    host = urlparse(url).hostname or ""
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(host))
    except (OSError, ValueError):
        raise PolicyError(f"Adresse du moteur IA invalide : {url}")
    if not (ip.is_loopback or ip.is_private):
        raise PolicyError("Mode hors ligne actif : le moteur IA doit être local.")
