"""Modules cybersécurité : analyse de fichiers et de logs (Python pur, lecture seule)
et pilotage d'outils installés (Nmap, YARA, Semgrep, tshark, Docker) avec garde-fous."""
from __future__ import annotations

import collections
import hashlib
import math
import re
import struct
import time
from pathlib import Path

from ..config import settings
from ..security import PolicyError, check_target, safe_path
from .proc import run, which
from .registry import registry

SECURITY_TOOLS = {
    "nmap": ("nmap",),
    "tshark": ("tshark",),
    "wireshark": ("wireshark", "Wireshark"),
    "yara": ("yara64", "yara"),
    "semgrep": ("semgrep",),
    "docker": ("docker",),
    "zap": ("zap", "zap.sh", "zap.bat"),
    "python": ("python", "python3"),
    "git": ("git",),
}


def tools_status() -> dict:
    return {name: which(*bins) for name, bins in SECURITY_TOOLS.items()}


@registry.register(
    name="check_security_tools",
    description="Indique quels outils de sécurité sont installés (nmap, wireshark/tshark, yara, semgrep, docker, zap).",
    parameters={"properties": {}},
    category="cyber",
)
def check_security_tools() -> dict:
    st = tools_status()
    return {k: ("installé : " + v) if v else "non installé" for k, v in st.items()}


# ------------------------------------------------------------ analyse de fichier
MAGIC = [
    (b"MZ", "Exécutable Windows (PE/MZ)"), (b"\x7fELF", "Exécutable Linux (ELF)"), (b"%PDF", "Document PDF"),
    (b"PK\x03\x04", "Archive ZIP (ou docx/xlsx/jar/apk)"), (b"Rar!", "Archive RAR"), (b"7z\xbc\xaf\x27\x1c", "Archive 7-Zip"),
    (b"\xd0\xcf\x11\xe0", "Document Office ancien (OLE, peut contenir des macros)"), (b"\x89PNG", "Image PNG"),
    (b"\xff\xd8\xff", "Image JPEG"), (b"GIF8", "Image GIF"), (b"\x1f\x8b", "Archive GZIP"), (b"#!", "Script (shebang)"),
    (b"\xca\xfe\xba\xbe", "Classe Java / Mach-O"), (b"{\\rtf", "Document RTF"), (b"ITSF", "Aide Windows CHM"),
]
SUSPICIOUS = [
    (r"https?://[^\s\"'<>]{4,200}", "URL"),
    (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "Adresse IP"),
    (r"(?i)powershell(\.exe)?\s+.*-e(nc|ncodedcommand)?\s", "PowerShell encodé"),
    (r"(?i)(invoke-expression|iex\s*\(|downloadstring|frombase64string)", "Exécution PowerShell dynamique"),
    (r"(?i)(virtualalloc(ex)?|writeprocessmemory|createremotethread|ntunmapviewofsection|setwindowshookex)", "API d'injection mémoire"),
    (r"(?i)(urldownloadtofile|winhttpopen|internetopenurl)", "API de téléchargement"),
    (r"(?i)software\\microsoft\\windows\\currentversion\\run", "Clé de démarrage automatique"),
    (r"(?i)(vssadmin.*delete|wbadmin.*delete|bcdedit.*recoveryenabled)", "Suppression de sauvegardes (rançongiciel)"),
    (r"(?i)(mimikatz|sekurlsa|lsass\.exe)", "Vol d'identifiants"),
    (r"(?i)(isdebuggerpresent|checkremotedebuggerpresent)", "Anti-débogage"),
    (r"(?i)\b(autoopen|document_open|workbook_open|shell\(|wscript\.shell)", "Macro / script auto-exécuté"),
    (r"[A-Za-z0-9+/]{120,}={0,2}", "Bloc base64 long"),
]


def _entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = collections.Counter(data)
    n = len(data)
    return -sum(c / n * math.log2(c / n) for c in counts.values())


