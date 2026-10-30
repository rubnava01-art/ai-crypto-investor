"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type InventoryItem, type InventoryUnit, type MeResponse } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const UNITS: InventoryUnit[] = ["pieza", "kg", "litro", "metro", "caja", "otro"];

/** Inventario: control de stock. La lista empieza VACÍA — aquí nada se
 * inventa. Solo el administrador crea, edita y borra; prueba solo lee.
 * `Stock bajo` se calcula solo (cantidad <= stock mínimo). */
export function InventarioPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [unit, setUnit] = useState<InventoryUnit>("pieza");
  const [unitPrice, setUnitPrice] = useState("0");
  const [minStock, setMinStock] = useState("0");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!me?.is_admin;

  const load = useCallback(async () => {
    try {
      setItems(await api.listInventoryItems());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!items || !q) return items ?? [];
    return items.filter((it) =>
      [it.name, it.sku, it.description].join(" ").toLowerCase().includes(q)
    );
  }, [items, filter]);

  const totals = useMemo(() => {
    const rows = items ?? [];
    return {
      count: rows.length,
      low: rows.filter((it) => it.low_stock).length,
      value: rows.reduce((acc, it) => acc + it.quantity * it.unit_price, 0),
    };
  }, [items]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setSku("");
    setQuantity("0");
    setUnit("pieza");
    setUnitPrice("0");
    setMinStock("0");
    setEditing(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const body = {
        name: name.trim(),
        description,
        sku: sku.trim(),
        quantity: Math.max(0, parseInt(quantity, 10) || 0),
        unit,
        unit_price: Math.max(0, parseFloat(unitPrice) || 0),
        min_stock: Math.max(0, parseInt(minStock, 10) || 0),
      };
      if (editing) {
        await api.updateInventoryItem(editing.id, body);
        setMsg("Artículo actualizado.");
      } else {
        await api.createInventoryItem(body);
        setMsg("Artículo guardado.");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (it: InventoryItem) => {
    if (!window.confirm(`¿Borrar "${it.name}" del inventario?`)) return;
    setError(null);
    try {
      await api.deleteInventoryItem(it.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar.");
    }
  };

  const adjust = async (it: InventoryItem, delta: number) => {
    const next = Math.max(0, it.quantity + delta);
    if (next === it.quantity) return;
    setError(null);
    try {
      await api.updateInventoryItem(it.id, { quantity: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo ajustar la cantidad.");
    }
  };

  const startEdit = (it: InventoryItem) => {
    setEditing(it);
    setName(it.name);
    setDescription(it.description);
    setSku(it.sku);
    setQuantity(String(it.quantity));
    setUnit(it.unit);
    setUnitPrice(String(it.unit_price));
    setMinStock(String(it.min_stock));
  };

  const fmtMoney = (v: number) =>
    v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });

  return (
    <Panel
      title="Inventario"
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {items === null
            ? "Cargando…"
            : `${totals.count} artículos · ${totals.low} con stock bajo · ${fmtMoney(totals.value)}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Control de stock: cantidad, unidad, precio y stock mínimo. Solo el
        administrador crea, edita y borra.
        {!isAdmin && " Tu rol de prueba es de solo lectura."}
      </p>

      {isAdmin && (
        <form onSubmit={save} className="space-y-2">
          <input aria-label="Nombre del artículo" className={inputCls} placeholder="Nombre del artículo *" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="off" />
          <textarea aria-label="Descripción" className={inputCls} placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input aria-label="SKU (opcional)" className={inputCls} placeholder="SKU (opcional)" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={64} autoComplete="off" />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Unidad</span>
              <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Cantidad</span>
              <input className={inputCls} type="number" min={0} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Precio unitario</span>
              <input className={inputCls} type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Stock mínimo</span>
              <input className={inputCls} type="number" min={0} step={1} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Guardando…" : editing ? "Actualizar artículo" : "Guardar artículo"}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancelar
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <input aria-label="Buscar en inventario"
          className={inputCls}
          placeholder="Buscar por nombre, SKU o descripción…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoComplete="off"
        />
        {items === null ? (
          <p className="py-2 text-sm text-zinc-500">Cargando inventario…</p>
        ) : visible.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">
            {items.length === 0
              ? "Todavía no hay artículos en el inventario."
              : "Ningún artículo coincide con la búsqueda."}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {visible.map((it) => (
              <li key={it.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{it.name}</span>
                  {it.sku && (
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
                      {it.sku}
                    </span>
                  )}
                  {it.low_stock && (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                      Stock bajo
                    </span>
                  )}
                  {isAdmin && (
                    <span className="ml-auto flex items-center gap-2">
                      <button onClick={() => adjust(it, -1)} aria-label="Quitar uno" className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                        −
                      </button>
                      <button onClick={() => adjust(it, 1)} aria-label="Agregar uno" className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                        +
                      </button>
                      <button onClick={() => startEdit(it)} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                        Editar
                      </button>
                      <button onClick={() => remove(it)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                        Borrar
                      </button>
                    </span>
                  )}
                </div>
                {it.description && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{it.description}</p>}
                <p className="mt-1.5 text-sm text-zinc-400">
                  {it.quantity} {it.unit} · {fmtMoney(it.unit_price)} c/u · valor {fmtMoney(it.quantity * it.unit_price)}
                  {it.min_stock > 0 && ` · mínimo ${it.min_stock}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
