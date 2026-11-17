"""Registre des outils : schéma pour le modèle, niveau de risque, aperçu pour confirmation."""
from __future__ import annotations

import asyncio
import inspect
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

RISK_LABELS = {"safe": "Lecture seule", "medium": "Modification", "high": "Sensible"}


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    func: Callable[..., Any]
    risk: str = "safe"                     # safe = automatique ; medium/high = confirmation obligatoire
    category: str = "systeme"
    preview: Optional[Callable[[dict], dict]] = None   # -> {"command": str, "consequences": str, "risk": str?}
    available: Callable[[], bool] = field(default=lambda: True)

    def schema(self) -> dict:
        params = {
            "type": "object",
            "properties": dict(self.parameters.get("properties", {})),
            "required": list(self.parameters.get("required", [])),
        }
        if self.risk != "safe":
            params["properties"]["objectif"] = {
                "type": "string",
                "description": "Explique en une phrase pourquoi tu fais cette action (montré à l'utilisateur).",
            }
            if "objectif" not in params["required"]:
                params["required"].append("objectif")
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": params}}

    def describe(self, args: dict) -> dict:
        info = {"command": f"{self.name}({', '.join(f'{k}={v!r}' for k, v in args.items() if k != 'objectif')})",
                "consequences": "", "risk": self.risk}
        if self.preview:
            info.update(self.preview(args))
        return info

    async def run(self, args: dict) -> Any:
        clean = {k: v for k, v in args.items() if k != "objectif"}
        allowed = set(inspect.signature(self.func).parameters)
        clean = {k: v for k, v in clean.items() if k in allowed}
        if inspect.iscoroutinefunction(self.func):
            return await self.func(**clean)
        return await asyncio.to_thread(self.func, **clean)


class Registry:
    def __init__(self):
        self.tools: dict[str, Tool] = {}

    def register(self, **kw) -> Callable:
        def deco(fn):
            t = Tool(func=fn, **kw)
            self.tools[t.name] = t
            return fn
        return deco

    def get(self, name: str) -> Tool | None:
        return self.tools.get(name)

    def schemas(self) -> list[dict]:
        return [t.schema() for t in self.tools.values() if t.available()]

    def catalog(self) -> list[dict]:
        return [
            {"name": t.name, "description": t.description, "risk": t.risk, "category": t.category, "available": t.available()}
            for t in self.tools.values()
        ]


registry = Registry()
