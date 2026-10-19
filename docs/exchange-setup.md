# Exchange connection guide (read-only, Phase 5)

## Principle
The platform NEVER asks for your exchange password. API keys are read-only,
have no withdrawal permission, and can be IP-restricted at the exchange once
the app runs on a fixed-IP server. Keys
live in environment variables (or a secrets manager) — never in the database,
logs, git, or Docker images.

## Kraken (supported first)
1. Log in to Kraken → Settings → API → **Generate new key**.
   (Kraken's own guide: http://docs.kraken.com/exchange/guides/rest/api-keys)
2. Key description: `ai-crypto-investor-readonly`.
3. Permissions — check ONLY the read-only set (Kraken's documented
   "Read-only monitoring dashboard" set):
   - **Query Funds** (balances)
   - **Query Open Orders & Trades** (open order status)
   - **Query Closed Orders & Trades** (trade history)

   Leave **all** other boxes **unchecked**, especially anything under
   Funds withdrawal, Deposits, and Orders & Trades creation/modification/
   cancellation — those would let the key move money or trade.
4. IP whitelist: optional. Leave it **blank** while the app runs in
   development/testing (a wrong or changing IP would block the connection).
   Set it to the server's public IP only once the app moves to a fixed-IP
   cloud server.
5. Copy the **API key** and **Private key** into your `.env`:
   ```
   KRAKEN_API_KEY=...
   KRAKEN_API_SECRET=...
   ```
6. Verify: `GET /api/exchange/status` → `configured: true`;
   `GET /api/exchange/balances` shows your balances (read-only).

## Coinbase Advanced (planned next)
Same pattern: API key with **View** permission only, IP whitelist, no trade
or transfer permissions. Set `COINBASE_API_KEY` / `COINBASE_API_SECRET`.

## Key rotation / incident response
1. If a key may be exposed: revoke it **at the exchange first**
   (Kraken: Settings → API → delete key; Coinbase: API settings → delete).
2. Generate a new read-only key and update the env / secrets manager.
3. Restart the backend. No code or DB changes are needed (keys are never stored).
4. Check `AuditLogs` for any config changes around the incident window.
5. Because keys never had withdrawal permission, funds cannot leave the
   exchange via a leaked key — but rotate anyway, immediately.
