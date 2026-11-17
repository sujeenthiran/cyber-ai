"""Fournisseurs de modèles locaux (Ollama, API compatible OpenAI)."""
from ..config import settings
from .base import LLMError, Provider
from .ollama import OllamaProvider
from .openai_compat import OpenAICompatProvider


def get_provider() -> Provider:
    if settings.get("provider") == "openai":
        return OpenAICompatProvider(settings.get("openai_url"))
    return OllamaProvider(settings.get("ollama_url"))


__all__ = ["get_provider", "Provider", "LLMError"]
