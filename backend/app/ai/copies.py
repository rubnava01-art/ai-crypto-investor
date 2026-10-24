"""Copy generation for the Crear module (Plataforma Unificada — Fase 3).

Reuses the platform's existing AI layer (app.ai.models.get_model): the
same provider selection (stub by default, openai-compatible / anthropic
via env) that powers /api/ai/ask. No second provider, no new keys.

Honesty contract: when the provider is the local stub (not configured),
the result is flagged demo=True and the UI must say so — a demo stub
response is never presented as real AI copywriting.
"""
from app.ai.models import AIModelError, get_model  # noqa: F401  (AIModelError re-exported for the API layer)

COPY_SYSTEM = (
    "Eres un redactor de copies para redes sociales en español. Escribes "
    "textos cortos, claros y honestos: sin promesas falsas de ingresos, "
    "sin testimonios inventados y sin exageraciones. Adaptas el texto a "
    "la plataforma indicada (Instagram, Threads o Facebook) y al tono "
    "pedido. Respondes SOLO con el texto del copy, sin explicaciones."
)

_PLATFORM_HINTS = {
    "instagram": "Instagram: gancho fuerte en la primera línea, máx. ~200 palabras, 0-2 hashtags.",
    "threads": "Threads: conversacional y breve, máx. 500 caracteres, 0-1 hashtag.",
    "facebook": "Facebook: cercano y claro, puede ser un poco más largo, sin hashtags excesivos.",
}


def generate_copy(topic: str, platform: str, tone: str) -> dict:
    """Generate one copy via the shared AI model. Returns
    {text, demo, provider}. Raises AIModelError on provider failure."""
    model = get_model()
    hint = _PLATFORM_HINTS.get(platform, "")
    prompt = "\n".join(
        [
            f"PREGUNTA: Escribe un copy para {platform} sobre «{topic}» con tono {tone}.",
            f"TEMA: {topic}",
            f"PLATAFORMA: {platform}. {hint}",
            f"TONO: {tone}",
            "Devuelve únicamente el texto del copy, en español.",
        ]
    )
    text = model.complete(COPY_SYSTEM, prompt)
    return {"text": text.strip(), "demo": not model.configured, "provider": model.name}
