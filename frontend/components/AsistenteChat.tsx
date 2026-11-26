"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiError, getToken, isGuest } from "../lib/api/client";
import { api } from "../lib/api";
import { marketingApi } from "../lib/api/marketing";
import { loginUrl } from "../lib/session";
import { safeHttpHref } from "../lib/urls";
import { ageInMinutes, dateKeyInTz } from "../lib/dates";
import { OPEN_ASISTENTE_EVENT } from "../lib/herramientas";
import {
  accionDestino,
  buildHistorial,
  diaBoundsISO,
  esOrdenCrearCita,
  extractPrecio,
  getCapacidades,
  getUso,
  listPreguntas,
  newIdempotencyKey,
  normalizeSugerencias,
  postChat,
  postFeedback,
  type AsistenteAccion,
  type AsistenteAclaracion,
  type AsistenteComando,
  type AsistenteFeedbackVoto,
  type AsistenteFuente,
  type AsistenteRecurso,
  type AsistenteSugerencia,
  type AsistenteUso,
} from "../lib/asistente";
import { splitLinks } from "../lib/linkify";
import { useLanguage } from "../lib/i18n";
import { PreguntasEnsenar } from "./PreguntasEnsenar";
import { SimulacionAviso } from "./SimulacionAviso";
import { catalogMemo } from "../lib/api/memo";

/**
 * Asistente — chat personalizado dentro de la web.
 * Botón flotante (esquina inferior derecha) + panel de chat, y vista
 * dedicada en /asistente (mismo cuerpo de chat, variante "page").
 * Historial solo en sesión (estado React): nada se persiste en BD.
 * Corrida 2026-11-26 (Asistente práctico, Agente 1): el historial se
 * guarda en sessionStorage (A-1) y se comparte entre el flotante y
 * /asistente; cada POST lleva los últimos 6 turnos (C-2) y una
 * Idempotency-Key por intento, reutilizada en el reintento (A6/M3).
 * Las respuestas llegan en español desde el backend y se muestran tal cual;
 * si el backend devuelve accion null con texto de solo-lectura (rol prueba),
 * también se muestra tal cual.
 * Tras una acción se muestra la confirmación y se invalida el memo del
 * cliente (P2, 2026-11-23): la lista afectada se vuelve a pedir al
 * visitar el módulo, en vez de mostrar datos viejos hasta recargar.
 */

type ChatMsg = {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  /** Marca temporal local (F3-1): se pone al crear el mensaje. */
  created_at: number;
  /** Saludo inicial: no viaja en el historial (C-2) y se sustituye
   * por el saludo contextual (M-5) al resolver plan y citas. */
  isGreeting?: boolean;
  accion?: AsistenteAccion | null;
  /** Mensaje original que falló, para el botón de reintento. */
  failedInput?: string;
  /** Clave del error que falló el envío (F2-7): con red/timeout el
   * reintento pide confirmación, porque la primera quizá sí se ejecutó. */
  failedKey?: ApiError["key"];
  /** Idempotency-Key del intento fallido (A6/M3): el reintento la
   * reutiliza para no duplicar una mutación. */
  idempotencyKey?: string;
  /** El error es el límite diario: mostrar el enlace a /planes. */
  showPlanesLink?: boolean;
  /** Fuente externa consultada + fecha (contrato 2026-11-23). */
  fuente?: AsistenteFuente | null;
  consultado_en?: string | null;
  /** Fecha de publicación del contenido consultado (M-4). */
  publicado_en?: string | null;
  sin_respuesta?: boolean;
  confianza?: number;
  aclaracion?: AsistenteAclaracion | null;
  recursos?: AsistenteRecurso[] | null;
  pasos?: string[];
  ruta?: string | null;
  /** Voto ya confirmado al backend (B-4): persiste en sessionStorage
   * para no volver a votar la misma burbuja al reabrir el panel. */
  voted?: AsistenteFeedbackVoto | null;
};

let nextMsgId = 1;

/** Persistencia del historial (A-1): sessionStorage, compartido por
 * el flotante y /asistente (nunca se monta más de uno a la vez). Solo
 * sobrevive a la sesión del navegador; nada va al servidor. */
const STORAGE_KEY = "asistente:chat:v1";

function loadStoredMessages(fallback: ChatMsg[]): ChatMsg[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const msgs = parsed.filter(
      (m): m is ChatMsg =>
        !!m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant" || m.role === "error") &&
        typeof m.text === "string" &&
        typeof m.id === "number" &&
        typeof m.created_at === "number",
    );
    if (msgs.length === 0) return fallback;
    nextMsgId = Math.max(nextMsgId, ...msgs.map((m) => m.id)) + 1;
    return msgs;
  } catch {
    return fallback;
  }
}

/** Mapea ApiError.key a una cadena i18n. Nunca se muestra el detalle
 * técnico del backend ni trazas al usuario. */
function errorKeyToString(key: ApiError["key"], t: ReturnType<typeof useLanguage>["t"]): string {
  switch (key) {
    case "network":
      return t.asistente.errNetwork;
    case "timeout":
      return t.asistente.errTimeout;
    case "forbidden":
      return t.asistente.errForbidden;
    case "tooManyRequests":
      // F2-8: el 429 del chat tiene mensaje propio, no el genérico.
      return t.asistente.errTooManyRequests;
    case "notFound":
      return t.asistente.errNotFound;
    case "server":
      return t.asistente.errServer;
    default:
      return t.asistente.errGeneric;
  }
}

function ChatIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Una burbuja del historial, memoizada (chat-opt 2026-11-23): cada
 * pulsación en el input re-renderizaba el cuerpo entero y con él
 * todas las burbujas. Las props son estables (el mensaje es el mismo
 * objeto mientras viva en el historial; las etiquetas son strings del
 * diccionario; fmtConsultado/onRetry son useCallback), así que una
 * burbuja ya pintada no se vuelve a pintar al teclear o al llegar un
 * mensaje nuevo. */
type ChatBubbleLabels = {
  noAnswer: string;
  stepsTitle: string;
  goToModule: string;
  actionDone: string;
  consultedAt: string;
  sourceOnly: string;
  platformSource: string;
  clarificationTitle: string;
  confidence: string;
  resourcesTitle: string;
  resourceType: (tipo: string) => string;
  retry: string;
  retryMaybeExecuted: string;
  cancel: string;
  send: string;
  // Fase 6, tarea 3: voto útil / no útil por respuesta.
  feedbackTitle: string;
  feedbackUtil: string;
  feedbackNoUtil: string;
  feedbackGracias: string;
  // Corrida 2026-11-26 (Agente 1).
  feedbackError: string;
  viewPlans: string;
  createdTitle: string;
  createdClient: string;
  createdService: string;
  createdWhen: string;
  createdDuration: string;
  createdStatus: string;
  createdTitleField: string;
  createdId: string;
  viewInModule: string;
  moduloLabel: (modulo: "business" | "crear") => string;
  priceTitle: string;
  priceBtc: string;
  priceEth: string;
  priceAgeMin: string;
  priceAgeNow: string;
  priceStale: string;
  priceVela: string;
  publishedAt: string;
};

