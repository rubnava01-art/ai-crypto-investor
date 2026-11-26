"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type InventoryItem, type InventoryMovement, type InventoryUnit, type MeResponse } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { formatMoney } from "../lib/format";
import { useCancelled } from "../lib/useLoad";
import { Panel } from "./Panel";
import { EmptyState } from "./badges";
import { ListSkeleton } from "./Skeleton";
import { useConfirm, Field, ApiErrorBanner } from "./ui";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const UNITS: InventoryUnit[] = ["pieza", "kg", "litro", "metro", "caja", "otro"];

/** Inventario: control de stock. La lista empieza VACÍA — aquí nada se
 * inventa. Solo el administrador crea, edita y borra; prueba solo lee.
 * `Stock bajo` se calcula solo (cantidad <= stock mínimo). */
export function InventarioPanel() {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [filter, setFilter] = useState("");
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [unit, setUnit] = useState<InventoryUnit>("pieza");
  const [unitPrice, setUnitPrice] = useState("0");
  const [minStock, setMinStock] = useState("0");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [motivo, setMotivo] = useState("");
  // Historial de movimientos por producto (Fase 5b, tarea 3): solo se
  // carga al abrirlo, no con la lista.
  const [historyItemId, setHistoryItemId] = useState<number | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tri-estado (2026-11-25): un fallo de carga ya no se ve como lista
  // vacía — se conserva el estado y se muestra el banner con reintento,
  // mismo patrón que Riesgos/Planillas/Talento.
  const [loadError, setLoadError] = useState<unknown>(null);

  const isAdmin = !!me?.is_admin;

  // Etiqueta visible de cada unidad (el valor enviado al backend no
  // cambia: sigue siendo el identificador en español).
  const unitLabel = (u: InventoryUnit) =>
    u === "pieza" ? t.inventario.unitPieza
    : u === "kg" ? t.inventario.unitKg
    : u === "litro" ? t.inventario.unitLitro
    : u === "metro" ? t.inventario.unitMetro
    : u === "caja" ? t.inventario.unitCaja
    : t.inventario.unitOtro;

  const load = useCallback(async () => {
    try {
      const _load1 = await api.listInventoryItems();
      if (isCancelled()) return;
      setItems(_load1);
      setLoadError(null);
    } catch (e) {
      if (isCancelled()) return;
      setLoadError(e);
    }
  }, []);

  useEffect(() => {
    api.me().then((v) => { if (!isCancelled()) setMe(v); }).catch(() => { if (!isCancelled()) setMe(null); });
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = items ?? [];
    return rows.filter((it) => {
      if (onlyLowStock && !it.low_stock) return false;
      if (!q) return true;
      return [it.name, it.sku, it.description].join(" ").toLowerCase().includes(q);
    });
  }, [items, filter, onlyLowStock]);

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
    setMotivo("");
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
        // Motivo del cambio de cantidad: solo alimenta el historial de
        // movimientos (el backend lo registra si la cantidad cambia).
        motivo: motivo.trim() || undefined,
      };
      if (editing) {
        await api.updateInventoryItem(editing.id, body);
        setMsg(t.inventario.updated);
      } else {
        await api.createInventoryItem(body);
        setMsg(t.inventario.saved);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(t.inventario.saveError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (it: InventoryItem) => {
    if (!(await confirm(t.inventario.deleteConfirm.replace("{nombre}", it.name)))) return;
    setError(null);
    try {
      await api.deleteInventoryItem(it.id);
      await load();
    } catch (err) {
      setError(t.inventario.deleteError);
    }
  };

  const adjust = async (it: InventoryItem, delta: number) => {
    const next = Math.max(0, it.quantity + delta);
    if (next === it.quantity) return;
    setError(null);
    try {
      // Movimiento explícito (Fase 5b, tarea 3): el +/-1 queda
      // registrado en el historial con su motivo, en vez de un PUT
      // de cantidad sin rastro.
      await api.addMovement(it.id, { tipo: "ajuste", cantidad: delta, motivo: t.inventario.movQuick });
      await load();
    } catch (err) {
      setError(t.inventario.adjustError);
    }
  };

  const toggleHistory = async (it: InventoryItem) => {
    if (historyItemId === it.id) {
      setHistoryItemId(null);
      setMovements(null);
      return;
    }
    setHistoryItemId(it.id);
    setMovements(null);
    setHistoryError(false);
    try {
      const rows = await api.listMovements(it.id);
      if (isCancelled()) return;
      setMovements(rows);
    } catch {
      if (!isCancelled()) setHistoryError(true);
    }
  };

  const movLabel = (tipo: string) =>
    tipo === "entrada" ? t.inventario.movEntrada : tipo === "venta" ? t.inventario.movVenta : t.inventario.movAjuste;

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

  // Formato compartido (Fase 4, FE6): antes formateador local duplicado.
  const fmtMoney = (v: number) => formatMoney(v, "MXN", locale);

  return (
    <>
      {dialog}
    <Panel
      title={t.inventario.title}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {items === null
            ? t.inventario.loading
            : t.inventario.summary.replace("{nombre}", String(totals.count)).replace("{bajo}", String(totals.low)).replace("{valor}", fmtMoney(totals.value))}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.inventario.intro}
        {!isAdmin && t.inventario.readOnly}
      </p>

      {/* Aviso de stock bajo (Fase 5b, tarea 3): el distintivo por
        producto ya existía; este aviso resume cuántos hay y enlaza al
        filtro. La sección de "Hoy" ya cubre el stock bajo desde Fase 4. */}
      {items !== null && totals.low > 0 && (
        <p role="alert" className="mb-4 rounded-lg border border-red-700/60 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {t.inventario.lowStockAlert.replace("{n}", String(totals.low))}{" "}
          <button type="button" onClick={() => setOnlyLowStock(true)} className="font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60">
            {t.inventario.onlyLowStock}
          </button>
        </p>
      )}

      {isAdmin && (
        <form onSubmit={save} className="space-y-3">
          <Field label={t.inventario.nameAria}><input aria-label={t.inventario.nameAria} className={inputCls} placeholder={t.inventario.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
          <textarea aria-label={t.inventario.descAria} className={inputCls} placeholder={t.inventario.descPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t.inventario.skuAria}><input aria-label={t.inventario.skuAria} className={inputCls} placeholder={t.inventario.skuPlaceholder} value={sku} onChange={(e) => setSku(e.target.value)} maxLength={64} autoComplete="off" /></Field>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-300">{t.inventario.unitLabel}</span>
              <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{unitLabel(u)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-300">{t.inventario.qtyLabel}</span>
              <input className={inputCls} type="number" min={0} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-300">{t.inventario.priceLabel}</span>
              <input className={inputCls} type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-300">{t.inventario.minLabel}</span>
              <input className={inputCls} type="number" min={0} step={1} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            </label>
            {editing && (
              <Field label={t.inventario.movReasonAria}><input aria-label={t.inventario.movReasonAria} className={inputCls} placeholder={t.inventario.movReasonPlaceholder} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} autoComplete="off" /></Field>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t.inventario.saving : editing ? t.inventario.updateItem : t.inventario.saveItem}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
                {t.inventario.cancel}
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <Field label={t.inventario.searchAria}><input aria-label={t.inventario.searchAria}
          className={inputCls}
          placeholder={t.inventario.searchPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoComplete="off"
        /></Field>
        <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={onlyLowStock}
            onChange={(e) => setOnlyLowStock(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          {t.inventario.onlyLowStock}
        </label>
        {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={load} /> : null}
        {items === null ? (
          loadError ? null : (
            <ListSkeleton ariaLabel={t.misc.loadingAria} />
          )
        ) : visible.length === 0 ? (
          <EmptyState
            text={
              items.length === 0
                ? t.inventario.emptyItems
                : t.inventario.noMatch
            }
          />
        ) : (
          <ul className="mt-3 space-y-3">
            {visible.map((it) => (
              <li key={it.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{it.name}</span>
                  {it.sku && (
                    <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                      {it.sku}
                    </span>
                  )}
                  {it.low_stock && (
                    <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                      {t.inventario.lowStock}
                    </span>
                  )}
                  {isAdmin && (
                    <span className="ml-auto flex items-center gap-2">
                      <button onClick={() => adjust(it, -1)} aria-label={t.inventario.removeOneAria} className="min-h-[44px] min-w-[40px] rounded-lg border border-zinc-700 px-2 py-1 text-base font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
                        −
                      </button>
                      <button onClick={() => adjust(it, 1)} aria-label={t.inventario.addOneAria} className="min-h-[44px] min-w-[40px] rounded-lg border border-zinc-700 px-2 py-1 text-base font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
                        +
                      </button>
                      <button onClick={() => startEdit(it)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
                        {t.inventario.edit}
                      </button>
                      <button onClick={() => remove(it)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
                        {t.inventario.delete}
                      </button>
                    </span>
                  )}
                </div>
                {it.description && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{it.description}</p>}
                <p className="mt-1.5 text-sm text-zinc-400">
                  {it.quantity} {unitLabel(it.unit)} · {fmtMoney(it.unit_price)} {t.inventario.perUnit} · {t.inventario.valueWord} {fmtMoney(it.quantity * it.unit_price)}
                  {it.min_stock > 0 && ` · ${t.inventario.minimum} ${it.min_stock}`}
                </p>
                <button
                  type="button"
                  onClick={() => void toggleHistory(it)}
                  aria-expanded={historyItemId === it.id}
                  className="mt-2 min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  {historyItemId === it.id ? t.inventario.historyHide : t.inventario.historyShow}
                </button>
                {historyItemId === it.id && (
                  <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{t.inventario.historyTitle}</p>
                    {historyError ? (
                      <p role="alert" className="mt-1 text-sm text-red-400">{t.inventario.historyErr}</p>
                    ) : movements === null ? (
                      <p className="mt-1 text-sm text-zinc-400">{t.inventario.loadingItems}</p>
                    ) : movements.length === 0 ? (
                      <p className="mt-1 text-sm text-zinc-400">{t.inventario.historyEmpty}</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm">
                        {movements.map((m) => (
                          <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 text-zinc-300">
                            <span className="font-semibold text-zinc-100">{movLabel(m.tipo)}</span>
                            <span className={m.cantidad_delta >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {m.cantidad_delta >= 0 ? `+${m.cantidad_delta}` : m.cantidad_delta}
                            </span>
                            <span className="text-zinc-400">→ {m.cantidad_final}</span>
                            {m.motivo && <span className="text-zinc-400">{m.motivo}</span>}
                            <span className="ml-auto text-xs text-zinc-400">{m.created_at ? new Date(m.created_at).toLocaleString(locale) : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
    </>
  );
}