def _strings(data: bytes, min_len: int = 5) -> list[str]:
    ascii_s = re.findall(rb"[\x20-\x7e]{%d,}" % min_len, data)
    wide = re.findall(rb"(?:[\x20-\x7e]\x00){%d,}" % min_len, data)
    return [s.decode("ascii", "ignore") for s in ascii_s] + [w.decode("utf-16le", "ignore") for w in wide]


def _pe_info(data: bytes) -> dict | None:
    try:
        if data[:2] != b"MZ":
            return None
        off = struct.unpack_from("<I", data, 0x3C)[0]
        if data[off:off + 4] != b"PE\x00\x00":
            return None
        machine, nsec, ts = struct.unpack_from("<HHI", data, off + 4)
        opt_size = struct.unpack_from("<H", data, off + 20)[0]
        chars = struct.unpack_from("<H", data, off + 22)[0]
        sec_off = off + 24 + opt_size
        sections = []
        for i in range(min(nsec, 40)):
            s = sec_off + i * 40
            name = data[s:s + 8].rstrip(b"\x00").decode("ascii", "replace")
            raw_size, raw_ptr = struct.unpack_from("<II", data, s + 16)
            body = data[raw_ptr:raw_ptr + raw_size]
            sections.append({"nom": name, "taille": raw_size, "entropie": round(_entropy(body), 2)})
        return {
            "architecture": {0x14C: "x86 (32 bits)", 0x8664: "x64", 0xAA64: "ARM64"}.get(machine, hex(machine)),
            "compile_le": time.strftime("%Y-%m-%d", time.gmtime(ts)) if 0 < ts < 4102444800 else "date invalide (falsifiée ?)",
            "dll": bool(chars & 0x2000),
            "sections": sections,
            "packe_probable": any(s["entropie"] > 7.2 for s in sections) or any(s["nom"].upper().startswith(("UPX", ".ASPACK", ".PETITE")) for s in sections),
        }
    except (struct.error, IndexError):
        return None


@registry.register(
    name="analyze_file",
    description="Analyse statique d'un fichier suspect SANS l'exécuter : empreintes (MD5/SHA256), vrai type, entropie, "
                "en-tête PE, chaînes suspectes (URL, IP, API d'injection, PowerShell encodé...). Donne un score de risque.",
    parameters={"properties": {"path": {"type": "string", "description": "Chemin du fichier"}}, "required": ["path"]},
    category="cyber",
)
def analyze_file(path: str) -> dict:
    p = safe_path(path, must_exist=True)
    if not p.is_file():
        return {"erreur": "Ce n'est pas un fichier."}
    size = p.stat().st_size
    if size > 200 * 1024 * 1024:
        return {"erreur": "Fichier trop gros (> 200 Mo) pour l'analyse."}
    data = p.read_bytes()
    kind = next((label for sig, label in MAGIC if data.startswith(sig)), "Inconnu / texte")
    ext = p.suffix.lower()
    findings: dict[str, list[str]] = {}
    text_blob = "\n".join(_strings(data))[:3_000_000]
    for rx, label in SUSPICIOUS:
        hits = list(dict.fromkeys(m.group(0)[:120] for m in re.finditer(rx, text_blob)))
        if hits:
            findings[label] = hits[:8]
    score = 0
    reasons = []
    ent = _entropy(data)
    if ent > 7.5:
        score += 2; reasons.append("contenu très compressé ou chiffré (entropie élevée)")
    pe = _pe_info(data)
    if pe and pe["packe_probable"]:
        score += 2; reasons.append("exécutable probablement compressé/obfusqué (packer)")
    if kind.startswith("Exécutable") and ext not in (".exe", ".dll", ".sys", ".scr", ".com", ".elf", ".so", ""):
        score += 3; reasons.append(f"exécutable déguisé en {ext}")
    if re.search(r"\.(pdf|docx?|xlsx?|jpg|png|txt)\.(exe|scr|bat|cmd|js|vbs|ps1)$", p.name, re.I):
        score += 3; reasons.append("double extension trompeuse")
    weights = {"API d'injection mémoire": 3, "PowerShell encodé": 3, "Suppression de sauvegardes (rançongiciel)": 4,
               "Vol d'identifiants": 4, "Exécution PowerShell dynamique": 2, "API de téléchargement": 2,
               "Clé de démarrage automatique": 2, "Macro / script auto-exécuté": 2, "Anti-débogage": 1}
    for label, w in weights.items():
        if label in findings:
            score += w; reasons.append(label.lower())
    level = "faible" if score <= 2 else "moyen" if score <= 5 else "élevé"
    return {
        "fichier": str(p), "taille_octets": size, "type_reel": kind, "extension": ext or "(aucune)",
        "md5": hashlib.md5(data).hexdigest(), "sha1": hashlib.sha1(data).hexdigest(), "sha256": hashlib.sha256(data).hexdigest(),
        "entropie": round(ent, 2), "pe": pe, "indicateurs": findings,
        "score_risque": score, "niveau": level, "raisons": reasons,
        "conseil": "Analyse statique uniquement : pour aller plus loin, utilise une VM isolée sans réseau (jamais ton PC principal). "
                   "Tu peux chercher le SHA256 sur VirusTotal depuis un navigateur si tu acceptes de l'envoyer en ligne.",
    }


