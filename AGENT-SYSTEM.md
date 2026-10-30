# Sistema de 3 agentes — Plataforma unificada (crypto investor)

Manual del equipo autónomo que Rubén ordenó montar el 2026-10-29.
El sistema audita, planifica, implementa mejoras reales y valida, sin
publicar nada sin su palabra.

## Roles

- **Agente 1 — UI/UX & Frontend.** Alcance: solo `frontend/`. Audita
  páginas/componentes, responsive, jerarquías, estados de carga/error/
  confirmación, accesibilidad, duplicados visuales. No cambia
  funcionalidades sin justificación ni elimina componentes con
  dependencias.
- **Agente 2 — Performance & Backend.** Alcance: solo `backend/` (y
  config de build si hace falta). Audita arquitectura, endpoints,
  consultas, caché apropiado, peso JS/CSS, errores/logs, auth/sesiones,
  seguridad de APIs y validación. Nunca compromete seguridad por
  velocidad.
- **Agente 3 — QA, Seguridad & Calidad.** INDEPENDIENTE. No edita
  archivos de implementación directamente: audita estructura, calidad,
  auth/autorización, vulnerabilidades comunes, validación,
  compatibilidad front/back, duplicados y regresión. Entrega hallazgos;
  el coordinador los deriva al agente dueño para corrección y luego
  revalida. Nunca afirma que una prueba pasó si no se ejecutó; nunca
  oculta errores.
- **Coordinador.** Despliega como máximo 3 subagentes (uno por rol),
  evita conflictos de archivos, resuelve el plan conjunto, ejecuta o
  supervisa la ejecución, valida el diff, escribe el informe y hace el
  commit local. Si el despliegue de subagentes falla, el coordinador
  asume la ejecución directamente y lo declara en el informe (así pasó
  en la corrida 2026-10-29: la validación QA independiente no fue
  posible y la hizo el propio coordinador).

## Fases

1. **Auditoría.** Cada agente audita su dominio (solo lectura) y
   escribe su diagnóstico: problema, gravedad, archivos, mejora,
   prioridad.
2. **Plan.** Plan conjunto clasificado CRÍTICA (seguridad o roto) /
   ALTA (rendimiento o experiencia) / MEDIA (diseño, optimización) /
   BAJA (secundario). El plan separa qué se ejecuta, qué queda en
   backlog y qué necesita decisión de Rubén.
3. **Ejecución.** Mejoras reales, pequeñas, controladas y
   verificables. Estabilidad sobre cantidad.
4. **Testing.** Suite backend + build frontend en verde; si algo
   falla, se corrige antes de seguir.
5. **Optimización final.** Corregir lo que salga del testing y repetir
   las pruebas necesarias.
6. **Reporte final.** Mejoras implementadas, archivos modificados,
   problemas corregidos, rendimiento medido antes/después (SOLO
   mediciones reales: tiempos de tests, tamaño de build, nº de rutas,
   tiempos de endpoint medidos en local; nunca cifras inventadas),
   cambios visuales, resultados de pruebas, problemas pendientes,
   recomendaciones futuras y decisiones que necesitan a Rubén.

## Reglas duras (intocables en toda corrida)

- **Trading real (Fase 8 Kraken, tope $20, kill switch, risk guard)
  INTOCABLE:** no modificar lógica de ejecución real ni quitar
  etiquetas de simulación/demo en ningún sitio.
- **Nada de contenido inventado:** las listas (posts, inventario,
  clases) empiezan vacías; no inventar datos, métricas ni testimonios.
- **Esquema de base de datos:** evitar cambios; si uno es
  imprescindible, evaluar dependencias primero (tablas nuevas se crean
  solas al arrancar; columnas nuevas EXIGEN migración Alembic + test).
- **Sin dependencias pesadas nuevas sin justificación.**
- **Backup PRIMERO:** antes de cambiar código, crear
  `~/workspace/ai-crypto-investor-backup-YYYY-MM-DD-agentes.tar.gz`
  (excluye `.venv`, `node_modules`, `.git`, `dist`, `tsbuildinfo`).
- **Local siempre:** al final, commit LOCAL con mensaje descriptivo.
  NO push, NO deploy. Publicar solo con el "Publica" de Rubén.
- **No exponer credenciales ni keys** en informes ni chats. No tocar
  datos reales de usuarios. No cambiar de frameworks, no reconstruir
  desde cero, no eliminar funcionalidades.
- **No modificar ningún cron** dentro de una corrida, salvo orden
  explícita de Rubén.

## Verificación local

```bash
cd backend && .venv/bin/python -m pytest tests -q
cd frontend && npm run build
```

Nunca pushear `frontend/tsconfig.tsbuildinfo` (archivo generado, no
rastreado). Los tests nuevos de una corrida van en
`backend/tests/test_agentes_YYYY_MM_DD.py`, usan solo los fixtures
compartidos (`client`, `admin_headers`, `viewer_headers`) y limpian
todo lo que crean, porque la suite comparte una sola BD de pruebas y
un límite de login de 10/min por IP.

## Registros de cada corrida

Todo queda en
`~/workspace/goals/ai-crypto-investor-platform/hidden_files/agents-YYYY-MM-DD/`:

- `audit-agente-1.md`, `audit-agente-2.md`, `audit-agente-3.md`
  (diagnósticos de la fase 1).
- `plan.md` (plan conjunto: qué se ejecuta, backlog, decisiones para
  Rubén).
- `informe.md` (informe detallado de la corrida: qué se implementó,
  archivos, mediciones reales, pendientes, decisiones).
- Si la ejecución la hacen subagentes: `ejecucion-agente-N.md` por rol.
  Si la hace el coordinador, el informe lo cubre y lo declara.

## Cómo volver a correr el sistema

1. Crear el directorio de la corrida en `hidden_files/agents-YYYY-MM-DD/`.
2. Hacer el backup antes de tocar código.
3. Desplegar los 3 agentes de auditoría (uno por rol, en paralelo).
4. Escribir `plan.md` con el plan conjunto.
5. Ejecutar: cada agente en su alcance; el Agente 3 valida y el
   coordinador deriva correcciones al dueño.
6. Suite + build en verde, revisión del diff (sin trading, sin
   etiquetas de simulación quitadas, sin secretos, sin esquema).
7. Escribir `informe.md`, commit local único, informe final al
   agente principal.

## Opción documentada (NO ejecutada)

Conectar este sistema al cron diario de mejora existente
(`crypto-investor-daily-improve`, ~07:18 PT) para que una corrida
reducida corra automáticamente cada día. Es solo una opción: no se ha
modificado ningún cron y no se modificará sin la orden explícita de
Rubén. Si se activa, debe mantener todas las reglas de este manual
(local, sin deploy sin "Publica", trading intocable, informe por
corrida en `hidden_files/`).

## Historial de corridas

- **2026-10-29 (primera corrida).** Auditoría: 74 hallazgos (35
  frontend, 21 backend, 18 QA). Ejecución hecha por el coordinador
  ante el fallo de despliegue de subagentes de ejecución. 56 archivos
  modificados + 3 nuevos (test de la corrida, `error.tsx`,
  `not-found.tsx`); suite 219 → 234 tests en verde; build frontend 22
  rutas, 103 kB compartidos. Sin cambios de esquema, sin tocar
  trading, sin publicar. Detalle en
  `hidden_files/agents-2026-10-29/informe.md`.
