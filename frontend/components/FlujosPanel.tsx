"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MeResponse } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { useConfirm } from "./ui";

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

/** crypto.randomUUID() con respaldo local: los IDs de nodo/arista deben ser
 * únicos entre duplicados (M-9); Date.now()+Math.random podía colisionar. */
const uid = () => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Sin contexto seguro: cae al generador local.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const fill = (tpl: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), tpl);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:opacity-50";

const btnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-50";

const primaryBtnCls =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-50";

/** Límites del validador de `grow-flows` (A-3): un volcado corrupto o
 * manipulado no debe romper el lienzo ni colgar la UI. */
const MAX_FLOWS = 50;
const MAX_NODES_PER_FLOW = 200;
const MAX_EDGES_PER_FLOW = 200;
const MAX_TEXT_LEN = 200;
const MAX_VALUE_LEN = 500;
const MAX_STORAGE_BYTES = 1_000_000;

const NODE_TYPES: FlowNodeType[] = ["trigger", "action", "condition", "delay"];

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isShortStr = (v: unknown, max = MAX_TEXT_LEN): v is string => typeof v === "string" && v.length <= max;

/** Valida un nodo guardado: type/module/event en los vocabularios conocidos,
 * x/y/seconds finitos y en rango (se sujetan con clamp), textos acotados.
 * Lo inválido se descarta (devuelve null). */
function validateNode(raw: unknown): FlowNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (!isShortStr(n.id) || n.id.trim() === "") return null;
  if (typeof n.type !== "string" || !(NODE_TYPES as string[]).includes(n.type)) return null;
  const type = n.type as FlowNodeType;
  if (!isFiniteNum(n.x) || !isFiniteNum(n.y) || !isFiniteNum(n.seconds)) return null;
  if (typeof n.module !== "string" || !(MODULE_IDS as readonly string[]).includes(n.module)) return null;
  const module = n.module as string;
  if (typeof n.event !== "string" || !isShortStr(n.event)) return null;
  if (type === "trigger" && !(TRIGGER_EVENTS[module] ?? []).includes(n.event)) return null;
  if (type === "action" && !(MODULE_ACTIONS[module] ?? []).includes(n.event)) return null;
  if (!isShortStr(n.label) || !isShortStr(n.value, MAX_VALUE_LEN)) return null;
  if (typeof n.field !== "string" || !CONDITION_FIELDS.includes(n.field)) return null;
  if (typeof n.operator !== "string" || !OPERATORS.includes(n.operator)) return null;
  return {
    id: n.id,
    type,
    x: clamp(n.x, 0, CANVAS_W - NODE_W),
    y: clamp(n.y, 0, CANVAS_H - 110),
    module,
    event: n.event,
    label: n.label,
    field: n.field,
    operator: n.operator,
    value: n.value,
    seconds: clamp(n.seconds, 0, 86400),
  };
}

function validateEdge(raw: unknown, nodeIds: Set<string>): FlowEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!isShortStr(e.id) || e.id.trim() === "") return null;
  if (typeof e.from !== "string" || typeof e.to !== "string") return null;
  if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) return null;
  return { id: e.id, from: e.from, to: e.to };
}

/** Valida la lista completa de `grow-flows`; devuelve los flujos válidos y
 * cuántos elementos (flujos/nodos/aristas) se descartaron por inválidos. */
