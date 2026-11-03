"""Global request timeout (Fase 3, M16): pure-ASGI middleware.

Bounds every HTTP request at REQUEST_TIMEOUT_SECONDS (120s, matching
the frontend IA client timeout). On timeout before the response starts,
the client gets a clean 504 instead of a hung connection; if the
response already started (streaming body), the request is allowed to
finish — a half-sent body cannot be replaced by a 504. Non-HTTP scopes
(lifespan, websockets) pass through untouched.

Deliberately NOT BaseHTTPMiddleware: wait_for() around call_next in a
base middleware can leave half-consumed bodies; the pure-ASGI race
below cancels the inner task cleanly before anything is sent.
"""
import asyncio
import json

REQUEST_TIMEOUT_SECONDS = 120


class RequestTimeoutMiddleware:
    def __init__(self, app, timeout_seconds: int = REQUEST_TIMEOUT_SECONDS):
        self.app = app
        self.timeout = timeout_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = asyncio.Event()

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                started.set()
            await send(message)

        task = asyncio.ensure_future(self.app(scope, receive, send_wrapper))
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=self.timeout)
        except asyncio.TimeoutError:
            if not started.is_set():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                body = json.dumps({"detail": "Request timed out."}).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 504,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send(
                    {"type": "http.response.body", "body": body, "more_body": False}
                )
            else:
                # Response already started: cannot replace it; let the
                # inner task finish sending the body it began.
                await task
