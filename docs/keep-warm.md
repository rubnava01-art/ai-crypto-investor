# Keep-warm (definición PREPARADA, no creada)

- Fecha: 2026-11-23 (corrida "mejoras óptimas", Fase 5).
- Estado: **definición lista para que Rubén decida. No se ha creado
  ningún cron ni ninguna GitHub Action.** Crear el cron exige su
  palabra explícita (runbook: "No modificar ningún cron… salvo orden
  explícita de Rubén").

## Problema

En el tier gratuito de Render, API y web se duermen tras la
inactividad: el cold start observado es ~26 s (web) / ~53 s (API).
Cada despliegue, además, vuelve a pagar migración + seed antes de
servir la primera petición.

## Qué pinear

- `GET https://crypto-investor-api.onrender.com/api/health`
  (público, sin auth; responde versión + `git_sha` + estado de BD).
- `GET https://crypto-investor-web.onrender.com/` (la web).

## Cadencia propuesta

Cada **10–14 minutos** (no cada minuto: basta con no dejar que el
servicio se duerma; un ping más frecuente no lo despierta más
rápido y solo gasta cómputo).

## Opciones gratuitas (sin pagar nada)

1. **cron-job.org** (recomendado por simpleza): cuenta gratuita,
   crear dos jobs con las URLs de arriba, intervalo 10–14 min.
2. **GitHub Actions `schedule`**: workflow con `cron: "*/12 * * * *"`
   que haga `curl` a ambas URLs. Vive en el repo, sin servicios
   externos, pero exige un commit con el workflow.
3. **El cron diario existente** ampliado (no recomendado: su cadencia
   es diaria, no sirve para mantener despierto un servicio).

## Advertencias honestas

- El ping **mantiene despierto** un servicio free mientras el ping
  llega, pero **no convierte el tier en pago**: Render puede dormir
  el servicio igualmente tras inactividad prolongada según su
  política, y el free tier tiene 750 h/mes por workspace (un solo
  servicio despierto 24/7, no dos).
- Cada ping a `/api/health` ejecuta un `SELECT 1` en Neon: barato,
  pero no gratis en cómputo.
- El ping no sustituye al plan pago (~$7/mes): si Rubén quiere
  disponibilidad real sin depender de un ping externo, la opción es
  el plan pago. Esa es una decisión de gasto suya, no de este lote.
- El keep-warm no arregla el cold start del primer despliegue
  (migración + seed): solo evita el sueño por inactividad.

## Verificación (cuando se cree)

- Tras 1 hora con el cron activo: `GET /api/health` responde en
  < 2 s en frío aparente (sin esperar el cold start).
- Si `/api/health` tarda > 20 s, el ping no está llegando (revisar
  el job, no el código).
