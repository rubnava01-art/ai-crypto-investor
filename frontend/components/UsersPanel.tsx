"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AdminUser } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const roleLabel = (u: AdminUser) =>
  u.status === "pending"
    ? "Pendiente de activación · entrará como Prueba"
    : u.is_super_admin
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
  // Control de claves por usuario: cambiar (el admin escribe la nueva) o
  // restablecer (se genera una temporal y se muestra una sola vez para
  // pasarla al usuario). La plataforma no envía correo, así que el
  // restablecimiento es siempre a través del admin.
  const [pwUserId, setPwUserId] = useState<number | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwTemp, setPwTemp] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

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

  const approve = async (u: AdminUser) => {
    setError(null);
    setMsg(null);
    try {
      await api.approveUser(u.id);
      setMsg(`"${u.username}" activado: ya puede iniciar sesión.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo activar el usuario.");
    }
  };

  const reject = async (u: AdminUser) => {
    if (!window.confirm(`¿Rechazar a "${u.username}"? La cuenta se borrará y nunca entró.`)) return;
    setError(null);
    setMsg(null);
    try {
      await api.rejectUser(u.id);
      setMsg(`"${u.username}" rechazado y borrado.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo rechazar el usuario.");
    }
  };

  const savePassword = async (u: AdminUser) => {
    if (pwValue.trim().length < 4) {
      setError("La clave nueva debe tener al menos 4 caracteres.");
      return;
    }
    setPwBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.updateUser(u.id, { password: pwValue });
      setMsg(`Clave de "${u.username}" actualizada.`);
      setPwValue("");
      setPwTemp(null);
      setPwUserId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar la clave.");
    } finally {
      setPwBusy(false);
    }
  };

  const resetPassword = async (u: AdminUser) => {
    // Temporal aleatoria de 12 caracteres; se muestra una sola vez para
    // que el admin se la pase al usuario por su canal habitual.
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    const temp = Array.from(buf, (n) => chars[n % chars.length]).join("");
    setPwBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.updateUser(u.id, { password: temp });
      setPwTemp(temp);
      setMsg(`Clave de "${u.username}" restablecida. Pásale la temporal que se muestra abajo.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo restablecer la clave.");
    } finally {
      setPwBusy(false);
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
        ver el panel y correr pruebas (backtests y evaluación) — ningún control.{" "}
        <strong className="text-zinc-300">Cuentas nuevas:</strong> quedan pendientes de activación
        hasta que un administrador las apruebe; mientras tanto no pueden entrar.{" "}
        <strong className="text-zinc-300">Claves:</strong> el admin puede cambiar la clave de
        cualquier usuario o restablecerla con una temporal (la plataforma no envía correo, la
        temporal se le pasa al usuario por otro canal).
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
            <li key={u.id} className="py-2.5">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                    u.status === "pending"
                      ? "bg-amber-600"
                      : u.is_super_admin
                        ? "bg-violet-600"
                        : u.is_admin
                          ? "bg-emerald-600"
                          : "bg-zinc-600"
                  }`}
                >
                  {u.username.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {u.username}
                    {u.status === "pending" && (
                      <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                        Pendiente
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500">{roleLabel(u)}</p>
                </div>
                {u.status === "pending" ? (
                  <>
                    <button
                      onClick={() => approve(u)}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                      title="Aprobar: la cuenta podrá iniciar sesión"
                    >
                      Activar
                    </button>
                    <button
                      onClick={() => reject(u)}
                      className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                      title="Rechazar: la cuenta se borra"
                    >
                      Rechazar
                    </button>
                  </>
                ) : (
                  <>
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
                      onClick={() => {
                        setPwUserId(pwUserId === u.id ? null : u.id);
                        setPwValue("");
                        setPwTemp(null);
                      }}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                      title="Cambiar o restablecer la clave"
                    >
                      Clave
                    </button>
                    <button
                      onClick={() => remove(u)}
                      className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                      title="Borrar usuario"
                    >
                      Borrar
                    </button>
                  </>
                )}
              </div>
              {pwUserId === u.id && u.status !== "pending" && (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 sm:flex-row sm:items-center">
                  <input
                    aria-label={`Clave nueva para ${u.username}`}
                    className={inputCls}
                    placeholder="Clave nueva (mín. 4 caracteres)"
                    type="password"
                    value={pwValue}
                    onChange={(e) => setPwValue(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    onClick={() => savePassword(u)}
                    disabled={pwBusy}
                    className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Guardar nueva clave
                  </button>
                  <button
                    onClick={() => resetPassword(u)}
                    disabled={pwBusy}
                    className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    title="Genera una clave temporal y la muestra una sola vez"
                  >
                    Restablecer (temporal)
                  </button>
                </div>
              )}
              {pwUserId === u.id && pwTemp && (
                <p className="mt-2 rounded-lg border border-amber-700/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  Clave temporal de &ldquo;{u.username}&rdquo;:{" "}
                  <code className="font-mono font-semibold">{pwTemp}</code> — se muestra una sola
                  vez; pásasela al usuario y dile que la cambie al entrar.
                </p>
              )}
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
