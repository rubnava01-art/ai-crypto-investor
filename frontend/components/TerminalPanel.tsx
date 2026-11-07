"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, fetchMe } from "../lib/api/client";
import { useLanguage } from "../lib/i18n";
import { novedadesSistema } from "../lib/novedades";

/** Terminal de pruebas (2026-11-05, mejoras 2026-11-06): consola SIMULADA
 * dentro de la web, solo con comandos integrados seguros. No ejecuta nada
 * en el servidor: no hay endpoint de ejecución ni shell real. Los comandos
 * `status`, `health` y `version` consultan de verdad /api/health con un
 * timeout corto y reportan "API no responde" cuando la API está caída, sin
 * inventar nada. `whoami` lee la sesión con /api/auth/me. `novedades`
 * lista los títulos de frontend/lib/novedades.ts (sin red). El historial
 * vive solo en la sesión (memoria del componente, sin localStorage ni
 * cookies): al cerrar la página se pierde. Solo administradores (entrada
 * adminOnly en el menú). */

type LineKind = "out" | "cmd" | "err" | "ok" | "head";
type Line = { text: string; kind: LineKind };

const PROMPT = "nest@grow:~$";
const HEALTH_TIMEOUT_MS = 8000;
const NOVEDADES_LIMIT = 5;

/** Rutas reales de la plataforma (copia exacta de MODULES en
 * components/ModuleNav.tsx, incluida /terminal). */
const MODULES: { href: string; label: string }[] = [
  { href: "/inicio", label: "Inicio" },
  { href: "/", label: "Invertir" },
  { href: "/estudiar", label: "Estudiar" },
  { href: "/crear", label: "Crear" },
  { href: "/analizador", label: "Analizador IA" },
  { href: "/crm", label: "Gestor de Clientes" },
  { href: "/referidos", label: "Referidos" },
  { href: "/business", label: "Business" },
  { href: "/espacio", label: "Espacio" },
  { href: "/facturas", label: "Facturas" },
  { href: "/correos", label: "Correos" },
  { href: "/chat", label: "Chat" },
  { href: "/recomendaciones", label: "Recomendaciones" },
  { href: "/desarrollo", label: "Desarrollo digital" },
  { href: "/talento", label: "Talento humano" },
  { href: "/riesgos", label: "Gestión de Riesgos" },
  { href: "/planillas", label: "Planillas" },
  { href: "/analisis", label: "Análisis de datos" },
  { href: "/tendencias", label: "Tendencias" },
  { href: "/auditor", label: "Auditor web" },
  { href: "/privacidad", label: "Privacidad" },
  { href: "/inventario", label: "Inventario" },
  { href: "/perfil", label: "Mi perfil" },
  { href: "/usuarios", label: "Control de usuarios" },
  { href: "/ajustador", label: "Ajustador" },
  { href: "/terminal", label: "Terminal" },
];

/** Sustituye {clave} en una cadena del diccionario. */
function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "?"));
}

type HealthInfo = {
  ok: boolean;
  httpStatus?: number;
  mode?: string;
  version?: string;
  database?: string;
  gitSha?: string;
  builtUtc?: string;
  timestampUtc?: string;
};

/** Consulta real a /api/health con timeout corto. Nunca inventa el
 * resultado: si la API no responde, ok=false y el llamador lo dice tal
 * cual. Devuelve los campos tal como vienen (sin rellenar valores). */
