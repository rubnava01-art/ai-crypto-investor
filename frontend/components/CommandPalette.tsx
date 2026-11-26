"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, isGuest } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { KEY_BY_HREF, MODULES, PRUEBA_MIN_KEYS } from "./ModuleNav";
import { GUEST_MODULES } from "../lib/api/guest";
import { filtrarBuscador, type BuscadorItem } from "../lib/buscador";
import { useDialogFocus } from "./ui";

/** Buscador global (Fase 4 mejoras-v1, tarea 4): paleta de comandos
 * Ctrl+K / Cmd+K que busca módulos, acciones frecuentes y clientes
 * del CRM, con navegación por teclado (flechas + Enter + Escape) y
 * resultados en español.
 *
 * Solo muestra lo que el perfil puede ver: los módulos se filtran con
 * el mismo conjunto que ModuleNav (perfil del backend; sin respuesta,
 * el mínimo de prueba, nunca todo). Las acciones de crear solo existen
 * para admin (el rol Prueba es de solo lectura); los clientes solo se
 * buscan si el perfil tiene el módulo CRM. Sin sesión no se monta nada
 * útil: el botón no abre la paleta. */
export function CommandPalette() {
  const router = useRouter();
  const { t } = useLanguage();
  const b = t.buscador;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [modulos, setModulos] = useState<Set<string> | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [clientes, setClientes] = useState<BuscadorItem[]>([]);
  const [buscandoClientes, setBuscandoClientes] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = "buscador-lista";

  // Perfil (mismo patrón fail-closed que ModuleNav): sin respuesta, el
  // mínimo de prueba; invitado, su conjunto fijo.
  useEffect(() => {
    let cancelled = false;
    api
      .getPerfil()
      .then((p) => {
        if (cancelled) return;
        setIsAdmin(p.role === "super_admin" || p.role === "admin");
        setModulos(new Set(p.modulos));
      })
      .catch(() => {
        if (cancelled) return;
        setIsAdmin(false);
        setModulos(new Set(isGuest() ? GUEST_MODULES : PRUEBA_MIN_KEYS));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const itemsModulos: BuscadorItem[] = useMemo(() => {
    if (!modulos) return [];
    return MODULES.filter((m) => modulos.has(KEY_BY_HREF[m.href])).map((m) => {
      const navText = t.nav[KEY_BY_HREF[m.href]];
      return {
        id: `modulo:${m.href}`,
        kind: "modulo" as const,
        titulo: navText?.label ?? m.label,
        descripcion: navText?.hint ?? m.hint,
        href: m.href,
      };
    });
  }, [modulos, t]);

  const itemsAcciones: BuscadorItem[] = useMemo(() => {
    const all: BuscadorItem[] = [
      { id: "accion:planes", kind: "accion", titulo: b.actionPlans, descripcion: "", href: "/planes" },
      { id: "accion:asistente", kind: "accion", titulo: b.actionAssistant, descripcion: "", href: "/asistente" },
      { id: "accion:inicio", kind: "accion", titulo: b.actionHome, descripcion: "", href: "/inicio" },
    ];
    if (isAdmin) {
      all.unshift(
        { id: "accion:contacto", kind: "accion", titulo: b.actionNewContact, descripcion: "", href: "/crm" },
        { id: "accion:factura", kind: "accion", titulo: b.actionNewInvoice, descripcion: "", href: "/facturas" },
        { id: "accion:tarea", kind: "accion", titulo: b.actionNewTask, descripcion: "", href: "/business" },
      );
    }
    return all;
  }, [b, isAdmin]);

  const tieneCrm = modulos?.has("crm") ?? false;

  // Clientes del CRM (solo con módulo CRM y 2+ caracteres): búsqueda con
  // debounce de 300 ms; un error deja la lista vacía sin romper la paleta.
  useEffect(() => {
    const q = query.trim();
    if (!open || !tieneCrm || q.length < 2) {
      setClientes([]);
      setBuscandoClientes(false);
      return;
    }
    setBuscandoClientes(true);
    let cancelled = false;
    const id = setTimeout(() => {
      api
        .listContacts(q)
        .then((rows) => {
          if (cancelled) return;
          setClientes(
            rows.slice(0, 5).map((c) => ({
              id: `cliente:${c.id}`,
              kind: "cliente" as const,
              titulo: c.name,
              descripcion: [c.email, c.phone].filter(Boolean).join(" · "),
              href: "/crm",
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setClientes([]);
        })
        .finally(() => {
          if (!cancelled) setBuscandoClientes(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, open, tieneCrm]);

  const resultados = useMemo(() => {
    const base = filtrarBuscador([...itemsModulos, ...itemsAcciones], query);
    // Los clientes ya vienen filtrados por el backend (q); van después
    // de módulos y acciones, sin reordenar.
    return [...base, ...clientes].slice(0, 12);
  }, [itemsModulos, itemsAcciones, clientes, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    buttonRef.current?.focus();
  }, []);

  const openPalette = useCallback(() => {
    if (!getToken()) return;
    setOpen(true);
    setQuery("");
    setActive(0);
  }, []);

  // 4.1: focus-trap + Escape + retorno de foco (antes Escape y retorno
  // sí existían, pero Tab podía salir del diálogo). El foco inicial al
  // campo lo da el hook (el input es el primer enfocable).
  useDialogFocus({ open, onEscape: close, dialogRef, initialFocusRef: inputRef });

  // Atajo global Ctrl+K / Cmd+K (no abre si se escribe en un campo).
  // Escape lo gestiona useDialogFocus (ver arriba).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (typing) return;
        if (open) close();
        else openPalette();
        return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close, openPalette]);

  // El índice activo nunca sale de la lista (al filtrar se reinicia).
  useEffect(() => {
    setActive((a) => (resultados.length === 0 ? 0 : Math.min(a, resultados.length - 1)));
  }, [resultados.length]);

  const go = useCallback(
    (item: BuscadorItem) => {
      setOpen(false);
      setQuery("");
      setActive(0);
      router.push(item.href);
    },
    [router],
  );

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (resultados.length === 0 ? 0 : (a + 1) % resultados.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) =>
        resultados.length === 0 ? 0 : (a - 1 + resultados.length) % resultados.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = resultados[active];
      if (item) go(item);
    }
  };

  const secciones: { kind: BuscadorItem["kind"]; titulo: string }[] = [
    { kind: "modulo", titulo: b.modulesSection },
    { kind: "accion", titulo: b.actionsSection },
    { kind: "cliente", titulo: b.clientsSection },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openPalette}
        aria-keyshortcuts="Control+K"
        aria-label={b.buttonAria}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
        </svg>
        <span className="hidden sm:inline">{b.button}</span>
        <kbd className="hidden rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-xs font-semibold text-zinc-400 md:inline">
          Ctrl K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
          role="presentation"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={b.dialogAria}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-zinc-400">
                <circle cx="11" cy="11" r="7" />
                <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
              </svg>
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={resultados[active] ? `buscador-${resultados[active].id}` : undefined}
                aria-label={b.placeholder}
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-400 outline-none"
                placeholder={b.placeholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={close}
                aria-label={b.close}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <ul id={listId} role="listbox" aria-label={b.dialogAria} className="max-h-[50vh] overflow-auto p-2">
              {resultados.length === 0 ? (
                <li className="px-3 py-4 text-sm text-zinc-400" role="option" aria-selected="false">
                  {buscandoClientes ? b.loadingClients : b.noResults.replace("{q}", query.trim())}
                </li>
              ) : (
                secciones.map(({ kind, titulo }) => {
                  const rows = resultados.filter((r) => r.kind === kind);
                  if (rows.length === 0) return null;
                  return (
                    <li key={kind} role="presentation">
                      <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-zinc-400">
                        {titulo}
                      </p>
                      <ul role="group" aria-label={titulo}>
                        {rows.map((item) => {
                          const idx = resultados.indexOf(item);
                          const selected = idx === active;
                          return (
                            <li
                              key={item.id}
                              id={`buscador-${item.id}`}
                              role="option"
                              aria-selected={selected}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                go(item);
                              }}
                              onMouseEnter={() => setActive(idx)}
                              className={`cursor-pointer rounded-lg px-3 py-2.5 text-sm ${
                                selected ? "bg-emerald-500/15 text-emerald-200" : "text-zinc-200"
                              }`}
                            >
                              <span className="block font-semibold">{item.titulo}</span>
                              {item.descripcion && (
                                <span className="mt-0.5 block text-xs text-zinc-400">{item.descripcion}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })
              )}
            </ul>
            <p className="border-t border-zinc-800 px-4 py-2.5 text-xs text-zinc-400">{b.hint}</p>
          </div>
        </div>
      )}
    </>
  );
}
