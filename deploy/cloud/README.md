# Cloud deploy with HTTPS (Phase 7)

> **Never deploy without the user's explicit go-ahead.** This is config only.

## Target
Any single VM with Docker (Hetzner, DigitalOcean, etc.).

## Run
```
docker compose -f docker-compose.yml -f deploy/cloud/docker-compose.prod.yml up -d --build
```
The prod overlay adds: **Caddy** (automatic HTTPS via Let's Encrypt),
**Postgres 16**, **Redis**. Backend runs `alembic upgrade head` on container
start (see backend Dockerfile CMD) before uvicorn binds.

## Checklist
1. Point DNS: `A` record for `${DOMAIN}` → server IP.
2. On the server, create `.env` from `.env.example`:
   - strong `JWT_SECRET` (64+ random chars), `ADMIN_PASSWORD`
   - `DOMAIN=trading.example.com`
   - `POSTGRES_USER/PASSWORD/DB`, `REDIS_PASSWORD`
   - `DATABASE_URL=postgresql+psycopg2://...`
   - optional: `ALERT_SMTP_*` for email alerts, `KRAKEN_API_KEY/SECRET` (read-only)
3. Verify: `curl -I https://${DOMAIN}/api/health` → HTTP 200.
4. Caddy obtains/renews the Let's Encrypt certificate automatically.

## Security posture
- HTTPS enforced by Caddy (HSTS header also sent by the app).
- Security headers middleware: nosniff, DENY framing, no-referrer, HSTS.
- Login rate-limited (10/min per IP).
- Kill switch / mode changes / scanner toggles → AuditLogs + email alert.
- Exchange keys: env only, read-only permission, IP whitelist, never in DB/logs.
- Real trading: hard-disabled in code (`real_trading_enabled=False`, `/orders`
  rejects `mode=real` with 403, `/simulation/mode` rejects `"real"` with 403).

## Key rotation procedure
1. Revoke the key **at the exchange** first (Kraken: Settings → API → delete).
2. Generate a new read-only key (no withdrawal, IP-whitelisted).
3. Update the server `.env` / secrets manager and restart the backend container.
4. Inspect AuditLogs around the incident window for config changes.