async function checkHealth(): Promise<HealthInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, httpStatus: res.status };
    const j = (await res.json().catch(() => null)) as {
      mode?: unknown;
      version?: unknown;
      database?: unknown;
      git_sha?: unknown;
      built_utc?: unknown;
      timestamp_utc?: unknown;
    } | null;
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    return {
      ok: true,
      mode: str(j?.mode),
      version: str(j?.version),
      database: str(j?.database),
      gitSha: str(j?.git_sha),
      builtUtc: str(j?.built_utc),
      timestampUtc: str(j?.timestamp_utc),
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

const LINE_CLASS: Record<LineKind, string> = {
  out: "text-emerald-300/90",
  cmd: "text-zinc-100",
  err: "text-red-400",
  ok: "text-emerald-400",
  head: "font-semibold text-zinc-100",
};

export function TerminalPanel() {
  const { t } = useLanguage();
  const tt = t.terminal;

  const welcomeLines = (): Line[] => [
    { text: tt.welcomeTitle, kind: "out" },
    { text: tt.welcomeSub, kind: "out" },
  ];

  const [lines, setLines] = useState<Line[]>(welcomeLines);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Historial de la sesión (solo memoria): nunca se persiste. */
  const historyRef = useRef<string[]>([]);
  /** Índice en el historial al navegar con ↑/↓; null = escribiendo. */
  const [histIdx, setHistIdx] = useState<number | null>(null);
  /** Texto que se estaba escribiendo antes de navegar por el historial. */
  const draftRef = useRef("");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  function push(text: string, kind: LineKind = "out") {
    setLines((prev) => [...prev, { text, kind }]);
  }

  /** Líneas agrupadas de /api/health: estado, modo, versión, base de
   * datos, git sha, compilación y hora. Sin inventar: lo que falta se
   * muestra como "?"; si la API no responde, error honesto en rojo. */
  function pushHealth(info: HealthInfo) {
    if (!info.ok) {
      if (info.httpStatus) push(fmt(tt.statusApiHttp, { status: info.httpStatus }), "err");
      else push(fmt(tt.statusApiDown, { url: API_URL }), "err");
      return;
    }
    push(tt.statusApiOk, "ok");
    push(fmt(tt.statusMode, { mode: info.mode ?? "?" }));
    push(fmt(tt.statusVersion, { version: info.version ?? "?" }));
    push(fmt(tt.statusDb, { db: info.database ?? "?" }));
    push(fmt(tt.statusSha, { sha: info.gitSha ?? "?" }));
    if (info.builtUtc) push(fmt(tt.statusBuilt, { built: info.builtUtc }));
    if (info.timestampUtc) push(fmt(tt.statusTime, { time: info.timestampUtc }));
  }

  async function run(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    push(`${PROMPT} ${trimmed}`, "cmd");
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "help":
        push(tt.helpTitle, "head");
        [
          tt.helpHelp, tt.helpStatus, tt.helpHealth, tt.helpModules, tt.helpRoutes,
          tt.helpWhoami, tt.helpVersion, tt.helpNovedades, tt.helpHistory, tt.helpBanner,
          tt.helpAbout, tt.helpDate, tt.helpEcho, tt.helpClear,
        ].forEach((l) => push(l));
        break;
      case "clear":
        setLines([]);
        break;
      case "about":
        push(tt.about);
        break;
      case "date":
        push(new Date().toLocaleString());
        break;
      case "echo":
        push(arg);
        break;
      case "modules":
        push(fmt(tt.modulesTitle, { n: MODULES.length }), "head");
        MODULES.forEach((m) => push(`  ${m.href} — ${m.label}`));
        break;
      case "routes":
        push(fmt(tt.routesTitle, { n: MODULES.length }), "head");
        MODULES.forEach((m) => push(`  ${m.href} — ${m.label}`));
        break;
      case "banner":
        welcomeLines().forEach((l) => push(l.text, l.kind));
        break;
      case "history": {
        // El propio "history" acaba de entrar al historial: no se lista.
        const entries = historyRef.current.filter(
          (h, i, arr) => !(i === arr.length - 1 && h === "history"),
        );
        if (entries.length === 0) {
          push(tt.historyEmpty);
          break;
        }
        push(fmt(tt.historyTitle, { n: entries.length }), "head");
        entries.forEach((h, i) => push(`  ${i + 1}. ${h}`));
        break;
      }
      case "novedades":
        push(tt.novedadesTitle, "head");
        if (novedadesSistema.length === 0) {
          push(tt.novedadesEmpty);
          break;
        }
        novedadesSistema.slice(0, NOVEDADES_LIMIT).forEach((n) => {
          push(`  ${n.date} — ${n.title}`);
        });
        break;
      case "whoami": {
        setBusy(true);
        try {
          const me = await fetchMe();
          push(tt.whoamiTitle, "head");
          push(fmt(tt.whoamiUser, { name: me.display_name || me.username }));
          push(fmt(tt.whoamiRole, { role: me.role }));
        } catch {
          push(tt.whoamiError, "err");
        }
        setBusy(false);
        break;
      }
      case "version": {
        setBusy(true);
        const info = await checkHealth();
        if (!info.ok) {
          push(fmt(tt.versionError, { url: API_URL }), "err");
        } else {
          push(tt.versionTitle, "head");
          push(fmt(tt.versionApp, { version: info.version ?? "?" }));
          push(fmt(tt.versionSha, { sha: info.gitSha ?? "?" }));
        }
        setBusy(false);
        break;
      }
      case "health": {
        push(tt.healthTitle, "head");
        setBusy(true);
        pushHealth(await checkHealth());
        setBusy(false);
        break;
      }
      case "status": {
        push(tt.statusTitle, "head");
        push(tt.statusWeb, "ok");
        setBusy(true);
        pushHealth(await checkHealth());
        setBusy(false);
        break;
      }
      default:
        push(tt.unknown, "err");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = value;
    setValue("");
    setHistIdx(null);
    draftRef.current = "";
    const trimmed = v.trim();
    if (trimmed) {
      // Sin duplicados seguidos; el historial vive solo en la sesión.
      const last = historyRef.current[historyRef.current.length - 1];
      if (last !== trimmed) historyRef.current.push(trimmed);
    }
    await run(v);
    inputRef.current?.focus();
  }

  /** ↑/↓ recorre el historial de la sesión; al salir por abajo se
   * restaura el texto que se estaba escribiendo. */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const h = historyRef.current;
    if (h.length === 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp") {
      if (histIdx === null) {
        draftRef.current = value;
        setHistIdx(h.length - 1);
        setValue(h[h.length - 1]);
      } else if (histIdx > 0) {
        setHistIdx(histIdx - 1);
        setValue(h[histIdx - 1]);
      }
    } else if (histIdx !== null) {
      if (histIdx < h.length - 1) {
        setHistIdx(histIdx + 1);
        setValue(h[histIdx + 1]);
      } else {
        setHistIdx(null);
        setValue(draftRef.current);
      }
    }
  }

  return (
    <section aria-label="Terminal de pruebas" className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
      {/* Barra de la ventana */}
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2.5">
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-red-500/80" />
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-amber-400/80" />
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-emerald-500/80" />
        <span className="ml-2 font-mono text-xs text-zinc-400">{tt.windowTitle}</span>
      </div>
      <div
        ref={scrollRef}
        aria-live="polite"
        onClick={() => inputRef.current?.focus()}
        className="h-96 cursor-text overflow-y-auto px-4 py-3 font-mono text-sm leading-relaxed"
      >
        {lines.map((l, i) => (
          <p key={i} className={LINE_CLASS[l.kind]} style={{ overflowWrap: "anywhere" }}>
            {l.text || " "}
          </p>
        ))}
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <label htmlFor="terminal-input" className="shrink-0 text-emerald-400">
            {PROMPT}
          </label>
          <input
            id="terminal-input"
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={tt.inputPlaceholder}
            aria-label={tt.inputAria}
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-100 placeholder-zinc-600 caret-emerald-400 outline-none disabled:opacity-50"
          />
        </form>
      </div>
      <p className="border-t border-zinc-800 bg-zinc-900/70 px-4 py-2 text-xs leading-relaxed text-zinc-500">
        {tt.footer}
      </p>
    </section>
  );
}
