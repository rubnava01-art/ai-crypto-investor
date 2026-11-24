# Reporte diario (definición PREPARADA, no creada)

- Fecha: 2026-11-23 (corrida "mejoras óptimas", Fase 5, mega-prompt
  Fase 5).
- Estado: **definición del contenido del reporte. No se ha creado
  ningún cron ni ningún envío.** Crear el cron exige la palabra
  explícita de Rubén (runbook: sin modificar crons sin su orden).

## Qué es

Un resumen diario de la plataforma y de Hunter Bit, generado una
vez al día a partir de datos REALES (nunca inventados): si un dato
no existe, el reporte lo dice ("sin datos") en vez de estimarlo.

## Contenido

1. **BTC**: precio actual, variación 24 h, último cierre guardado
   en velas y frescura (`stale` / última ingesta real de
   `/api/system/status`).
2. **Recompensas descubiertas (modo manual)**: novedades de Hunter
   Bit del día — programas, enlaces de referido y estado — con el
   recordatorio de que el reclamo es MANUAL (modo C elegido por
   Rubén 2026-11-23): el reporte nunca reclama nada automáticamente
   (0/12 fuentes lo permiten) y nunca promete sats.
3. **Gastos**: gastos del día registrados en la plataforma
   (facturas/compras reales; si no hay, "sin gastos registrados").
4. **Rentabilidad neta**: resultado paper/simulación del día
   (órdenes paper, P&L realizado) con la etiqueta de simulación;
   el trading real sigue apagado y fuera del reporte.
5. **Rendimiento del agente**: qué hizo el agente de mejora ese
   día (si corrió el cron diario: mejoras aplicadas, tests, build).
6. **Errores / alertas**: errores del día (logs, `SystemEvent`
   level error, fallos de ingesta) y su estado.
7. **Recomendaciones 24 h**: próximos pasos concretos para las
   próximas 24 horas, derivados de lo anterior (sin inventar
   urgencias).

## Formato y canal

- Por definir con Rubén: mismo canal que el reporte nocturno de la
  misión $1,000 (chat) o correo. Sin PII de otros usuarios en el
  reporte: solo agregados y datos del dueño.
- El reporte no publica nada en Inicio: las novedades de Inicio
  siguen el flujo del "publicador del sistema automático" (solo
  avances reales aprobados).

## Qué NO hace

- No reclama recompensas automáticamente (prohibido).
- No ejecuta trading real (intocable).
- No inventa métricas, testimonios ni resultados.
- No crea el cron por sí mismo: esta definición es el paso previo
  a la decisión de Rubén (crear el cron diario o no).
