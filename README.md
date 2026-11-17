<div align="center">

# 🤖 CYBER AI

**Assistant IA de cybersécurité 100 % local, avec un avatar holographique 3D qui t'écoute et te répond à voix haute.**

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-TypeScript-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-3D-000000?logo=threedotjs&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-IA%20locale-000000)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D6?logo=windows&logoColor=white)
![Licence](https://img.shields.io/badge/licence-MIT-green)

<img src="docs/avatar.jpg" width="420" alt="Avatar holographique de CYBER AI">

</div>

---

CYBER AI est une intelligence artificielle personnelle qui tourne **entièrement sur ton PC** :
un visage holographique 3D qui te regarde, t'écoute, te répond à voix haute en bougeant les lèvres,
retient ce que tu lui apprends et agit sur ton ordinateur **uniquement avec ton accord**.

## Installation (Windows 10/11)

1. Installe **Python 3.12** depuis python.org (coche « Add python.exe to PATH »).
2. Décompresse le dossier `cyber-ai` où tu veux, par exemple `C:\CyberAI`.
3. Double-clique sur **`install.bat`**. Il installe les bibliothèques, les voix françaises Piper,
   la reconnaissance vocale Whisper, Ollama et les modèles `qwen3:8b` et `nomic-embed-text`
   (environ 7 Go à télécharger, une seule fois).
4. Lance CYBER AI avec le raccourci **CYBER AI** du bureau (ou `CyberAI.bat`).
   La première fois, autorise le micro dans la fenêtre.

> Carte AMD (RX 6600) : si l'espace *Modèles IA* indique « en partie sur CPU » et que les réponses sont lentes,
> ouvre PowerShell et tape `setx OLLAMA_VULKAN 1`, quitte Ollama (icône près de l'horloge) puis relance CYBER AI.

## Ce que fait la V1

| Module | Fonctionnement | État |
|---|---|---|
| Avatar 3D | Visage holographique procédural (Three.js / React Three Fiber) : clignements naturels, regard qui suit ta souris, micro-saccades, mouvements de tête, 6 expressions, lèvres synchronisées sur l'énergie de la voix, couleurs et animations par état (écoute, réflexion, parole, exécution, attente). | ✅ |
| Cerveau | Ollama (`qwen3:8b` par défaut), réponses en flux, choix du modèle, température, contexte, historique. Moteur alternatif : toute API locale compatible OpenAI (LM Studio, llama.cpp). | ✅ |
| Voix | Écoute : micro + détection de début/fin de phrase + Whisper local (faster-whisper). Parole : Piper en français, phrase par phrase pendant que l'IA écrit. Interruption : parle ou appuie sur Échap. Mode mains libres. Secours : voix Windows. | ✅ |
| Outils | 20 outils : système, réseau, applications, fichiers, commandes, analyses cyber, mémoire. Toute action qui modifie quelque chose affiche **commande, objectif, conséquences, Autoriser/Refuser**. | ✅ |
| Mémoire | SQLite locale : conversations, souvenirs classés (profil, préférences, projets...), recherche plein texte + vectorielle (nomic-embed-text), souvenirs injectés automatiquement. | ✅ |
| Cyber Lab | Analyse statique de fichiers suspects (empreintes, vrai type, entropie, en-tête PE, indicateurs), analyse de logs (SSH, Windows, web, pfSense), Nmap sur cibles autorisées, YARA, Semgrep, tshark, Docker si installés. | ✅ |
| Espaces | Assistant, Cyber Lab, Terminal, Fichiers, Mémoire, Modèles IA, Paramètres. | ✅ |

## Sécurité

- Le serveur écoute uniquement sur `127.0.0.1`, avec un **jeton de session aléatoire** à chaque lancement
  et un contrôle de l'en-tête Host : un site web ouvert dans ton navigateur ne peut pas piloter CYBER AI.
- **Mode hors ligne** activé par défaut : le cerveau doit être local, aucun téléchargement de règles ou de modèles.
- Fichiers : accès limité aux **dossiers autorisés** (par défaut `CyberAI_Workspace`).
- Réseau : scans limités aux **cibles autorisées** (par défaut `127.0.0.1` et `192.168.50.0/24`, à adapter à ton réseau dans *Paramètres*), profils Nmap non offensifs.
- Commandes : validation obligatoire, délai maximum, liste de commandes destructrices **toujours bloquées**
  (formatage, suppression de disque, désactivation de Defender ou du pare-feu, code téléchargé puis exécuté, PowerShell encodé...).
- Le contenu lu dans les fichiers et les logs est traité comme une donnée, jamais comme un ordre (protection contre l'injection de prompt).
- Journal de toutes les actions dans `backend/data/cyberai.db` (visible dans le panneau Activité).

## Architecture

```
cyber-ai/
├─ install.bat / CyberAI.bat        installation et lancement Windows
├─ backend/                          Python (FastAPI)
│  ├─ run.py                         serveur local + fenêtre d'application (Edge en mode app)
│  ├─ cyberai/
│  │  ├─ main.py                     API REST + WebSocket de conversation
│  │  ├─ agent.py                    boucle IA : flux, outils, confirmations, voix
│  │  ├─ persona.py                  personnalité et prompt système
│  │  ├─ security.py                 jeton, dossiers, commandes et cibles autorisés
│  │  ├─ llm/                        moteurs : ollama.py, openai_compat.py
│  │  ├─ tools/                      outils : système, fichiers, cyber, mémoire
│  │  ├─ memory/                     SQLite + recherche vectorielle
│  │  └─ voice/                      Piper (tts.py), Whisper (stt.py)
│  ├─ voices/                        voix Piper (.onnx)
│  └─ tests/                         tests automatiques (pytest)
└─ frontend/                         React + TypeScript + Three.js (déjà compilé dans dist/)
   └─ src/ avatar/ audio/ components/ views/ lib/
```

Chaque module est indépendant : on peut changer de moteur IA, de voix ou ajouter un outil
(un simple décorateur `@registry.register` dans `backend/cyberai/tools/`) sans toucher au reste.

## Modifier l'interface

```
cd frontend
npm install
npm run dev        # http://localhost:5173 (lance aussi : python backend/run.py --no-window)
npm run build      # régénère frontend/dist
```

## Feuille de route

- **V2** : application desktop empaquetée (Tauri), avatar VRM chargeable (visage réaliste au choix),
  visèmes précis via les phonèmes Piper, mot d'éveil « CYBER », reconnaissance vocale en continu.
- **V3** : laboratoire isolé (VM ou conteneur sans réseau) pour l'analyse dynamique de fichiers suspects,
  connecteurs homelab (pfSense, Wazuh, Uptime Kuma), rapports d'audit PDF.
