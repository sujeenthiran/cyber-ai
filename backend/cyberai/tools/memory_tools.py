"""Outils mémoire utilisables par l'IA."""
from __future__ import annotations

from ..config import settings
from ..llm import get_provider
from ..memory import store
from .registry import registry


async def embedder(texts: list[str]):
    try:
        return await get_provider().embed(settings.get("embed_model"), texts)
    except Exception:  # noqa: BLE001
        return None


@registry.register(
    name="remember",
    description="Mémorise durablement une information importante sur l'utilisateur : prénom, préférences, projets, matériel, "
                "décisions. Utilise-le dès que l'utilisateur partage une info utile pour plus tard.",
    parameters={"properties": {
        "content": {"type": "string", "description": "Le fait à retenir, en une phrase autonome (ex. « Son homelab utilise pfSense »)"},
        "category": {"type": "string", "enum": store.CATEGORIES, "description": "Catégorie"},
        "importance": {"type": "integer", "description": "1 (anecdotique) à 5 (essentiel)"},
    }, "required": ["content"]},
    category="memoire",
)
async def remember(content: str, category: str = "general", importance: int = 3) -> str:
    m = await store.add_memory(content, category, importance, embedder, settings.get("embed_model"))
    return f"Mémorisé (#{m['id']}, {m['category']})."


@registry.register(
    name="recall",
    description="Cherche dans la mémoire à long terme des informations passées (projets, préférences, conversations importantes).",
    parameters={"properties": {"query": {"type": "string", "description": "Ce que tu cherches"}}, "required": ["query"]},
    category="memoire",
)
async def recall(query: str) -> dict:
    res = await store.search_memories(query, 8, embedder, settings.get("embed_model"))
    return {"souvenirs": [{"id": m["id"], "categorie": m["category"], "contenu": m["content"]} for m in res]} if res else {"souvenirs": [], "info": "Rien trouvé."}