const ChatBubble = memo(function ChatBubble({
  m,
  labels,
  fmtConsultado,
  fmtTime,
  onRetry,
  onSend,
  pregunta,
  onFeedback,
  onVoteConfirmed,
}: {
  m: ChatMsg;
  labels: ChatBubbleLabels;
  fmtConsultado: (iso: string | null | undefined) => string | null;
  fmtTime: (ts: number) => string;
  onRetry: (msg: ChatMsg) => void;
  onSend: (text: string) => void;
  /** Pregunta del usuario que originó esta respuesta (para el voto);
   * ausente en el saludo inicial, que no lleva botones. */
  pregunta?: string;
  onFeedback?: (pregunta: string, voto: AsistenteFeedbackVoto) => Promise<boolean>;
  onVoteConfirmed?: (id: number, voto: AsistenteFeedbackVoto) => void;
}) {
  // F2-7: si el fallo fue de red/timeout no se sabe si el mensaje llegó;
  // el primer toque del reintento pide confirmación en línea (puede
  // duplicar una orden de creación). Otros errores reenvían directo.
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  // Fase 6, tarea 3: voto ya enviado para esta respuesta (un voto por
  // burbuja y por sesión; el backend guarda pregunta + voto + fecha).
  // B-4 (2026-11-26): solo se marca tras confirmar el envío; si falla,
  // los botones siguen activos y se muestra el error.
  const [voted, setVoted] = useState<AsistenteFeedbackVoto | null>(m.voted ?? null);
  const [voteError, setVoteError] = useState(false);
  const onVote = async (voto: AsistenteFeedbackVoto) => {
    if (voted || !pregunta || !onFeedback) return;
    setVoteError(false);
    const ok = await onFeedback(pregunta, voto);
    if (ok) {
      setVoted(voto);
      onVoteConfirmed?.(m.id, voto);
    } else {
      setVoteError(true);
    }
  };
  const retryNeedsConfirm = m.failedKey === "network" || m.failedKey === "timeout";
  const onRetryClick = () => {
    if (retryNeedsConfirm && !confirmingRetry) {
      setConfirmingRetry(true);
      return;
    }
    setConfirmingRetry(false);
    onRetry(m);
  };
  return (
    <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          m.role === "user"
            ? "rounded-br-md bg-emerald-700 text-white"
            : m.role === "error"
              ? "rounded-bl-md border border-red-800/70 bg-red-500/10 text-red-200"
              : "rounded-bl-md border border-zinc-700 bg-zinc-800 text-zinc-100"
        }`}
      >
        {/* F4-3: URLs del texto como enlaces (safeHttpHref), sin
            dangerouslySetInnerHTML: React renderiza nodos <a> normales. */}
        <p className="whitespace-pre-wrap">
          {splitLinks(m.text).map((seg, i) =>
            seg.href ? (
              <a
                key={i}
                href={seg.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-emerald-300 underline underline-offset-2 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {seg.text}
              </a>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>
        {/* F3-1: marca temporal local en cada mensaje. */}
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">
          {fmtTime(m.created_at)}
        </p>
        {m.role === "assistant" && m.sin_respuesta && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            {labels.noAnswer}
          </p>
        )}
        {/* Fase 6, tarea 3: voto útil / no útil por respuesta (solo
            cuando hay pregunta que la originó; el saludo no vota).
            Un voto por burbuja; tras votar se muestra el gracias. */}
        {m.role === "assistant" && pregunta && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {voted ? (
              <span className="text-xs font-semibold text-emerald-300">
                {labels.feedbackGracias}
              </span>
            ) : (
              <>
                <span className="text-xs text-zinc-300">{labels.feedbackTitle}</span>
                <button
                  type="button"
                  onClick={() => void onVote("util")}
                  className="min-h-[30px] rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:border-emerald-600 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  {labels.feedbackUtil}
                </button>
                <button
                  type="button"
                  onClick={() => void onVote("no_util")}
                  className="min-h-[30px] rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  {labels.feedbackNoUtil}
                </button>
                {voteError && (
                  <span role="alert" className="text-xs font-semibold text-red-300">
                    {labels.feedbackError}
                  </span>
                )}
              </>
            )}
          </div>
        )}
        {/* F3-3: pregunta aclaratoria con botones de opción que envían
            la respuesta; sin opciones, el usuario responde escribiendo. */}
        {m.role === "assistant" && m.aclaracion && (
          <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              {labels.clarificationTitle}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-100">{m.aclaracion.pregunta}</p>
            {m.aclaracion.opciones && m.aclaracion.opciones.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.aclaracion.opciones.map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => onSend(op)}
                    className="min-h-[36px] rounded-full border border-emerald-600 bg-emerald-700/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  >
                    {op}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {m.role === "assistant" && m.pasos && m.pasos.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              {labels.stepsTitle}
            </p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {m.pasos.map((paso, i) => (
                <li key={i} className="text-sm leading-relaxed text-zinc-200">
                  {paso}
                </li>
              ))}
            </ol>
            {m.ruta && m.ruta.startsWith("/") && (
              <Link
                href={m.ruta}
                className="mt-2 inline-flex min-h-[36px] items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {labels.goToModule} →
              </Link>
            )}
          </div>
        )}
        {/* F4-3: recursos de la biblioteca como tarjetas clicables. La
            ruta interna usa Link; el enlace externo, safeHttpHref. */}
        {m.role === "assistant" && m.recursos && m.recursos.length > 0 && (
          <div className="mt-2 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              {labels.resourcesTitle}
            </p>
            {m.recursos.map((r) => {
              const href = r.ruta && r.ruta.startsWith("/") ? r.ruta : safeHttpHref(r.enlace);
              const inner = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-zinc-100">{r.titulo}</span>
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      {labels.resourceType(r.tipo)}
                    </span>
                  </span>
                  {r.descripcion && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-zinc-300">{r.descripcion}</span>
                  )}
                  {typeof r.precio_usd === "number" && (
                    <span className="mt-0.5 block text-xs font-semibold text-zinc-200">
                      ${r.precio_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                  )}
                </>
              );
              const cls =
                "block rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-left hover:border-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";
              return href ? (
                r.ruta && r.ruta.startsWith("/") ? (
                  <Link key={r.id} href={href} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <a key={r.id} href={href} target="_blank" rel="noopener noreferrer" className={cls}>
                    {inner}
                  </a>
                )
              ) : (
                <div key={r.id} className={cls}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
        {/* F3-1: fuente + fecha SIEMPRE en respuestas del asistente. Sin
            fuente del backend, fallback explícito "Datos de la plataforma"
            con la hora local del mensaje (nunca se omite en silencio).
            M-4 (2026-11-26): fecha de publicación del contenido cuando
            la fuente la trae (noticias RSS). */}
        {m.role === "assistant" && (
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">
            {m.fuente ? (
              (() => {
                const fecha = fmtConsultado(m.consultado_en);
                const href = safeHttpHref(m.fuente?.url);
                const label = labels.sourceOnly.replace("{nombre}", m.fuente?.nombre ?? "");
                return (
                  <>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                      >
                        {label} ↗
                      </a>
                    ) : (
                      label
                    )}
                    {fecha ? ` · ${labels.consultedAt.replace("{fecha}", fecha)}` : ""}
                  </>
                );
              })()
            ) : (
              <>
                {labels.platformSource}
                {" · "}
                {labels.consultedAt.replace("{fecha}", fmtConsultado(m.consultado_en) ?? fmtTime(m.created_at))}
              </>
            )}
            {(() => {
              const publicado = fmtConsultado(m.publicado_en ?? m.fuente?.publicado_en);
              return publicado ? <>{" · "}{labels.publishedAt.replace("{fecha}", publicado)}</> : null;
            })()}
            {typeof m.confianza === "number" && (
              <>{" · "}{labels.confidence.replace("{pct}", String(Math.round(m.confianza)))}</>
            )}
          </p>
        )}
        {/* M-2/B6 (2026-11-26): mini-tarjeta de precio con hora y edad
            del dato, desde accion.datos (tipo "precio_btc"). Nunca dice
            "actual" con caché vieja: si la fuente no es la caché fresca,
            lo dice explícito. Sin precio real no hay tarjeta. */}
        {m.role === "assistant" &&
          (() => {
            const precio = extractPrecio(m.accion ?? null, m.consultado_en);
            if (!precio) return null;
            const edadMin =
              precio.edadSegundos != null
                ? Math.floor(precio.edadSegundos / 60)
                : ageInMinutes(precio.timestamp);
            const edadTxt =
              edadMin == null
                ? null
                : edadMin < 1
                  ? labels.priceAgeNow
                  : labels.priceAgeMin.replace("{n}", String(edadMin));
            const fmtUsd = (v: number) =>
              `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            return (
              <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  {labels.priceTitle}
                </p>
                <div className="mt-1 space-y-0.5 text-sm text-zinc-100">
                  {precio.btcUsd != null && (
                    <p>
                      {labels.priceBtc}: <span className="font-semibold">{fmtUsd(precio.btcUsd)}</span>
                    </p>
                  )}
                  {precio.ethUsd != null && (
                    <p>
                      {labels.priceEth}: <span className="font-semibold">{fmtUsd(precio.ethUsd)}</span>
                    </p>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                  {precio.timestamp ? fmtConsultado(precio.timestamp) : null}
                  {precio.timestamp && edadTxt ? ` · ${edadTxt}` : ""}
                </p>
                {precio.fuente === "cache_mercado_vieja" && (
                  <p className="mt-1 text-xs font-semibold text-amber-300">{labels.priceStale}</p>
                )}
                {precio.fuente === "velas_guardadas" && (
                  <p className="mt-1 text-xs font-semibold text-amber-300">{labels.priceVela}</p>
                )}
              </div>
            );
          })()}
        {/* A-2 (2026-11-26): tarjeta de confirmación con los datos
            creados + enlace "Ver en {módulo}". Si el backend marcó
            conflicto (cita que se solapa), nada se creó: no hay tarjeta
            ni pill de acción, el texto ya lo explica. */}
        {m.role === "assistant" &&
          m.accion &&
          (() => {
            const datos = (m.accion?.datos ?? {}) as Record<string, unknown>;
            if (datos.conflicto === true) return null;
            const dest = accionDestino(m.accion?.tipo ?? "");
            if (!dest) return null;
            const str = (v: unknown): string | null =>
              typeof v === "string" && v ? v : null;
            const filas: Array<[string, string]> = [];
            const titulo = str(datos.title);
            if (titulo) filas.push([labels.createdTitleField, titulo]);
            const cliente = str(datos.client_name);
            if (cliente) filas.push([labels.createdClient, cliente]);
            const servicio = str(datos.service_type);
            if (servicio) filas.push([labels.createdService, servicio]);
            const cuando = str(datos.starts_at);
            if (cuando) filas.push([labels.createdWhen, fmtConsultado(cuando) ?? cuando]);
            if (typeof datos.duration_min === "number")
              filas.push([labels.createdDuration, `${datos.duration_min} min`]);
            const estado = str(datos.status);
            if (estado) filas.push([labels.createdStatus, estado]);
            if (typeof datos.id === "number") filas.push([labels.createdId, `#${datos.id}`]);
            return (
              <div className="mt-2 rounded-lg border border-emerald-700/50 bg-emerald-500/10 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">
                  {labels.createdTitle}
                </p>
                {filas.length > 0 && (
                  <dl className="mt-1 space-y-0.5 text-sm text-zinc-100">
                    {filas.map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="shrink-0 text-zinc-300">{k}:</dt>
                        <dd className="min-w-0 font-semibold">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <Link
                  href={dest.ruta}
                  className="mt-2 inline-flex min-h-[36px] items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  {labels.viewInModule.replace("{modulo}", labels.moduloLabel(dest.modulo))}
                </Link>
              </div>
            );
          })()}
        {m.accion &&
          !((m.accion.datos as Record<string, unknown> | undefined)?.conflicto === true) && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              <span aria-hidden="true">✓</span>
              {labels.actionDone.replace("{tipo}", m.accion.tipo)}
            </p>
          )}
        {/* C-1 (2026-11-26): el 429 diario llega con su detalle y el
            enlace a /planes; los demás errores usan el genérico. */}
        {m.role === "error" && m.showPlanesLink && (
          <div className="mt-2">
            <Link
              href="/planes"
              className="inline-flex min-h-[36px] items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {labels.viewPlans} →
            </Link>
          </div>
        )}
        {m.role === "error" && m.failedInput && (
          <div className="mt-2">
            {confirmingRetry && (
              <p role="alert" className="mb-2 text-xs leading-relaxed text-red-200">
                {labels.retryMaybeExecuted}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onRetryClick}
                className="min-h-[36px] rounded-lg border border-red-400/60 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
              >
                {confirmingRetry ? labels.send : labels.retry}
              </button>
              {confirmingRetry && (
                <button
                  type="button"
                  onClick={() => setConfirmingRetry(false)}
                  className="min-h-[36px] rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  {labels.cancel}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

/** Cuerpo del chat compartido por el panel flotante y la página /asistente. */
function AsistenteChatBody() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  // Fecha de consulta ("23 nov 2026, 17:58"): el backend manda ISO UTC;
  // si no parsea, no se muestra fecha en vez de inventar una.
  const fmtConsultado = useCallback(
    (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return `${d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
    },
    [locale],
  );
  // Hora local corta (F3-1) para la marca temporal de cada mensaje.
  const fmtTime = useCallback(
    (ts: number): string =>
      new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  // Etiquetas de la burbuja, estables por idioma: con ellas ChatBubble
  // (memo) no se re-renderiza al teclear.
  const bubbleLabels: ChatBubbleLabels = useMemo(
    () => ({
      noAnswer: t.asistente.noAnswer,
      stepsTitle: t.asistente.stepsTitle,
      goToModule: t.asistente.goToModule,
      actionDone: t.asistente.actionDone,
      consultedAt: t.asistente.consultedAt,
      sourceOnly: t.asistente.sourceOnly,
      platformSource: t.asistente.platformSource,
      clarificationTitle: t.asistente.clarificationTitle,
      confidence: t.asistente.confidence,
      resourcesTitle: t.asistente.resourcesTitle,
      resourceType: (tipo: string) =>
        tipo === "ebook" ? t.asistente.resourceTypeEbook
        : tipo === "guia" ? t.asistente.resourceTypeGuia
        : tipo === "pack" ? t.asistente.resourceTypePack
        : tipo === "academia" ? t.asistente.resourceTypeAcademia
        : tipo === "clase_grabada" ? t.asistente.resourceTypeClaseGrabada
        : tipo === "clase_en_vivo" ? t.asistente.resourceTypeClaseEnVivo
        : tipo === "video" ? t.asistente.resourceTypeVideo
        : tipo === "herramienta" ? t.asistente.resourceTypeHerramienta
        : tipo,
      retry: t.asistente.retry,
      retryMaybeExecuted: t.asistente.retryMaybeExecuted,
      cancel: t.common.cancel,
      send: t.asistente.send,
      feedbackTitle: t.asistente.feedbackTitle,
      feedbackUtil: t.asistente.feedbackUtil,
      feedbackNoUtil: t.asistente.feedbackNoUtil,
      feedbackGracias: t.asistente.feedbackGracias,
      // Corrida 2026-11-26 (Agente 1).
      feedbackError: t.asistente.feedbackError,
      viewPlans: t.asistente.viewPlans,
      createdTitle: t.asistente.createdTitle,
      createdClient: t.asistente.createdClient,
      createdService: t.asistente.createdService,
      createdWhen: t.asistente.createdWhen,
      createdDuration: t.asistente.createdDuration,
      createdStatus: t.asistente.createdStatus,
      createdTitleField: t.asistente.createdTitleField,
      createdId: t.asistente.createdId,
      viewInModule: t.asistente.viewInModule,
      moduloLabel: (modulo) => (modulo === "business" ? t.nav.business.label : t.nav.crear.label),
      priceTitle: t.asistente.priceTitle,
      priceBtc: t.asistente.priceBtc,
      priceEth: t.asistente.priceEth,
      priceAgeMin: t.asistente.priceAgeMin,
      priceAgeNow: t.asistente.priceAgeNow,
      priceStale: t.asistente.priceStale,
      priceVela: t.asistente.priceVela,
      publishedAt: t.asistente.publishedAt,
    }),
    [t],
  );
  // A-1 (2026-11-26): el historial se restaura de sessionStorage y se
  // comparte entre el flotante y /asistente; sin nada guardado, saludo.
  const [messages, setMessages] = useState<ChatMsg[]>(() =>
    loadStoredMessages([
      { id: 0, role: "assistant", text: t.asistente.greeting, created_at: Date.now(), isGreeting: true },
    ]),
  );
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // A-1: cada cambio del historial se guarda en sessionStorage.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Sin almacenamiento (modo privado): el chat sigue funcionando.
    }
  }, [messages]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [comandos, setComandos] = useState<AsistenteComando[]>([]);
  const [sugerencias, setSugerencias] = useState<AsistenteSugerencia[]>([]);
  // F3 (2026-11-23): rol para filtrar los chips de creación de admin.
  // Empieza en false (fail-closed, como ModuleNav) hasta que /me confirme.
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasSession, setHasSession] = useState(() => !!getToken());
  // C-1 (2026-11-26): uso diario por plan (null mientras no resuelve;
  // sin línea si falla o si es invitado, que no tiene fila en /uso).
  const [uso, setUso] = useState<AsistenteUso | null>(null);
  const [usoLoaded, setUsoLoaded] = useState(false);
  // A-2 (2026-11-26): orden de crear cita esperando confirmación previa.
  const [pendingCita, setPendingCita] = useState<{ text: string; key: string } | null>(null);
  // M-5 (2026-11-26): citas de hoy para el saludo contextual (solo admin).
  const [citasHoy, setCitasHoy] = useState<string[] | null>(null);
  const [greetingContextApplied, setGreetingContextApplied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  const fetchUso = useCallback(async () => {
    if (!getToken() || isGuest()) {
      setUsoLoaded(true);
      return;
    }
    try {
      setUso(await getUso());
    } catch {
      // Sin línea de uso si /uso falla: el chat sigue funcionando.
    } finally {
      setUsoLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchUso();
  }, [fetchUso]);

  // M-5: citas de hoy (solo admin) para el saludo contextual. Se piden
  // una vez, con el día civil de Los Ángeles; un fallo no bloquea el
  // saludo (citasHoy queda en lista vacía).
  useEffect(() => {
    if (!isAdmin) {
      setCitasHoy([]);
      return;
    }
    let cancelled = false;
    const bounds = diaBoundsISO();
    marketingApi
      .listAppointments({ from: bounds.from, to: bounds.to })
      .then((rows) => {
        if (cancelled) return;
        const hoy = (rows ?? []).filter(
          (a) => a.status !== "cancelada" && dateKeyInTz(a.starts_at) === bounds.fecha,
        );
        setCitasHoy(hoy.map((a) => a.client_name || "Sin cliente"));
      })
      .catch(() => {
        if (!cancelled) setCitasHoy([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // M-5: saludo contextual, una sola vez y solo si el hilo sigue siendo
  // el saludo inicial: plan + restantes (vía /uso) + citas de hoy si
  // las hay. Si ya hay conversación guardada, no se toca nada.
  useEffect(() => {
    if (greetingContextApplied || !usoLoaded || citasHoy === null) return;
    setMessages((prev) => {
      if (prev.length !== 1 || !prev[0].isGreeting) return prev;
      let text = t.asistente.greeting;
      if (uso) {
        text +=
          uso.limite_diario === null
            ? ` ${t.asistente.greetingUnlimited.replace("{plan}", uso.plan_nombre)}`
            : ` ${t.asistente.greetingPlanLine
                .replace("{plan}", uso.plan_nombre)
                .replace("{restantes}", String(uso.restantes ?? 0))}`;
      }
      if (citasHoy.length > 0) {
        text += ` ${t.asistente.greetingCitasLine
          .replace("{n}", String(citasHoy.length))
          .replace("{lista}", citasHoy.slice(0, 3).join(", "))}`;
      }
      return [{ ...prev[0], text }];
    });
    setGreetingContextApplied(true);
  }, [greetingContextApplied, usoLoaded, citasHoy, uso, t]);

  // Capacidades (chips de comandos) al montar, solo con sesión.
  // Invitado (Fase 1): sin /me ni capacidades — /me con token de
  // invitado no tiene fila de usuario y un 401 expulsaría la prueba; el
  // invitado nunca es admin y los chips llegan con las respuestas.
  useEffect(() => {
    if (!getToken() || isGuest()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getCapacidades();
        if (!cancelled) setComandos(res.comandos ?? []);
      } catch {
        // Sin chips si fallan las capacidades: el chat sigue funcionando.
        if (!cancelled) setComandos([]);
      }
    })();
    // Rol (F3): los chips de creación de admin solo se muestran a admin.
    // Ante error se asume no-admin (fail-closed): el chat sigue
    // funcionando, solo sin esos chips.
    api.me().then((m) => { if (!cancelled) setIsAdmin(!!m.is_admin); }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Autoscroll al fondo con cada mensaje nuevo o al escribir.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const send = useCallback(
    async (raw: string, opts?: { idempotencyKey?: string; confirmed?: boolean }) => {
      const text = raw.trim();
      if (!text || sendingRef.current) return;
      if (!getToken()) {
        setHasSession(false);
        return;
      }
      // A-2: una orden de crear cita pide confirmación previa antes de
      // enviarse (el texto viaja tal cual; la fecha/hora interpretada
      // la muestra la tarjeta de confirmación tras crearla, porque solo
      // el backend interpreta la fecha — sin endpoint de simulación en
      // esta corrida no se puede mostrar antes sin inventarla).
      if (!opts?.confirmed && esOrdenCrearCita(text)) {
        setPendingCita({ text, key: opts?.idempotencyKey ?? newIdempotencyKey() });
        return;
      }
      // A6/M3: una clave por intento; el reintento reutiliza la misma.
      const idempotencyKey = opts?.idempotencyKey ?? newIdempotencyKey();
      // C-2: los últimos turnos viajan con el mensaje para que el
      // backend resuelva referencias ("esa cita", "cámbiala a las 11").
      const historial = buildHistorial(messagesRef.current);
      sendingRef.current = true;
      setTyping(true);
      setMessages((prev) => [...prev, { id: nextMsgId++, role: "user", text, created_at: Date.now() }]);
      setInput("");
      setSugerencias([]);
      setPendingCita(null);
      try {
        const res = await postChat(text, { idempotencyKey, historial });
        // Refresco de paneles (P2): si el Asistente ejecutó una acción,
        // los catálogos memoizados quedan viejos — se invalidan para que
        // el módulo afectado se vuelva a pedir al visitarlo.
        if (res.accion) catalogMemo.clear();
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId++,
            role: "assistant",
            text: res.respuesta,
            created_at: Date.now(),
            accion: res.accion ?? null,
            fuente: res.fuente ?? null,
            consultado_en: res.consultado_en ?? null,
            publicado_en: res.publicado_en ?? res.fuente?.publicado_en ?? null,
            sin_respuesta: res.sin_respuesta ?? false,
            confianza: typeof res.confianza === "number" ? res.confianza : undefined,
            aclaracion: res.aclaracion ?? null,
            recursos: res.recursos ?? null,
            pasos: res.pasos ?? [],
            ruta: res.ruta ?? null,
          },
        ]);
        // F2-8: las sugerencias llegan normalizadas (string antiguo u
        // objeto con requiere_admin); el filtrado por rol es por la
        // marca, no por el prefijo "Crea ".
        setSugerencias(normalizeSugerencias(res.sugerencias));
        // C-1: tras enviar, los restantes cambian: refrescar la línea.
        void fetchUso();
      } catch (err) {
        // Un 401 con sesión expirada ya redirige al login desde el cliente
        // central; aquí solo queda el resto de fallos, sin trazas técnicas.
        const apiErr = err instanceof ApiError ? err : null;
        const key = apiErr ? apiErr.key : "unknown";
        // C-1: el 429 diario trae su explicación en `detail` ("Has
        // llegado a tu límite diario…"): se muestra tal cual, con el
        // enlace a /planes, en vez del genérico de "demasiadas seguidas".
        // Un 429 de ritmo (sin ese texto) sigue usando el genérico.
        const isDailyLimit =
          key === "tooManyRequests" &&
          !!apiErr?.detail &&
          /l[ií]mite diario/i.test(apiErr.detail);
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId++,
            role: "error",
            text: isDailyLimit && apiErr?.detail ? apiErr.detail : errorKeyToString(key, t),
            created_at: Date.now(),
            failedInput: text,
            failedKey: key,
            idempotencyKey,
            showPlanesLink: isDailyLimit,
          },
        ]);
      } finally {
        setTyping(false);
        sendingRef.current = false;
      }
    },
    [t, fetchUso],
  );

  const retry = useCallback(
    (msg: ChatMsg) => {
      if (!msg.failedInput) return;
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      // El reintento reutiliza la Idempotency-Key del intento fallido
      // (A6/M3) y no vuelve a pedir confirmación de cita: el usuario ya
      // la dio antes del primer envío.
      void send(msg.failedInput, { idempotencyKey: msg.idempotencyKey, confirmed: true });
    },
    [send],
  );

  // Fase 6, tarea 3: voto útil / no útil. B-4 (2026-11-26): solo se
  // marca como votado cuando el backend lo confirma; si falla por red,
  // la burbuja sigue sin votar y muestra el error.
  const onFeedback = useCallback(
    async (pregunta: string, voto: AsistenteFeedbackVoto): Promise<boolean> => {
      try {
        await postFeedback(pregunta, voto);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const onVoteConfirmed = useCallback((id: number, voto: AsistenteFeedbackVoto) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, voted: voto } : m)));
  }, []);

  // A-1: botón Limpiar explícito (con confirmación: borra el historial
  // de sessionStorage y vuelve al saludo base).
  const clearHistory = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm(t.asistente.confirmClear)) return;
    setMessages([
      { id: nextMsgId++, role: "assistant", text: t.asistente.greeting, created_at: Date.now(), isGreeting: true },
    ]);
    setSugerencias([]);
    setPendingCita(null);
    setGreetingContextApplied(false);
  }, [t]);

  // Chips: tras cada respuesta mandan las sugerencias del backend; al
  // inicio, los ejemplos de las capacidades. Un chip rellena el input y
  // pone el foco (no envía solo: evita ejecutar una acción por un toque).
  // F2-8 (chat-potencia): las sugerencias de creación de admin se
  // filtran por su marca `requiere_admin`, no por el prefijo "Crea " (que
  // no funcionaba en inglés y era frágil ante cambios de redactado). Las
  // de lectura sensible SE mantienen visibles: la decisión M1 es de Rubén
  // y está pendiente. En `sin_respuesta` estas mismas sugerencias son los
  // chips de reformulación, y el cuerpo es compartido: se ven igual en el
  // flotante que en /asistente (F3-3).
  const chips: { label: string; title?: string; admin?: boolean }[] = (
    sugerencias.length > 0
      ? sugerencias.map((s) => ({ label: s.label, admin: s.requiere_admin }))
      : comandos
          .filter((c) => isAdmin || !c.requiere_admin)
          .map((c) => ({ label: c.ejemplo, title: c.descripcion, admin: c.requiere_admin }))
  ).filter((c) => isAdmin || !c.admin);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Fase 6, tarea 4: el aviso de simulación ("Simulación, no es
          asesoría financiera", Fase 2) faltaba en las pantallas del
          asistente: va fijo arriba del historial, sin scroll, en el
          panel flotante y en /asistente (cuerpo compartido). */}
      <div className="border-b border-zinc-800 px-4 pt-3">
        <SimulacionAviso />
      </div>
      {/* C-1 / A-1 (2026-11-26): línea de uso del plan + botón Limpiar.
          Sin uso (invitado o /uso sin responder) no se pinta nada. */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
        {uso ? (
          <p
            className={`text-xs font-semibold leading-relaxed ${
              uso.restantes === 0 ? "text-amber-300" : "text-zinc-300"
            }`}
          >
            {uso.limite_diario === null
              ? t.asistente.usoAdmin
                  .replace("{plan}", uso.plan_nombre)
                  .replace("{n}", String(uso.mensajes_hoy))
              : t.asistente.usoLine
                  .replace("{plan}", uso.plan_nombre)
                  .replace("{restantes}", String(uso.restantes ?? 0))}
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={clearHistory}
          className="min-h-[30px] shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {t.asistente.clearHistory}
        </button>
      </div>
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label={t.asistente.title}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((m, i) => {
          // Fase 6, tarea 3: la pregunta que originó esta respuesta
          // es el último mensaje del usuario antes de ella.
          let pregunta: string | undefined;
          if (m.role === "assistant") {
            for (let j = i - 1; j >= 0; j--) {
              if (messages[j].role === "user") {
                pregunta = messages[j].text;
                break;
              }
            }
          }
          return (
            <ChatBubble
              key={m.id}
              m={m}
              labels={bubbleLabels}
              fmtConsultado={fmtConsultado}
              fmtTime={fmtTime}
              onRetry={retry}
              onSend={(text) => void send(text)}
              pregunta={pregunta}
              onFeedback={onFeedback}
              onVoteConfirmed={onVoteConfirmed}
            />
          );
        })}
        {typing && (
          <div className="flex justify-start">
            <div
              aria-label={t.asistente.typing}
              className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-zinc-700 bg-zinc-800 px-3.5 py-3"
            >
              <span className="sr-only">{t.asistente.typing}</span>
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-400 motion-safe:animate-bounce" />
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-400 motion-safe:animate-bounce [animation-delay:150ms]" />
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-400 motion-safe:animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Invitación a registrarse tras 5 mensajes de invitado (Fase 1):
          el chat sigue funcionando, pero guardar el progreso exige cuenta. */}
      {isGuest() && messages.filter((m) => m.role === "user").length >= 5 && (
        <div role="status" className="border-t border-emerald-800/60 bg-emerald-500/10 px-4 py-3">
          <p className="text-sm leading-relaxed text-emerald-200">{t.guest.inviteChat}</p>
          <Link
            href="/login?mode=register"
            className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.guest.bannerCta}
          </Link>
        </div>
      )}

      {!hasSession && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="text-sm text-zinc-300">{t.asistente.errLogin}</p>
          <Link
            href={loginUrl(typeof window !== "undefined" ? window.location.pathname : "/asistente")}
            className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.asistente.loginCta}
          </Link>
        </div>
      )}

      {chips.length > 0 && hasSession && (
        <div className="border-t border-zinc-800 px-4 pb-1 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            {t.asistente.suggestionsTitle}{" "}
            <span className="font-normal normal-case tracking-normal text-zinc-400">
              {t.asistente.chipsHint}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.title}
                onClick={() => {
                  setInput(c.label);
                  inputRef.current?.focus();
                }}
                className="min-h-[36px] rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-600 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {c.label}
                {c.admin && (
                  <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    {t.asistente.adminBadge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* A-2: confirmación previa antes de enviar una orden de cita. */}
      {pendingCita && hasSession && (
        <div role="alert" className="border-t border-amber-700/60 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-amber-200">{t.asistente.pendingCitaTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-200">
            {t.asistente.pendingCitaBody.replace("{texto}", pendingCita.text)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void send(pendingCita.text, { idempotencyKey: pendingCita.key, confirmed: true })}
              className="min-h-[36px] rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.asistente.pendingCitaConfirm}
            </button>
            <button
              type="button"
              onClick={() => setPendingCita(null)}
              className="min-h-[36px] rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-t border-zinc-800 px-4 py-3">
        <input
          ref={inputRef}
          aria-label={t.asistente.inputAria}
          type="text"
          value={input}
          disabled={!hasSession || typing}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(input);
          }}
          placeholder={t.asistente.inputPlaceholder}
          maxLength={1000}
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={!hasSession || typing || !input.trim()}
          className="min-h-[44px] shrink-0 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {typing ? t.asistente.sending : t.asistente.send}
        </button>
      </div>
    </div>
  );
}

/** Botón flotante + panel de chat. Se monta en el layout raíz; se oculta
 * en /login (pantalla pública) y en /asistente (la vista dedicada ya tiene
 * el chat), y al cliente vinculado (2026-11-23: sin "asistente" en sus
 * módulos, el chat le daría 403). En móvil queda por encima de la barra inferior (bottom-20);
 * en escritorio, bottom-6. z-50 por encima de la nav inferior (z-40). */
export function AsistenteChat() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // Corrección 2026-11-23 (QA, opción B): el cliente vinculado ya no
  // tiene "asistente" en sus módulos (Agente 2 lo quita de
  // MODULOS_CLIENTE) y el backend le deniega el chat (403, B1); el FAB
  // no debe abrirle un chat que no puede usar. Mismo GET
  // /api/acceso/perfil que consume ModuleNav. F2-11 (2026-11-24): el FAB
  // se muestra desde el primer render aunque el perfil aún cargue; solo
  // se oculta cuando el perfil resuelve a cliente. Sin sesión no hay
  // cliente vinculado posible: se muestra como hoy.
  const [perfil, setPerfil] = useState<"loading" | "admin" | "prueba" | "cliente" | "invitado">(() =>
    getToken() ? "loading" : "prueba",
  );
  // M-6 (2026-11-26): nº de preguntas por enseñar (solo admin), para el
  // enlace del header del flotante. Se pide al abrir el panel.
  const [preguntasCount, setPreguntasCount] = useState<number | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    api
      .getPerfil()
      .then((p) => {
        if (cancelled) return;
        setPerfil(p.role === "super_admin" || p.role === "admin" ? "admin" : p.role);
      })
      .catch(() => {
        if (cancelled) return;
        // Invitado sin perfil (backend aún sin invitado): el FAB se
        // muestra igual; el chat con token invitado es de solo lectura.
        setPerfil(isGuest() ? "invitado" : "prueba");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // F2-11 (chat-potencia): el FAB se muestra desde el primer render,
  // sin esperar a que resuelva GET /api/acceso/perfil; el permiso se
  // resuelve al abrir (y el backend sigue siendo la autoridad: un
  // cliente vinculado recibe 403 al usar el chat). Si el perfil resuelve
  // a cliente con el panel abierto, se cierra.
  useEffect(() => {
    if (open && perfil === "cliente") setOpen(false);
  }, [open, perfil]);
  // TBT-Herramientas, FASE 2 (2026-11-24, A-1): la sección Herramientas
  // abre este chat flotante con un evento (growbusiness:open-asistente)
  // desde su bloque «pregunta gratis». No se crea un chat nuevo: es
  // este mismo panel, que ya existe en el layout raíz.
  useEffect(() => {
    if (!open || perfil !== "admin") return;
    let cancelled = false;
    listPreguntas()
      .then((ps) => {
        if (!cancelled) setPreguntasCount(ps.length);
      })
      .catch(() => {
        if (!cancelled) setPreguntasCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, perfil]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_ASISTENTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASISTENTE_EVENT, onOpen);
  }, []);
  // al input del chat; Tab cicla dentro del panel; al cerrar, el foco
  // vuelve al botón flotante. Escape también cierra.
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      fabRef.current?.focus();
    };
  }, [open ]);

  if (pathname === "/login" || pathname === "/asistente") return null;
  // Cliente vinculado (perfil ya resuelto): sin FAB ni panel. Mientras el
  // perfil carga ("loading") el FAB ya se muestra (F2-11).
  if (perfil === "cliente") return null;

  return (
    <>
      {open && (
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={t.asistente.title}
          className="fixed inset-x-4 bottom-28 z-50 flex h-[min(70dvh,560px)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[380px]"
        >
          <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <span className="text-emerald-400">
                <ChatIcon size={18} />
              </span>
              {t.asistente.title}
            </h2>
            <div className="flex items-center gap-1">
              {perfil === "admin" && preguntasCount !== null && preguntasCount > 0 && (
                <Link
                  href="/asistente"
                  onClick={() => setOpen(false)}
                  className="min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  {t.asistente.teachLink.replace("{n}", String(preguntasCount))}
                </Link>
              )}
              <Link
                href="/asistente"
                onClick={() => setOpen(false)}
                className="min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {t.asistente.openFullPage}
              </Link>
              <button
                type="button"
                aria-label={t.asistente.closeAria}
                onClick={() => setOpen(false)}
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <span aria-hidden="true" className="text-lg leading-none">×</span>
              </button>
            </div>
          </header>
          <AsistenteChatBody />
        </section>
      )}
      <button
        ref={fabRef}
        type="button"
        aria-label={open ? t.asistente.closeAria : t.asistente.openAria}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-700 text-white shadow-2xl ring-4 ring-zinc-900/60 transition-transform hover:scale-105 hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:bottom-6 sm:right-6"
      >
        {open ? (
          <span aria-hidden="true" className="text-2xl leading-none">×</span>
        ) : (
          <ChatIcon size={26} />
        )}
      </button>
    </>
  );
}

/** Variante de página completa para /asistente (dentro de ModuleShell).
 * Debajo del chat va la bandeja "Preguntas por enseñar", solo-admin
 * (el componente se oculta solo si no eres admin). */
export function AsistentePanel() {
  return (
    <div className="space-y-4">
      <div className="flex h-[70dvh] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
        <AsistenteChatBody />
      </div>
      <PreguntasEnsenar />
    </div>
  );
}
