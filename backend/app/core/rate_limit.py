"""In-memory sliding-window rate limiter (single worker, Phase 1 assumption).

Fase 2 (M3): heavy endpoints that were unlimited are now limited PER
USER (not per IP): strategy evaluation, tendencias research and the
market endpoints. Per-user keys survive NAT/proxy sharing and cannot be
dodged by rotating IPs.

Real IP behind the Render proxy — DOCUMENTED LIMITATION, not silently
"fixed": this service never trusts X-Forwarded-For (any client can
forge it, which would let an attacker both evade IP limits and get
other users' IPs blocked). Behind Render, request.client.host may
collapse to a shared proxy IP, so the IP-based login/register/challenge
limiters are only a second layer: the real gates are the per-user
limiters here and the per-account login lockout below. Trusting the
proxy header would require an allow-list of Render's egress IPs in
front of the app (uvicorn --proxy-headers with trusted hosts), which
is a deployment change, not a code guess.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status


def too_many_requests(detail: str, retry_after_s: int = 60) -> HTTPException:
    """429 con cabecera Retry-After (M-1, corrida 2026-11-14).

    El cliente necesita saber cuánto esperar antes de reintentar; un
    429 sin la cabecera no dice si son segundos o minutos.
    `retry_after_s` es la ventana del limiter que dispara el 429
    (60 s en todos los limiters por usuario; el lockout de login,
    300 s, ya lleva su propia cabecera y no usa este helper).
    """
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(retry_after_s)},
    )


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max_requests:
            return False
        q.append(now)
        return True

    def clear(self) -> None:
        """Vaciar todos los contadores (solo para tests: la suite comparte
        un único proceso y un test de ráfaga no debe bloquear los demás)."""
        self._hits.clear()


login_limiter = RateLimiter(max_requests=10, window_seconds=60)

# Fase 1 mejoras-v1, tarea 2: el registro tenía el mismo presupuesto
# que el login (10/min por IP compartido): una ráfaga de logins
# bloqueaba registrarse y viceversa. Presupuesto propio, mismo tope
# (10/min por IP): separarlo es la mejora — un tope menor (5/min)
# rompía la ráfaga legítima de registro de la suite. El reenvío de
# verificación también va aparte (5/min).
register_limiter = RateLimiter(max_requests=10, window_seconds=60)
resend_limiter = RateLimiter(max_requests=5, window_seconds=60)

# Perfil invitado (corrida 2026-11-23, mejoras óptimas, Fase 1):
# limiters propios por IP — un invitado no tiene user.id, así que la
# clave es la IP (con la limitación documentada arriba: tras el proxy
# de Render la IP puede colapsar; por eso los umbrales son bajos y el
# invitado solo llega a lecturas públicas + chat de solo lectura).
# Emisión de token 3/min, chat 5/min, resto de lecturas 30/min.
guest_issue_limiter = RateLimiter(max_requests=3, window_seconds=60)
guest_chat_limiter = RateLimiter(max_requests=5, window_seconds=60)
guest_read_limiter = RateLimiter(max_requests=30, window_seconds=60)

# Mercado público (corrección P0-1, 2026-11-23): /api/public/market/*
# sirve solo datos públicos de mercado a cualquier principal
# autenticado (incluido invitado). Límite propio por IP, 30/min,
# separado del de lecturas de invitado para no mezclar presupuestos.
public_market_limiter = RateLimiter(max_requests=30, window_seconds=60)

# Trabajo pesado por usuario (corrida 3 agentes): backtest y auditoría web
# eran ilimitados y accesibles al rol prueba; un bucle bastaba para agotar
# el pool de hilos del tier gratuito. Límites generosos para no romper el
# uso normal; la suite los verifica.
backtest_limiter = RateLimiter(max_requests=30, window_seconds=60)
auditor_limiter = RateLimiter(max_requests=60, window_seconds=60)

# Fase 2 (M3): endpoints pesados sin límite, ahora por USUARIO. Generosos
# (60/min) porque el uso normal es de un solo dueño; el objetivo es
# frenar bucles, no al usuario.
strategy_limiter = RateLimiter(max_requests=60, window_seconds=60)
tendencias_limiter = RateLimiter(max_requests=60, window_seconds=60)
market_limiter = RateLimiter(max_requests=60, window_seconds=60)

# Corrida 2026-11-10 (M-1, Agente 3): Correos no tenía límite ni en
# escrituras ni en lecturas; un bucle con cuerpos de 20 KB llenaba la
# BD sin freno. 30/min por usuario, como backtest (generoso para el uso
# normal de un solo dueño).
correos_limiter = RateLimiter(max_requests=30, window_seconds=60)

# Servicios + Calculadora (2026-11-25): formulario público de /contacto.
# Sin auth, así que el límite es por IP (misma limitación documentada
# arriba sobre el proxy de Render: segunda capa, umbral bajo). 5/hora:
# un humano real rara vez escribe dos veces en una hora; un bot que
# rellena el formulario se frena sin bloquear al dueño.
contacto_limiter = RateLimiter(max_requests=5, window_seconds=3600)


class LoginLockout:
    """Per-account backoff after failed logins (M3).

    After MAX_FAILURES consecutive failures inside WINDOW_SECONDS, the
    account is locked for LOCKOUT_SECONDS. A success resets the
    counter. Threshold 10 (not 3-5): with 4-char minimum passwords the
    IP limiter (10/min) already throttles distributed guessing, and a
    lower threshold would lock the owner out on ordinary typos.
    """

    MAX_FAILURES = 10
    WINDOW_SECONDS = 15 * 60
    LOCKOUT_SECONDS = 5 * 60

    def __init__(self) -> None:
        self._failures: dict[str, list[float]] = defaultdict(list)
        self._locked_until: dict[str, float] = {}

    def clear(self) -> None:
        self._failures.clear()
        self._locked_until.clear()

    def locked(self, username: str) -> bool:
        until = self._locked_until.get(username)
        if until is None:
            return False
        if time.monotonic() >= until:
            del self._locked_until[username]
            self._failures.pop(username, None)
            return False
        return True

    def record_failure(self, username: str) -> None:
        now = time.monotonic()
        hits = [t for t in self._failures[username] if now - t <= self.WINDOW_SECONDS]
        hits.append(now)
        self._failures[username] = hits
        if len(hits) >= self.MAX_FAILURES:
            self._locked_until[username] = now + self.LOCKOUT_SECONDS

    def record_success(self, username: str) -> None:
        self._failures.pop(username, None)
        self._locked_until.pop(username, None)


login_lockout = LoginLockout()
