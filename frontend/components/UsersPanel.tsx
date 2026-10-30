"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AdminUser } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const roleLabel = (u: AdminUser) =>
  u.is_super_admin
    ? "Super admin · control total + gestión de super admins"
    : u.is_admin
      ? "Administrador · control total"
      : "Prueba · solo ver y probar";

export function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [meSuper, setMeSuper] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "prueba" | "super_admin">("prueba");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setUsers(await api.listUsers());
    } catch {
      setUsers([]);
      setLoadError("No se pudieron cargar los usuarios. Inténtalo de nuevo.");
    }
    try {
      setMeSuper((await api.me()).is_super_admin);
    } catch {
      setMeSuper(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createUser(username.trim(), password, role);
      setUsername("");
      setPassword("");
      setRole("prueba");
      setMsg(
        `Usuario creado con rol ${role === "super_admin" ? "Super admin" : role === "admin" ? "Administrador" : "Prueba"}.`
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el usuario.");
    } finally {
      setBusy(false);
    }
  };

  const toggleRole = async (u: AdminUser) => {
    setError(null);
    setMsg(null);
    try {
      await api.updateUser(u.id, { role: u.is_admin ? "prueba" : "admin" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el rol.");
    }
  };

  const setSuper = async (u: AdminUser, grant: boolean) => {
    setError(null);
    setMsg(null);
    try {
      await api.updateUser(u.id, { role: grant ? "super_admin" : "admin" });
      setMsg(
        grant
          ? `"${u.username}" ahora es super admin.`
          : `"${u.username}" ya no es super admin (queda como administrador).`
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el rol.");
    }
  };

  const remove = async (u: AdminUser) => {
    if (!window.confirm(`¿Borrar al usuario "${u.username}"? Esta acción no se puede deshacer.`)) return;
    setError(null);
    setMsg(null);
    try {
      await api.deleteUser(u.id);
      setMsg(`Usuario "${u.username}" borrado.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el usuario.");
    }
  };

  return (
    <Panel
      title="Usuarios y control"
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          Solo admin
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        <strong className="text-zinc-300">Super admin:</strong> todo lo del administrador, más
        otorgar/quitar el nivel super admin y gestionar cuentas super admin.{" "}
        <strong className="text-zinc-300">Administrador:</strong> control total (usuarios, ajustes,
        escáner, modos, kill switch). <strong className="text-zinc-300">Prueba:</strong> solo puede
        ver el panel y correr pruebas (backtests y evaluación) — ningún control.
      </p>

      {loadError && (
        <p role="alert" className="mb-2 text-sm text-red-400">
          {loadError}
        </p>
      )}

      {users === null ? (
        <p className="py-3 text-center text-sm text-zinc-500">Cargando usuarios…</p>
      ) : users.length === 0 ? (
        <p className="py-3 text-center text-sm text-zinc-500">Sin usuarios todavía.</p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2.5">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                  u.is_super_admin ? "bg-violet-600" : u.is_admin ? "bg-emerald-600" : "bg-zinc-600"
                }`}
              >
                {u.username.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-100">{u.username}</p>
                <p className="text-xs text-zinc-500">{roleLabel(u)}</p>
              </div>
              {u.is_super_admin ? (
                meSuper && (
                  <button
                    onClick={() => setSuper(u, false)}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    title="Quitar nivel super admin (queda como administrador)"
                  >
                    Quitar super admin
                  </button>
                )
              ) : (
                <>
                  <button
                    onClick={() => toggleRole(u)}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                    title="Cambiar rol"
                  >
                    {u.is_admin ? "Hacer prueba" : "Hacer admin"}
                  </button>
                  {meSuper && (
                    <button
                      onClick={() => setSuper(u, true)}
                      className="rounded-lg border border-violet-900/60 px-2.5 py-1 text-xs text-violet-300 hover:bg-violet-950/50"
                      title="Otorgar nivel super admin"
                    >
                      Hacer super admin
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => remove(u)}
                className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                title="Borrar usuario"
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
        <p className="text-sm font-semibold text-zinc-200">Añadir usuario</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input aria-label="Usuario"
            className={inputCls}
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            autoComplete="off"
          />
          <input aria-label="Contraseña"
            className={inputCls}
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
            autoComplete="new-password"
          />
          <select aria-label="Rol"
            className={inputCls}
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "prueba" | "super_admin")}
          >
            <option value="prueba">Prueba (solo ver y probar)</option>
            <option value="admin">Administrador (control total)</option>
            {meSuper && <option value="super_admin">Super admin (nivel máximo)</option>}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Creando…" : "Crear usuario"}
        </button>
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </form>
    </Panel>
  );
}