# ------------------------------------------------------------ analyse de logs
LOG_RULES = [
    (r"Failed password for (?:invalid user )?(\S+) from (\d+\.\d+\.\d+\.\d+)", "ssh_echec"),
    (r"Accepted (?:password|publickey) for (\S+) from (\d+\.\d+\.\d+\.\d+)", "ssh_succes"),
    (r"(?i)\b4625\b|an account failed to log on|échec d'ouverture de session", "windows_echec_connexion"),
    (r"(?i)\b4720\b|a user account was created", "windows_compte_cree"),
    (r"(?i)\b4732\b|added to a security-enabled local group", "windows_ajout_groupe"),
    (r"(?i)\b1102\b|audit log was cleared", "windows_journal_efface"),
    (r"(?i)(union\s+select|or\s+1=1|sleep\(\d+\)|information_schema)", "injection_sql"),
    (r"(?i)(<script|%3cscript|javascript:|onerror=)", "xss"),
    (r"(\.\./|\.\.%2f|%2e%2e/|/etc/passwd|win\.ini)", "traversee_repertoire"),
    (r"(?i)(wp-login\.php|xmlrpc\.php|/\.env|/\.git/|phpmyadmin)", "scan_web"),
    (r"(?i)(nmap|nikto|sqlmap|masscan|zgrab|gobuster|dirbuster)", "outil_de_scan"),
    (r",block,", "pfsense_bloque"),
    (r"(?i)\b(error|erreur|critical|fatal)\b", "erreurs"),
]
SEVERITY = {"windows_journal_efface": "critique", "injection_sql": "élevée", "xss": "élevée", "traversee_repertoire": "élevée",
            "ssh_echec": "moyenne", "windows_echec_connexion": "moyenne", "windows_compte_cree": "moyenne",
            "windows_ajout_groupe": "élevée", "outil_de_scan": "moyenne", "scan_web": "moyenne"}


