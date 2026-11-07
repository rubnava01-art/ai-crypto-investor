"use client";

import { useEffect, useRef, useState } from "react";
import { api, type MeResponse } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";

/** Flujos (2026-11-06): constructor visual de automatizaciones estilo
 * Make.com, 100 % en el navegador. Los flujos se guardan en
 * localStorage (`grow-flows`); no hay backend, no hay endpoint y la
 * ejecución es SOLO simulación: nunca se envía un correo, nunca se crea
 * una orden ni una factura, nunca se mueve dinero. Los nodos solo
 * referencian los módulos reales de la plataforma por etiqueta. Crear
 * y editar es solo del administrador; el rol Prueba ve la lista de
 * flujos guardados y puede correr la simulación (solo lectura). */

const STORAGE_KEY = "grow-flows";
const CANVAS_W = 1200;
const CANVAS_H = 560;
const NODE_W = 208;
const PORT_Y = 34;

type FlowNodeType = "trigger" | "action" | "condition" | "delay";

interface FlowNode {
  id: string;
  type: FlowNodeType;
  x: number;
  y: number;
  /** Módulo de la plataforma (etiqueta, no integración en vivo). */
  module: string;
  /** Clave i18n del evento/acción (evt… / act…) dentro de t.flujos. */
  event: string;
  label: string;
  /** Condición: campo, operador y valor a comparar. */
  field: string;
  operator: string;
  value: string;
  /** Espera: segundos (simulados). */
  seconds: number;
}

interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

interface SavedFlow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  updatedAt: string;
}

const MODULE_IDS = [
  "crm",
  "correos",
  "invertir",
  "estudiar",
  "crear",
  "facturas",
  "inventario",
  "talento",
  "analisis",
  "espacio",
] as const;

const MODULE_LABEL_KEY: Record<string, string> = {
  crm: "modCrm",
  correos: "modCorreos",
  invertir: "modInvertir",
  estudiar: "modEstudiar",
  crear: "modCrear",
  facturas: "modFacturas",
  inventario: "modInventario",
  talento: "modTalento",
  analisis: "modAnalisis",
  espacio: "modEspacio",
};

/** Eventos que un módulo puede desencadenar (etiquetas, no webhooks). */
const TRIGGER_EVENTS: Record<string, string[]> = {
  crm: ["evtCrmNuevo", "evtCrmEtiquetado"],
  correos: ["evtCorreosRecibido"],
  invertir: ["evtInvertirSenal"],
  estudiar: ["evtEstudiarVideo", "evtEstudiarManual"],
  crear: ["evtCrearMockup"],
  facturas: ["evtFacturasCreada"],
  inventario: ["evtInventarioStock"],
  talento: ["evtTalentoNuevo"],
  analisis: ["evtAnalisisReporte"],
  espacio: ["evtEspacioRevelacion"],
};

/** Acciones que un módulo puede hacer (etiquetas, nunca se ejecutan). */
const MODULE_ACTIONS: Record<string, string[]> = {
  correos: ["actCorreosEnviar"],
  crm: ["actCrmEtiquetar"],
  crear: ["actCrearMockup"],
  facturas: ["actFacturasCrear"],
  invertir: ["actInvertirRevisar"],
  estudiar: ["actEstudiarPublicar"],
  inventario: ["actInventarioPedir"],
  talento: ["actTalentoAvisar"],
  analisis: ["actAnalisisGenerar"],
  espacio: ["actEspacioRegistrar"],
};

const CONDITION_FIELDS = ["fieldEstado", "fieldEtiqueta", "fieldMonto", "fieldStock", "fieldCantidad"];
const OPERATORS = ["=", "≠", ">", "<", "opContains"];

const TYPE_CHIP: Record<FlowNodeType, string> = {
  trigger: "bg-emerald-500/15 text-emerald-400",
  action: "bg-sky-500/15 text-sky-400",
  condition: "bg-amber-500/15 text-amber-400",
  delay: "bg-violet-500/15 text-violet-400",
};

const TYPE_DOT: Record<FlowNodeType, string> = {
  trigger: "bg-emerald-400",
  action: "bg-sky-400",
  condition: "bg-amber-400",
  delay: "bg-violet-400",
};

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const fill = (tpl: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), tpl);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:opacity-50";

const btnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-50";

const primaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-50";

export function FlujosPanel() {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  const [flows, setFlows] = useState<SavedFlow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState("");
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [simLog, setSimLog] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const dragRef = useRef<{
    id: string;
    pointerId: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);

  const typeLabel = (type: FlowNodeType) =>
    type === "trigger"
      ? t.flujos.typeTrigger
      : type === "action"
        ? t.flujos.typeAction
        : type === "condition"
          ? t.flujos.typeCondition
          : t.flujos.typeDelay;

  const moduleLabel = (id: string) => t.flujos[MODULE_LABEL_KEY[id]] ?? id;

  /** Plantilla inicial: nuevo contacto en CRM → enviar correo. */
  const starterNodes = (): { nodes: FlowNode[]; edges: FlowEdge[] } => {
    const a: FlowNode = {
      id: uid(),
      type: "trigger",
      x: 40,
      y: 120,
      module: "crm",
      event: "evtCrmNuevo",
      label: `${t.flujos.typeTrigger} 1`,
      field: "fieldEstado",
      operator: "=",
      value: "",
      seconds: 60,
    };
    const b: FlowNode = {
      id: uid(),
      type: "action",
      x: 380,
      y: 120,
      module: "correos",
      event: "actCorreosEnviar",
      label: `${t.flujos.typeAction} 1`,
      field: "fieldEstado",
      operator: "=",
      value: "",
      seconds: 60,
    };
    return { nodes: [a, b], edges: [{ id: uid(), from: a.id, to: b.id }] };
  };

  useEffect(() => {
    api
      .me()
      .then((v) => {
        if (!isCancelled()) setMe(v);
      })
      .catch(() => {
        if (!isCancelled()) setMe(null);
      });
  }, [isCancelled]);

  // Carga inicial desde localStorage (solo navegador, sin servidor).
  useEffect(() => {
    let saved: SavedFlow[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        saved = parsed.filter(
          (f): f is SavedFlow =>
            !!f && typeof f === "object" && typeof (f as SavedFlow).id === "string" && Array.isArray((f as SavedFlow).nodes) && Array.isArray((f as SavedFlow).edges),
        );
      }
    } catch {
      saved = [];
    }
    setFlows(saved);
    if (saved.length > 0) {
      const latest = [...saved].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      setCurrentId(latest.id);
      setFlowName(latest.name);
      setNodes(latest.nodes);
      setEdges(latest.edges);
    } else {
      const s = starterNodes();
      setNodes(s.nodes);
      setEdges(s.edges);
    }
    setLoaded(true);
    // Solo al montar: la plantilla usa el idioma inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next: SavedFlow[]) => {
    setFlows(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Almacenamiento lleno o bloqueado: el flujo queda en memoria.
    }
  };

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const pendingNode = pendingFrom ? nodes.find((n) => n.id === pendingFrom) ?? null : null;

  const nodeSubtitle = (n: FlowNode) => {
    if (n.type === "condition") {
      const op = n.operator === "opContains" ? t.flujos.opContains : n.operator;
      return `${t.flujos[n.field] ?? n.field} ${op} ${n.value.trim() === "" ? "…" : n.value}`;
    }
    if (n.type === "delay") return `${n.seconds} s`;
    return `${moduleLabel(n.module)} · ${t.flujos[n.event] ?? n.event}`;
  };

  const addNode = (type: FlowNodeType) => {
    if (!isAdmin) return;
    const count = nodes.filter((n) => n.type === type).length + 1;
    const slot = nodes.length;
    const node: FlowNode = {
      id: uid(),
      type,
      x: clamp(40 + (slot % 4) * 260, 0, CANVAS_W - NODE_W),
      y: clamp(60 + Math.floor(slot / 4) * 150, 0, CANVAS_H - 110),
      module: type === "trigger" ? "crm" : type === "action" ? "correos" : "crm",
      event:
        type === "trigger"
          ? TRIGGER_EVENTS.crm[0]
          : type === "action"
            ? MODULE_ACTIONS.correos[0]
            : "evtCrmNuevo",
      label: `${typeLabel(type)} ${count}`,
      field: "fieldEstado",
      operator: "=",
      value: "",
      seconds: 60,
    };
    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
    setMsg(null);
  };

  const updateNode = (id: string, patch: Partial<FlowNode>) =>
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const deleteNode = (id: string) => {
    if (!isAdmin) return;
    if (!window.confirm(t.flujos.confirmDeleteNode)) return;
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (selectedId === id) setSelectedId(null);
    if (pendingFrom === id) setPendingFrom(null);
  };

  const deleteEdge = (id: string) => {
    if (!isAdmin) return;
    if (!window.confirm(t.flujos.confirmDeleteEdge)) return;
    setEdges((prev) => prev.filter((e) => e.id !== id));
  };

  const onOutPort = (node: FlowNode) => {
    if (!isAdmin) return;
    setPendingFrom((prev) => (prev === node.id ? null : node.id));
  };

  const onInPort = (node: FlowNode) => {
    if (!isAdmin) return;
    if (!pendingFrom || pendingFrom === node.id) return;
    setEdges((prev) => {
      if (prev.some((e) => e.from === pendingFrom && e.to === node.id)) return prev;
      return [...prev, { id: uid(), from: pendingFrom, to: node.id }];
    });
    setPendingFrom(null);
  };

  // Arrastre por puntero sobre el lienzo (solo admin).
  const onNodePointerDown = (e: React.PointerEvent<HTMLDivElement>, node: FlowNode) => {
    e.stopPropagation();
    if (!isAdmin) return;
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { id: node.id, pointerId: e.pointerId, dx: e.clientX - node.x, dy: e.clientY - node.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onNodePointerMove = (e: React.PointerEvent<HTMLDivElement>, node: FlowNode) => {
    const d = dragRef.current;
    if (!d || d.id !== node.id || d.pointerId !== e.pointerId) return;
    const nx = clamp(e.clientX - d.dx, 0, CANVAS_W - NODE_W);
    const ny = clamp(e.clientY - d.dy, 0, CANVAS_H - 110);
    if (Math.abs(nx - node.x) + Math.abs(ny - node.y) > 4) d.moved = true;
    if (d.moved) updateNode(node.id, { x: nx, y: ny });
  };

  const onNodePointerUp = (e: React.PointerEvent<HTMLDivElement>, node: FlowNode) => {
    const d = dragRef.current;
    if (d && d.id === node.id && d.pointerId === e.pointerId) {
      if (!d.moved) setSelectedId(node.id);
      dragRef.current = null;
    }
  };

  const edgePath = (a: FlowNode, b: FlowNode) => {
    const x1 = a.x + NODE_W;
    const y1 = a.y + PORT_Y;
    const x2 = b.x;
    const y2 = b.y + PORT_Y;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const newFlow = () => {
    if (!isAdmin) return;
    const s = starterNodes();
    setCurrentId(null);
    setFlowName("");
    setNodes(s.nodes);
    setEdges(s.edges);
    setSelectedId(null);
    setPendingFrom(null);
    setSimLog([]);
    setMsg(null);
  };

  const saveFlow = () => {
    if (!isAdmin) return;
    const name = flowName.trim() === "" ? t.flujos.untitled : flowName.trim();
    const now = new Date().toISOString();
    const id = currentId ?? uid();
    const flow: SavedFlow = { id, name, nodes, edges, updatedAt: now };
    const next = currentId ? flows.map((f) => (f.id === currentId ? flow : f)) : [...flows, flow];
    persist(next);
    setCurrentId(id);
    setFlowName(name);
    setMsg(fill(t.flujos.msgSaved, { nombre: name }));
  };

  const loadFlow = (f: SavedFlow) => {
    setCurrentId(f.id);
    setFlowName(f.name);
    setNodes(f.nodes);
    setEdges(f.edges);
    setSelectedId(null);
    setPendingFrom(null);
    setSimLog([]);
    setMsg(null);
  };

  const duplicateFlow = (f: SavedFlow) => {
    if (!isAdmin) return;
    const name = `${f.name}${t.flujos.copySuffix}`;
    const copy: SavedFlow = { id: uid(), name, nodes: f.nodes, edges: f.edges, updatedAt: new Date().toISOString() };
    persist([...flows, copy]);
    setMsg(fill(t.flujos.msgDuplicated, { nombre: name }));
  };

  const removeFlow = (f: SavedFlow) => {
    if (!isAdmin) return;
    if (!window.confirm(fill(t.flujos.confirmDeleteFlow, { nombre: f.name }))) return;
    persist(flows.filter((x) => x.id !== f.id));
    if (currentId === f.id) newFlow();
    setMsg(fill(t.flujos.msgDeleted, { nombre: f.name }));
  };

  /** Recorre el flujo en orden (desencadenadores → conexiones) y escribe
   * el registro SIMULADO. No llama a ningún servicio ni ejecuta nada. */
  const runSimulation = () => {
    if (nodes.length === 0) {
      setSimLog([t.flujos.simNoNodes]);
      return;
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, string[]>();
    edges.forEach((e) => {
      if (byId.has(e.from) && byId.has(e.to)) {
        outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e.to]);
      }
    });
    const order: FlowNode[] = [];
    const seen = new Set<string>();
    const visit = (n: FlowNode) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      order.push(n);
      (outgoing.get(n.id) ?? []).forEach((id) => {
        const next = byId.get(id);
        if (next) visit(next);
      });
    };
    nodes.filter((n) => n.type === "trigger").forEach(visit);
    const orphans = nodes.filter((n) => !seen.has(n.id));
    orphans.forEach(visit);

    const lines: string[] = [fill(t.flujos.simStart, { nombre: flowName.trim() === "" ? t.flujos.untitled : flowName.trim() })];
    orphans.forEach((n) => lines.push(fill(t.flujos.simOrphan, { etiqueta: n.label })));
    order.forEach((n) => {
      if (n.type === "trigger") {
        lines.push(fill(t.flujos.simTrigger, { etiqueta: n.label, modulo: moduleLabel(n.module), evento: t.flujos[n.event] ?? n.event }));
      } else if (n.type === "action") {
        lines.push(fill(t.flujos.simAction, { etiqueta: n.label, modulo: moduleLabel(n.module), accion: t.flujos[n.event] ?? n.event }));
      } else if (n.type === "condition") {
        const op = n.operator === "opContains" ? t.flujos.opContains : n.operator;
        lines.push(
          fill(t.flujos.simCondition, { etiqueta: n.label, campo: t.flujos[n.field] ?? n.field, operador: op, valor: n.value.trim() === "" ? "…" : n.value }),
        );
      } else {
        lines.push(fill(t.flujos.simDelay, { etiqueta: n.label, segundos: String(n.seconds) }));
      }
    });
    lines.push(t.flujos.simEnd);
    setSimLog(lines);
  };

  const palette: { type: FlowNodeType; hint: string }[] = [
    { type: "trigger", hint: t.flujos.typeTriggerHint },
    { type: "action", hint: t.flujos.typeActionHint },
    { type: "condition", hint: t.flujos.typeConditionHint },
    { type: "delay", hint: t.flujos.typeDelayHint },
  ];

  return (
    <div className="space-y-4">
      <Panel title={t.flujos.panelTitle}>
        <p className="text-sm leading-relaxed text-zinc-400">
          {t.flujos.intro}
          {isAdmin ? t.flujos.introAdmin : t.flujos.introViewer}
        </p>
        <p className="mt-3 rounded-lg border border-amber-800/60 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-amber-300">
          {t.flujos.simOnly}
        </p>
      </Panel>

      <Panel title={t.flujos.savedTitle}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t.flujos.flowNameAria}</span>
            <input
              className={inputCls}
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              placeholder={t.flujos.flowNamePlaceholder}
              aria-label={t.flujos.flowNameAria}
              disabled={!isAdmin}
            />
          </label>
          <button type="button" className={primaryBtnCls} onClick={saveFlow} disabled={!isAdmin}>
            {t.flujos.saveFlow}
          </button>
          <button type="button" className={btnCls} onClick={newFlow} disabled={!isAdmin}>
            {t.flujos.newFlow}
          </button>
        </div>
        {msg && (
          <p role="status" className="mt-3 text-sm text-emerald-400">
            {msg}
          </p>
        )}
        {!loaded ? (
          <p className="mt-4 text-sm text-zinc-400">{t.common.loading}</p>
        ) : flows.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">{t.flujos.emptyFlows}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {flows.map((f) => (
              <li
                key={f.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 ${
                  f.id === currentId ? "border-amber-500/60 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-100">{f.name}</span>
                  <span className="block text-xs text-zinc-500">
                    {fill(t.flujos.updatedAt, {
                      fecha: new Date(f.updatedAt).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }),
                    })}
                    {` · ${f.nodes.length} · ${f.edges.length}`}
                  </span>
                </span>
                <button type="button" className={btnCls} onClick={() => loadFlow(f)}>
                  {t.flujos.load}
                </button>
                <button type="button" className={btnCls} onClick={() => duplicateFlow(f)} disabled={!isAdmin}>
                  {t.flujos.duplicate}
                </button>
                <button type="button" className={btnCls} onClick={() => removeFlow(f)} disabled={!isAdmin}>
                  {t.flujos.delete}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title={t.flujos.panelTitle}>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label={t.flujos.paletteTitle}>
            {palette.map((p) => (
              <button
                key={p.type}
                type="button"
                className="rounded-lg border border-zinc-700 px-3 py-2.5 text-left hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => addNode(p.type)}
                disabled={!isAdmin}
              >
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_CHIP[p.type]}`}>
                  <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${TYPE_DOT[p.type]}`} />
                  {typeLabel(p.type)}
                </span>
                <span className="mt-1.5 block text-xs leading-snug text-zinc-400">{p.hint}</span>
              </button>
            ))}
          </div>

          {pendingNode && (
            <p role="status" className="mb-3 rounded-lg border border-sky-800/60 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">
              {fill(t.flujos.connectHint, { nombre: pendingNode.label })}
            </p>
          )}

          <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
            <div
              className="relative"
              style={{ width: CANVAS_W, height: CANVAS_H }}
              role="application"
              aria-label={t.flujos.canvasAria}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedId(null);
                  setPendingFrom(null);
                }
              }}
            >
              <svg className="pointer-events-none absolute inset-0" width={CANVAS_W} height={CANVAS_H} aria-hidden="true">
                <defs>
                  <marker id="flujos-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill="#71717a" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = nodes.find((n) => n.id === e.from);
                  const b = nodes.find((n) => n.id === e.to);
                  if (!a || !b) return null;
                  return (
                    <g key={e.id}>
                      <path d={edgePath(a, b)} fill="none" stroke="#52525b" strokeWidth={2} markerEnd="url(#flujos-arrow)" />
                      <path
                        d={edgePath(a, b)}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        className="pointer-events-auto cursor-pointer"
                        onClick={() => deleteEdge(e.id)}
                      >
                        <title>{t.flujos.edgeDeleteTitle}</title>
                      </path>
                    </g>
                  );
                })}
              </svg>

              {nodes.map((node) => (
                <div
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${typeLabel(node.type)}: ${node.label}`}
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                  onPointerMove={(e) => onNodePointerMove(e, node)}
                  onPointerUp={(e) => onNodePointerUp(e, node)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(node.id);
                    }
                  }}
                  className={`absolute w-[208px] select-none rounded-xl border bg-zinc-900 p-3 shadow-lg ${
                    selectedId === node.id ? "border-amber-400 ring-2 ring-amber-400/40" : "border-zinc-700"
                  } ${isAdmin ? "cursor-grab active:cursor-grabbing" : ""}`}
                  style={{ left: node.x, top: node.y, touchAction: "none" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_CHIP[node.type]}`}>
                      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${TYPE_DOT[node.type]}`} />
                      {typeLabel(node.type)}
                    </span>
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label={t.flujos.deleteNode}
                        title={t.flujos.deleteNode}
                        className="rounded-md px-1.5 py-0.5 text-sm font-bold text-zinc-400 hover:bg-zinc-800 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                        onClick={() => deleteNode(node.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-zinc-100">{node.label}</p>
                  <p className="mt-0.5 break-words text-xs leading-snug text-zinc-400">{nodeSubtitle(node)}</p>
                  <button
                    type="button"
                    aria-label={t.flujos.portInAria}
                    title={t.flujos.portInAria}
                    className={`absolute -left-[7px] top-[27px] h-3.5 w-3.5 rounded-full border-2 border-zinc-950 ${pendingFrom ? "bg-sky-400" : "bg-zinc-400"} hover:bg-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onInPort(node);
                    }}
                    disabled={!isAdmin}
                  />
                  <button
                    type="button"
                    aria-label={t.flujos.portOutAria}
                    title={t.flujos.portOutAria}
                    className={`absolute -right-[7px] top-[27px] h-3.5 w-3.5 rounded-full border-2 border-zinc-950 ${pendingFrom === node.id ? "bg-amber-400" : "bg-zinc-400"} hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:cursor-not-allowed`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOutPort(node);
                    }}
                    disabled={!isAdmin}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primaryBtnCls} onClick={runSimulation}>
              {t.flujos.runSim}
            </button>
          </div>
        </Panel>

        <Panel title={t.flujos.editorTitle}>
          {!selected ? (
            <p className="text-sm text-zinc-400">{t.flujos.noSelection}</p>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-zinc-300">{t.flujos.labelLabel}</span>
                <input
                  className={inputCls}
                  value={selected.label}
                  onChange={(e) => updateNode(selected.id, { label: e.target.value })}
                  aria-label={t.flujos.labelAria}
                  placeholder={t.flujos.labelPlaceholder}
                  disabled={!isAdmin}
                />
              </label>

              {(selected.type === "trigger" || selected.type === "action") && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-zinc-300">{t.flujos.moduleLabel}</span>
                    <select
                      className={inputCls}
                      value={selected.module}
                      onChange={(e) => {
                        const mod = e.target.value;
                        const first = selected.type === "trigger" ? TRIGGER_EVENTS[mod]?.[0] : MODULE_ACTIONS[mod]?.[0];
                        updateNode(selected.id, { module: mod, event: first ?? selected.event });
                      }}
                      disabled={!isAdmin}
                    >
                      {MODULE_IDS.map((m) => (
                        <option key={m} value={m}>
                          {moduleLabel(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-zinc-300">
                      {selected.type === "trigger" ? t.flujos.eventLabel : t.flujos.actionLabel}
                    </span>
                    <select
                      className={inputCls}
                      value={selected.event}
                      onChange={(e) => updateNode(selected.id, { event: e.target.value })}
                      disabled={!isAdmin}
                    >
                      {(selected.type === "trigger" ? TRIGGER_EVENTS[selected.module] ?? [] : MODULE_ACTIONS[selected.module] ?? []).map((ev) => (
                        <option key={ev} value={ev}>
                          {t.flujos[ev] ?? ev}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              {selected.type === "condition" && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-zinc-300">{t.flujos.fieldLabel}</span>
                    <select
                      className={inputCls}
                      value={selected.field}
                      onChange={(e) => updateNode(selected.id, { field: e.target.value })}
                      disabled={!isAdmin}
                    >
                      {CONDITION_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {t.flujos[f] ?? f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-zinc-300">{t.flujos.operatorLabel}</span>
                    <select
                      className={inputCls}
                      value={selected.operator}
                      onChange={(e) => updateNode(selected.id, { operator: e.target.value })}
                      disabled={!isAdmin}
                    >
                      {OPERATORS.map((op) => (
                        <option key={op} value={op}>
                          {op === "opContains" ? t.flujos.opContains : op}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-zinc-300">{t.flujos.valueLabel}</span>
                    <input
                      className={inputCls}
                      value={selected.value}
                      onChange={(e) => updateNode(selected.id, { value: e.target.value })}
                      placeholder={t.flujos.valuePlaceholder}
                      disabled={!isAdmin}
                    />
                  </label>
                </>
              )}

              {selected.type === "delay" && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-zinc-300">{t.flujos.secondsLabel}</span>
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    value={selected.seconds}
                    onChange={(e) => updateNode(selected.id, { seconds: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label={t.flujos.secondsAria}
                    disabled={!isAdmin}
                  />
                </label>
              )}

              <button type="button" className={btnCls} onClick={() => deleteNode(selected.id)} disabled={!isAdmin}>
                {t.flujos.deleteNode}
              </button>
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t.flujos.simTitle}>
        <p className="mb-3 rounded-lg border border-amber-800/60 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-amber-300">
          {t.flujos.simOnly}
        </p>
        {simLog.length === 0 ? (
          <p className="text-sm text-zinc-400">{t.flujos.simEmpty}</p>
        ) : (
          <ol className="space-y-1.5 font-mono text-xs leading-relaxed text-zinc-300 sm:text-sm">
            {simLog.map((line, i) => (
              <li key={`${i}-${line.slice(0, 24)}`} className="break-words rounded-md bg-zinc-950/70 px-3 py-2">
                {line}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
