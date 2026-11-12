"""Validación compartida de símbolos de mercado (BASE/COTIZACIÓN).

2026-11-11 nació en app.api.market; 2026-11-12 se mueve aquí porque
app.api.strategy también la necesita y market ya importa de strategy
(_STALE_CANDLES, _as_utc, _timeframe_seconds): si strategy importara
de market sería una importación circular.
"""
import re

from fastapi import HTTPException, status

_SYMBOL_RE = re.compile(r"^[A-Z]{2,12}/[A-Z]{2,12}$")


def validate_symbol(symbol: str) -> str:
    """Normaliza (sin espacios, mayúsculas) y valida el formato del
    símbolo. 422 antes de tocar la BD, el exchange, la caché o el
    limitador, mismo patrón que _validate_exchange. El detalle no
    reproduce el valor completo: un símbolo malicioso puede ser largo.

    NO es una allowlist BTC/ETH: la API es genérica a propósito (los
    tests ingieren ADA/DOGE/SOL y el escáner usa exchanges.SYMBOLS);
    solo se rechaza lo mal formado.
    """
    normalized = symbol.strip().upper()
    if not _SYMBOL_RE.match(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Símbolo no válido: {symbol.strip()[:32]!r}. Usa el formato "
                "BASE/COTIZACIÓN, por ejemplo BTC/USD."
            ),
        )
    return normalized