function validateSavedFlows(parsed: unknown): { flows: SavedFlow[]; discarded: number } {
  let discarded = 0;
  // Corrección QA 2026-11-10 nº 3: si lo guardado no es un array (p. ej.
  // `{}` o `"null"`), también cuenta como descartado para que aparezca el
  // aviso ámbar en vez de un lienzo vacío silencioso. `null` es
  // localStorage vacío (sin nada que avisar).
  if (!Array.isArray(parsed)) return { flows: [], discarded: parsed === null ? 0 : 1 };
  const flows: SavedFlow[] = [];
  for (const raw of parsed.slice(0, MAX_FLOWS)) {
    if (!raw || typeof raw !== "object") {
      discarded++;
      continue;
    }
    const f = raw as Record<string, unknown>;
    if (
      !isShortStr(f.id) ||
      (f.id as string).trim() === "" ||
      !isShortStr(f.name) ||
      typeof f.updatedAt !== "string" ||
      !Array.isArray(f.nodes) ||
      !Array.isArray(f.edges)
    ) {
      discarded++;
      continue;
    }
    const nodes: FlowNode[] = [];
    const seenNodeIds = new Set<string>();
    for (const rn of (f.nodes as unknown[]).slice(0, MAX_NODES_PER_FLOW)) {
      const n = validateNode(rn);
      if (!n || seenNodeIds.has(n.id)) {
        discarded++;
        continue;
      }
      seenNodeIds.add(n.id);
      nodes.push(n);
    }
    if (f.nodes.length > MAX_NODES_PER_FLOW) discarded += f.nodes.length - MAX_NODES_PER_FLOW;
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: FlowEdge[] = [];
    const seenEdgeIds = new Set<string>();
    for (const re of (f.edges as unknown[]).slice(0, MAX_EDGES_PER_FLOW)) {
      const e = validateEdge(re, nodeIds);
      if (!e || seenEdgeIds.has(e.id)) {
        discarded++;
        continue;
      }
      seenEdgeIds.add(e.id);
      edges.push(e);
    }
    if (f.edges.length > MAX_EDGES_PER_FLOW) discarded += f.edges.length - MAX_EDGES_PER_FLOW;
    flows.push({ id: f.id as string, name: f.name as string, nodes, edges, updatedAt: f.updatedAt as string });
  }
  if (parsed.length > MAX_FLOWS) discarded += parsed.length - MAX_FLOWS;
  return { flows, discarded };
}

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { confirm, dialog } = useConfirm(t);

  const dragRef = useRef<{
    id: string;
    pointerId: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  // Throttle de arrastre (C-2 ligera): como mucho 1 setNodes por frame.
  const rafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ id: string; x: number; y: number } | null>(null);

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
  // Validación estricta (A-3): lo inválido se descarta y se avisa.
  useEffect(() => {
    let saved: SavedFlow[] = [];
    let discarded = 0;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && raw.length > MAX_STORAGE_BYTES) {
        // Volcado gigante o corrupto: no se intenta ni parsear.
        discarded = 1;
      } else {
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        const v = validateSavedFlows(parsed);
        saved = v.flows;
        discarded = v.discarded;
      }
    } catch {
      saved = [];
      discarded = 1;
    }
    if (discarded > 0) setLoadWarning(fill(t.flujos.invalidDiscarded, { n: String(discarded) }));
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

  /** Devuelve false si el guardado falló (M-4): el llamador debe avisar,
   * nunca anunciar éxito. */
  const persist = (next: SavedFlow[]): boolean => {
    setFlows(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return true;
    } catch {
      // Almacenamiento lleno o bloqueado: el flujo queda solo en memoria.
      return false;
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

  const updateNode = (id: string, patch: Partial<FlowNode>) => {
    if (!isAdmin) return;
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };

  const deleteNode = async (id: string) => {
    if (!isAdmin) return;
    if (!(await confirm(t.flujos.confirmDeleteNode))) return;
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (selectedId === id) setSelectedId(null);
    if (pendingFrom === id) setPendingFrom(null);
  };

  const deleteEdge = async (id: string) => {
    if (!isAdmin) return;
    if (!(await confirm(t.flujos.confirmDeleteEdge))) return;
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
    if (!d.moved) return;
    // Throttle con requestAnimationFrame: guardar la última posición y
    // aplicar como mucho 1 setNodes por frame, no 1 por evento.
    pendingDragRef.current = { id: node.id, x: nx, y: ny };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = pendingDragRef.current;
      pendingDragRef.current = null;
      if (p) updateNode(p.id, { x: p.x, y: p.y });
    });
  };

  // Al soltar, aplicar la última posición pendiente para no perder el
  // tramo final del arrastre (el frame siguiente no llegaría).
  const flushPendingDrag = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const p = pendingDragRef.current;
    pendingDragRef.current = null;
    if (p) updateNode(p.id, { x: p.x, y: p.y });
  };

  const onNodePointerUp = (e: React.PointerEvent<HTMLDivElement>, node: FlowNode) => {
    const d = dragRef.current;
    if (d && d.id === node.id && d.pointerId === e.pointerId) {
      if (!d.moved) setSelectedId(node.id);
      else flushPendingDrag();
      dragRef.current = null;
    }
  };

  // Si el panel se desmonta a mitad de arrastre, no dejar un frame vivo.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const edgePath = (a: FlowNode, b: FlowNode) => {
    const x1 = a.x + NODE_W;
    const y1 = a.y + PORT_Y;
    const x2 = b.x;
    const y2 = b.y + PORT_Y;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  // Mapa id→nodo y trazado de cada arista, memoizados: el render del lienzo
  // ya no hace find() lineal ni recalcula el `d` dos veces por arista.
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgePaths = useMemo(
    () =>
      edges
        .map((e) => {
          const a = nodeById.get(e.from);
          const b = nodeById.get(e.to);
          return a && b ? { id: e.id, d: edgePath(a, b) } : null;
        })
        .filter((x): x is { id: string; d: string } => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edges, nodeById],
  );

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
    setSaveError(null);
  };

  const saveFlow = () => {
    if (!isAdmin) return;
    const name = flowName.trim() === "" ? t.flujos.untitled : flowName.trim();
    const now = new Date().toISOString();
    const id = currentId ?? uid();
    const flow: SavedFlow = { id, name, nodes, edges, updatedAt: now };
    const next = currentId ? flows.map((f) => (f.id === currentId ? flow : f)) : [...flows, flow];
    if (!persist(next)) {
      setSaveError(t.flujos.msgSaveFailed);
      return;
    }
    setSaveError(null);
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
    setSaveError(null);
  };

  const duplicateFlow = (f: SavedFlow) => {
    if (!isAdmin) return;
    const name = `${f.name}${t.flujos.copySuffix}`;
    // Clonación profunda con IDs nuevos (M-9): la copia no comparte nodos
    // ni aristas con el original; se remapean from/to a los nuevos IDs.
    const idMap = new Map<string, string>();
    const nodes = f.nodes.map((n) => {
      const id = uid();
      idMap.set(n.id, id);
      return { ...n, id };
    });
    const edges = f.edges.map((e) => ({
      ...e,
      id: uid(),
      from: idMap.get(e.from) ?? e.from,
      to: idMap.get(e.to) ?? e.to,
    }));
    const copy: SavedFlow = { id: uid(), name, nodes, edges, updatedAt: new Date().toISOString() };
    if (!persist([...flows, copy])) {
      setSaveError(t.flujos.msgSaveFailed);
      return;
    }
    setSaveError(null);
    setMsg(fill(t.flujos.msgDuplicated, { nombre: name }));
  };

  const removeFlow = async (f: SavedFlow) => {
    if (!isAdmin) return;
    if (!(await confirm(fill(t.flujos.confirmDeleteFlow, { nombre: f.name })))) return;
    if (!persist(flows.filter((x) => x.id !== f.id))) {
      setSaveError(t.flujos.msgSaveFailed);
      return;
    }
    setSaveError(null);
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
      {dialog}
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
        {saveError && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {saveError}
          </p>
        )}
        {loadWarning && (
          <p role="alert" className="mt-3 rounded-lg border border-amber-800/60 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-amber-300">
            {loadWarning}
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
                {edgePaths.map((ep) => (
                  <g key={ep.id}>
                    <path d={ep.d} fill="none" stroke="#52525b" strokeWidth={2} markerEnd="url(#flujos-arrow)" />
                    <path
                      d={ep.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      className="pointer-events-auto cursor-pointer"
                      onClick={() => deleteEdge(ep.id)}
                    >
                      <title>{t.flujos.edgeDeleteTitle}</title>
                    </path>
                  </g>
                ))}
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
                  {/* Puerto de entrada: zona táctil de 44 px (hit-area
                      invisible mayor); el punto visible sigue en 14 px,
                      centrado en el mismo punto (x=0, y=34). */}
                  <button
                    type="button"
                    aria-label={t.flujos.portInAria}
                    title={t.flujos.portInAria}
                    className="group absolute -left-[22px] top-[12px] flex h-11 w-11 items-center justify-center rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onInPort(node);
                    }}
                    disabled={!isAdmin}
                  >
                    <span aria-hidden="true" className={`h-3.5 w-3.5 rounded-full border-2 border-zinc-950 ${pendingFrom ? "bg-sky-400" : "bg-zinc-400"} group-hover:bg-sky-300`} />
                  </button>
                  <button
                    type="button"
                    aria-label={t.flujos.portOutAria}
                    title={t.flujos.portOutAria}
                    className="group absolute -right-[22px] top-[12px] flex h-11 w-11 items-center justify-center rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 disabled:cursor-not-allowed"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOutPort(node);
                    }}
                    disabled={!isAdmin}
                  >
                    <span aria-hidden="true" className={`h-3.5 w-3.5 rounded-full border-2 border-zinc-950 ${pendingFrom === node.id ? "bg-amber-400" : "bg-zinc-400"} group-hover:bg-amber-300`} />
                  </button>
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
