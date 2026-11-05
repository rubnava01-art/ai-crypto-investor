"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/api/client";

/** Terminal de pruebas (2026-11-05): consola SIMULADA dentro de la web,
 * solo con comandos integrados seguros. No ejecuta nada en el servidor:
 * no hay endpoint de ejecución ni shell real. Los comandos `status` y
 * `health` consultan de verdad /api/health con un timeout corto y
 * reportan "API no responde" cuando la API está caída, sin inventar
 * nada. Solo administradores (entrada adminOnly en el menú). */

type LineKind = "out" | "cmd" | "err" | "ok";
type Line = { text: string; kind: LineKind };

const PROMPT = "nest@grow:~$";
const HEALTH_TIMEOUT_MS = 8000;

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

const HELP_LINES = [
  "Comandos disponibles:",
  "  help     — muestra esta lista",
  "  status   — estado de la web y de la API (en vivo)",
  "  health   — consulta /api/health y muestra el resultado",
  "  modules  — lista las rutas de la plataforma",
  "  about    — qué es esta terminal",
  "  date     — fecha y hora actual",
  "  echo …   — repite el texto",
  "  clear    — limpia la pantalla",
];

const WELCOME: Line[] = [
  { text: "Grow Business Platform — Terminal de pruebas", kind: "out" },
  { text: "Consola simulada con comandos seguros integrados. Escribe help para ver la lista.", kind: "out" },
];

/** Consulta real a /api/health con timeout corto. Nunca inventa el
 * resultado: si la API no responde, lo dice tal cual. */
async function checkHealth(): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, detail: `API responde con HTTP ${res.status}` };
    const j = (await res.json().catch(() => null)) as {
      mode?: unknown;
      version?: unknown;
      database?: unknown;
    } | null;
    const mode = typeof j?.mode === "string" ? j.mode : "?";
    const version = typeof j?.version === "string" ? j.version : "?";
    const db = typeof j?.database === "string" ? ` · base de datos: ${j.database}` : "";
    return { ok: true, detail: `API responde (ok) — modo ${mode} · versión ${version}${db}` };
  } catch {
    return { ok: false, detail: `API no responde (${API_URL})` };
  } finally {
    clearTimeout(timer);
  }
}

const LINE_CLASS: Record<LineKind, string> = {
  out: "text-emerald-300/90",
  cmd: "text-zinc-100",
  err: "text-red-400",
  ok: "text-emerald-400",
};

export function TerminalPanel() {
  const [lines, setLines] = useState<Line[]>(WELCOME);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  function push(text: string, kind: LineKind = "out") {
    setLines((prev) => [...prev, { text, kind }]);
  }

  async function run(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    push(`${PROMPT} ${trimmed}`, "cmd");
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd.toLowerCase()) {
      case "help":
        HELP_LINES.forEach((l) => push(l));
        break;
      case "clear":
        setLines([]);
        break;
      case "about":
        push("Grow Business Platform — terminal de pruebas con comandos seguros integrados.");
        break;
      case "date":
        push(new Date().toLocaleString());
        break;
      case "echo":
        push(arg);
        break;
      case "modules":
        push(`Módulos de la plataforma (${MODULES.length}):`);
        MODULES.forEach((m) => push(`  ${m.href} — ${m.label}`));
        break;
      case "health": {
        setBusy(true);
        const r = await checkHealth();
        push(r.detail, r.ok ? "ok" : "err");
        setBusy(false);
        break;
      }
      case "status": {
        push("Web: OK (esta página cargó)");
        setBusy(true);
        const r = await checkHealth();
        push(r.detail, r.ok ? "ok" : "err");
        setBusy(false);
        break;
      }
      default:
        push("Comando no reconocido. Escribe help para ver la lista.", "err");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = value;
    setValue("");
    await run(v);
    inputRef.current?.focus();
  }

  return (
    <section aria-label="Terminal de pruebas" className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
      {/* Barra de la ventana */}
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2.5">
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-red-500/80" />
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-amber-400/80" />
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-emerald-500/80" />
        <span className="ml-2 font-mono text-xs text-zinc-400">terminal — Grow Business Platform</span>
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
            disabled={busy}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="escribe help"
            aria-label="Comando de terminal"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-100 placeholder-zinc-600 caret-emerald-400 outline-none disabled:opacity-50"
          />
        </form>
      </div>
      <p className="border-t border-zinc-800 bg-zinc-900/70 px-4 py-2 text-xs leading-relaxed text-zinc-500">
        Consola simulada: solo comandos integrados seguros, sin ejecución en el servidor. Escribe help para ver la lista.
      </p>
    </section>
  );
}
