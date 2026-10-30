"""In-memory sliding-window rate limiter (single worker, Phase 1 assumption)."""
import time
from collections import defaultdict, deque


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


login_limiter = RateLimiter(max_requests=10, window_seconds=60)

# Trabajo pesado por usuario (corrida 3 agentes): backtest y auditoría web
# eran ilimitados y accesibles al rol prueba; un bucle bastaba para agotar
# el pool de hilos del tier gratuito. Límites generosos para no romper el
# uso normal; la suite los verifica.
backtest_limiter = RateLimiter(max_requests=30, window_seconds=60)
auditor_limiter = RateLimiter(max_requests=60, window_seconds=60)
