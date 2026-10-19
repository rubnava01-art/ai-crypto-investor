"""Swappable AI model interface.

- Default: StubModel (local, deterministic, no network) — used when no
  provider is configured. Answers are clearly labeled DEMO.
- Real providers, configured ONLY via environment variables
  (AI_PROVIDER, AI_API_URL, AI_API_KEY, AI_MODEL):
  - "anthropic": Anthropic Messages API (x-api-key header).
  - "openai"/"openai-compatible": /chat/completions endpoint.
  Keys never appear in the frontend, logs, repo or images.

The model only rephrases/summarizes technical data the assistant gathers
with read-only tools. It never decides trades and never sees secrets.
"""
import httpx

from app.config import settings


class AIModelError(Exception):
    """Raised when the configured model cannot produce an answer."""


class AIModel:
    """Interface every model backend must implement."""

    name: str = "base"
    configured: bool = False

    def complete(self, system: str, prompt: str) -> str:
        raise NotImplementedError


class StubModel(AIModel):
    """Local deterministic model. Parses the structured DATOS block the
    assistant builds and returns a Spanish technical brief. No network."""

    name = "stub"
    configured = False

    def complete(self, system: str, prompt: str) -> str:  # noqa: ARG002
        import re

        lines = []
        # Extract the structured sections the assistant always includes.
        m = re.search(r"PREGUNTA:\s*(.+)", prompt)
        question = m.group(1).strip() if m else ""
        signals = re.findall(r"^SEÑAL:\s*(.+)$", prompt, re.MULTILINE)
        indicators = re.findall(r"^INDICADORES\s+(\S+):\s*(.+)$", prompt, re.MULTILINE)
        backtest = re.search(r"^BACKTEST:\s*(.+)$", prompt, re.MULTILINE)
        risk = re.search(r"^RIESGO:\s*(.+)$", prompt, re.MULTILINE)

        lines.append("Análisis técnico (modelo local, DEMO):")
        if indicators:
            for symbol, summary in indicators:
                lines.append(f"- {symbol}: {summary.strip()}")
        else:
            lines.append("- Sin datos de indicadores disponibles ahora mismo.")
        if signals:
            lines.append("Señales recientes:")
            for s in signals[:5]:
                lines.append(f"  · {s.strip()}")
        if backtest:
            lines.append(f"Backtest: {backtest.group(1).strip()}")
        if risk:
            lines.append(f"Estado de riesgo: {risk.group(1).strip()}")
        lines.append(
            "Recuerda: esto es una explicación técnica, no una recomendación "
            "de inversión. Un buen backtest no prueba rentabilidad futura y "
            "puedes perder todo el capital."
        )
        if question:
            lines.append(f"Pregunta recibida: «{question[:160]}»")
        return "\n".join(lines)


class OpenAICompatibleModel(AIModel):
    """Real provider via OpenAI-compatible /chat/completions endpoint."""

    name = "openai-compatible"
    configured = True

    def __init__(self, api_url: str, api_key: str, model: str):
        self.api_url = api_url.rstrip("/")
        self._api_key = api_key  # never logged
        self._model = model

    def complete(self, system: str, prompt: str) -> str:
        # Single request. The key travels only in the Authorization header;
        # it is never written to logs, DB, repo or error messages.
        try:
            resp = httpx.post(
                f"{self.api_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.2,
                    "max_tokens": 800,
                },
                timeout=30.0,
            )
        except Exception as e:  # noqa: BLE001
            raise AIModelError(f"model request failed: {type(e).__name__}") from e
        if resp.status_code != 200:
            raise AIModelError(f"model returned HTTP {resp.status_code}")
        try:
            return resp.json()["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, ValueError) as e:
            raise AIModelError("model returned an unexpected payload") from e


class AnthropicModel(AIModel):
    """Real provider via Anthropic's Messages API.

    Key travels only in the x-api-key header; never logged/stored.
    """

    name = "anthropic"
    configured = True

    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def complete(self, system: str, prompt: str) -> str:
        try:
            resp = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self._model,
                    "max_tokens": 800,
                    "temperature": 0.2,
                    "system": system,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=30.0,
            )
        except Exception as e:  # noqa: BLE001
            raise AIModelError(f"model request failed: {type(e).__name__}") from e
        if resp.status_code != 200:
            raise AIModelError(f"model returned HTTP {resp.status_code}")
        try:
            blocks = resp.json()["content"]
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
            return text.strip()
        except (KeyError, IndexError, ValueError, AttributeError) as e:
            raise AIModelError("model returned an unexpected payload") from e


def get_model() -> AIModel:
    """Select the model from env. Anything unconfigured/misconfigured falls
    back to the local stub (safe default)."""
    provider = (settings.ai_provider or "stub").strip().lower()
    if provider == "anthropic" and settings.ai_api_key and settings.ai_model:
        return AnthropicModel(settings.ai_api_key, settings.ai_model)
    if provider in ("openai-compatible", "openai") and settings.ai_api_url and settings.ai_api_key and settings.ai_model:
        return OpenAICompatibleModel(settings.ai_api_url, settings.ai_api_key, settings.ai_model)
    return StubModel()
