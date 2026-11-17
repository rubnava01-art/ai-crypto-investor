"""Validación compartida de timeframes de velas ('1m', '15m', '1h', '4h', '1d', '1w').

2026-11-14: cierra el backlog que dejó la diaria del 2026-11-13. El
símbolo ya se valida en todos los endpoints (2026-11-11/12/13), pero el
`timeframe` seguía libre: "??" caía a 1h por defecto en el guarda de
antigüedad mientras la consulta a la BD (filtro exacto) no encontraba
nada y devolvía 503, "1H" no encontraba las velas guardadas como "1h",
y el valor crudo llegaba al run_id de backtest (nombre de archivo) y a
/ingest, donde el exchange recibía un timeframe inválido.

Como validate_symbol (app/core/symbols.py): solo formato, no allowlist
de pares — la API es genérica a propósito y el escáner solo ingiere 1h,
así que un timeframe válido pero sin datos sigue siendo 503 ("No candle
data"), no 422. La normalización (sin espacios, minúsculas) va antes de
la BD, el exchange, la caché y el limitador.
"""
import re

from fastapi import HTTPException, status

_TIMEFRAME_RE = re.compile(r"^(\d+)([mhdw])$")
_TIMEFRAME_SECONDS = {"m": 60, "h": 3600, "d": 86400, "w": 604800}


def validate_timeframe(timeframe: str) -> str:
    """Normaliza (sin espacios, minúsculas) y valida el formato del
    timeframe. 422 antes de tocar la BD, el exchange o el limitador,
    mismo patrón que validate_symbol. El detalle no reproduce el valor
    completo: un timeframe malicioso puede ser largo.
    """
    normalized = timeframe.strip().lower()
    m = _TIMEFRAME_RE.match(normalized)
    # 2026-11-16: una vela de 0 segundos no existe: "0m"/"00h" pasaban
    # el formato y luego /candles devolvía 503 ("No candle data") e
    # /ingest mandaba el timeframe inválido al exchange, en vez de 422.
    if not m or int(m.group(1)) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Timeframe no válido: {timeframe.strip()[:32]!r}. Usa el "
                "formato <número><m|h|d|w> con número mayor que 0, por "
                "ejemplo 15m, 1h, 4h, 1d."
            ),
        )
    return normalized


def timeframe_seconds(timeframe: str) -> int:
    """Segundos de una vela ('15m', '1h', '4h', '1d'...). Formato
    desconocido -> 1h: nunca bloquear la evaluación por no entender
    el timeframe, el guarda de antigüedad sigue aplicando con 2h.
    Solo se llama con timeframes ya validados; el fallback queda por
    compatibilidad con el uso interno histórico."""
    m = _TIMEFRAME_RE.match(timeframe.strip().lower())
    if not m:
        return 3600
    return int(m.group(1)) * _TIMEFRAME_SECONDS[m.group(2)]