@registry.register(
    name="analyze_log",
    description="Analyse un fichier de logs (SSH, Windows exporté, serveur web, pfSense) : échecs de connexion, attaques web, "
                "scans, IP les plus actives, comportements suspects.",
    parameters={"properties": {"path": {"type": "string", "description": "Chemin du fichier de log"}}, "required": ["path"]},
    category="cyber",
)
def analyze_log(path: str) -> dict:
    p = safe_path(path, must_exist=True)
    size = p.stat().st_size
    with open(p, "rb") as f:
        if size > 5_000_000:
            f.seek(size - 5_000_000)
        text = f.read().decode("utf-8", "replace")
    lines = text.splitlines()
    counts = collections.Counter()
    ips = collections.Counter()
    users = collections.Counter()
    examples: dict[str, list[str]] = {}
    ip_rx = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
    for line in lines:
        for ip in ip_rx.findall(line):
            ips[ip] += 1
        for rx, label in LOG_RULES:
            m = re.search(rx, line)
            if m:
                counts[label] += 1
                if label == "ssh_echec":
                    users[m.group(1)] += 1
                ex = examples.setdefault(label, [])
                if len(ex) < 3:
                    ex.append(line.strip()[:240])
    alerts = []
    for label, n in counts.items():
        sev = SEVERITY.get(label)
        if sev and (label != "ssh_echec" or n >= 5):
            alerts.append({"type": label, "occurrences": n, "gravite": sev})
    brute = [ip for ip, n in ips.most_common(10) if n >= 20]
    return {
        "fichier": str(p), "lignes_analysees": len(lines), "tronque": size > 5_000_000,
        "detections": dict(counts), "alertes": alerts,
        "ip_les_plus_actives": ips.most_common(10), "comptes_vises_ssh": users.most_common(10),
        "ip_suspectes_volume": brute, "exemples": examples,
    }


# ------------------------------------------------------------ Nmap
NMAP_PROFILES = {
    "decouverte": (["-sn"], "Découverte des appareils actifs (ping), sans scanner les ports."),
    "rapide": (["-F", "-T4"], "Scan des 100 ports les plus courants."),
    "services": (["-sV", "--top-ports", "200", "-T4"], "Détection des services et versions sur 200 ports."),
}


def _nmap_preview(a: dict) -> dict:
    prof = a.get("profile", "rapide")
    try:
        target = check_target(a.get("target", ""))
    except PolicyError as e:
        return {"command": f"nmap {a.get('target')}", "consequences": str(e), "risk": "blocked"}
    args, desc = NMAP_PROFILES.get(prof, NMAP_PROFILES["rapide"])
    return {"command": "nmap " + " ".join(args) + " " + target,
            "consequences": desc + " Génère du trafic réseau visible par la cible (et ton pare-feu). Cible dans ta liste autorisée."}


@registry.register(
    name="nmap_scan",
    description="Scanne un hôte ou réseau AUTORISÉ avec Nmap (profils : decouverte, rapide, services). Jamais d'options offensives.",
    parameters={"properties": {
        "target": {"type": "string", "description": "IP, réseau CIDR ou nom d'hôte autorisé (ex. 192.168.50.0/24)"},
        "profile": {"type": "string", "enum": list(NMAP_PROFILES), "description": "Type de scan"},
    }, "required": ["target"]},
    risk="high",
    category="cyber",
    preview=_nmap_preview,
    available=lambda: bool(which("nmap")),
)
def nmap_scan(target: str, profile: str = "rapide") -> dict:
    target = check_target(target)
    exe = which("nmap")
    if not exe:
        return {"erreur": "Nmap n'est pas installé (https://nmap.org/download)."}
    args, _ = NMAP_PROFILES.get(profile, NMAP_PROFILES["rapide"])
    res = run([exe, *args, "--", target], timeout=600)
    return {"commande": f"nmap {' '.join(args)} {target}", **res}


# ------------------------------------------------------------ YARA / Semgrep / tshark / Docker
@registry.register(
    name="yara_scan",
    description="Analyse un fichier ou dossier avec des règles YARA locales.",
    parameters={"properties": {"rules": {"type": "string", "description": "Fichier de règles .yar"},
                               "target": {"type": "string", "description": "Fichier ou dossier à analyser"}},
                "required": ["rules", "target"]},
    risk="medium",
    category="cyber",
    preview=lambda a: {"command": f"yara -r {a.get('rules')} {a.get('target')}", "consequences": "Lecture seule des fichiers ciblés."},
    available=lambda: bool(which("yara64", "yara")),
)
def yara_scan(rules: str, target: str) -> dict:
    r, t = safe_path(rules, must_exist=True), safe_path(target, must_exist=True)
    exe = which("yara64", "yara")
    if not exe:
        return {"erreur": "YARA n'est pas installé (https://github.com/VirusTotal/yara/releases)."}
    return run([exe, "-r", "-w", str(r), str(t)], timeout=300)


@registry.register(
    name="semgrep_scan",
    description="Analyse de sécurité du code source avec Semgrep (règles locales, ou registre si le mode hors ligne est désactivé).",
    parameters={"properties": {"path": {"type": "string", "description": "Dossier de code"},
                               "config": {"type": "string", "description": "Fichier de règles local, ou p/owasp-top-ten (en ligne)"}},
                "required": ["path"]},
    risk="medium",
    category="cyber",
    preview=lambda a: {"command": f"semgrep scan --config {a.get('config') or 'p/owasp-top-ten'} {a.get('path')}",
                       "consequences": "Lecture seule du code. Les règles du registre sont téléchargées si non locales."},
    available=lambda: bool(which("semgrep")),
)
def semgrep_scan(path: str, config: str = "p/owasp-top-ten") -> dict:
    target = safe_path(path, must_exist=True)
    if config.startswith(("p/", "r/")) or config == "auto":
        if settings.get("offline_mode"):
            return {"erreur": "Mode hors ligne : utilise un fichier de règles local, ou désactive le mode hors ligne."}
        cfg = config
    else:
        cfg = str(safe_path(config, must_exist=True))
    exe = which("semgrep")
    if not exe:
        return {"erreur": "Semgrep n'est pas installé (pip install semgrep)."}
    return run([exe, "scan", "--config", cfg, "--metrics", "off", "--quiet", str(target)], timeout=600)


@registry.register(
    name="pcap_summary",
    description="Résume une capture réseau .pcap/.pcapng avec tshark : conversations IP, protocoles, requêtes DNS.",
    parameters={"properties": {"path": {"type": "string", "description": "Fichier de capture"}}, "required": ["path"]},
    risk="medium",
    category="cyber",
    preview=lambda a: {"command": f"tshark -r {a.get('path')} -q -z conv,ip -z io,phs",
                       "consequences": "Lecture de la capture par tshark (les fichiers piégés peuvent cibler le décodeur : capture d'origine sûre de préférence)."},
    available=lambda: bool(which("tshark")),
)
def pcap_summary(path: str) -> dict:
    p = safe_path(path, must_exist=True)
    exe = which("tshark")
    if not exe:
        return {"erreur": "tshark n'est pas installé (fourni avec Wireshark)."}
    stats = run([exe, "-r", str(p), "-q", "-z", "conv,ip", "-z", "io,phs"], timeout=180)
    dns = run([exe, "-r", str(p), "-Y", "dns.flags.response==0", "-T", "fields", "-e", "dns.qry.name"], timeout=180)
    names = collections.Counter(n for n in dns["stdout"].split() if n)
    return {"statistiques": stats["stdout"], "dns_top": names.most_common(25), "erreurs": stats["stderr"]}


@registry.register(
    name="docker_list",
    description="Liste les conteneurs et images Docker de cette machine (lecture seule).",
    parameters={"properties": {}},
    category="cyber",
    available=lambda: bool(which("docker")),
)
def docker_list() -> dict:
    exe = which("docker")
    if not exe:
        return {"erreur": "Docker n'est pas installé."}
    c = run([exe, "ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"], timeout=30)
    i = run([exe, "images", "--format", "{{.Repository}}:{{.Tag}}\t{{.Size}}"], timeout=30)
    return {"conteneurs": c["stdout"] or c["stderr"], "images": i["stdout"] or i["stderr"]}
