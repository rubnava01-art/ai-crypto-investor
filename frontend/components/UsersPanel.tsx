"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AdminUser } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";


export function UsersPanel() {
  const { t } = useLanguage();
  const roleLabel = (u: AdminUser) =>
    u.status === "pending"
      ? t.usuarios.rolePending
      : u.is_super_admin
        ? t.usuarios.roleSuper
        : u.is_admin
          ? t.usuarios.roleAdmin
          : t.usuarios.roleTrial;
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
      setLoadError(t.usuarios.loadError);
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
        t.usuarios.msgUserCreated.replace("{rol}", role === "super_admin" ? t.usuarios.roleSuperName : role === "admin" ? t.usuarios.roleAdminName : t.usuarios.roleTrialName)
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usuarios.errCreateUser);
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
      setError(err instanceof ApiError ? err.message : t.usuarios.errChangeRole);
    }
  };

  const setSuper = async (u: AdminUser, grant: boolean) => {
    setError(null);
    setMsg(null);
    try {
      await api.updateUser(u.id, { role: grant ? "super_admin" : "admin" });
      setMsg(
        grant
          ? t.usuarios.msgNowSuper.replace("{nombre}", u.username)
          : t.usuarios.msgNoLongerSuper.replace("{nombre}", u.username)
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usuarios.errChangeRole);
    }
  };

  const approve = async (u: AdminUser) => {
    setError(null);
    setMsg(null);
    try {
      await api.approveUser(u.id);
      setMsg(t.usuarios.msgActivated.replace("{nombre}", u.username));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usuarios.errActivate);
    }
  };

  const reject = async (u: AdminUser) => {
    if (!window.confirm(t.usuarios.confirmReject.replace("{nombre}", u.username))) return;
    setError(null);
    setMsg(null);
    try {
      await api.rejectUser(u.id);
      setMsg(t.usuarios.msgRejected.replace("{nombre}", u.username));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usuarios.errReject);
    }
  };

  const savePassword = async (u: AdminUser) => {
    if (pwValue.trim().length < 4) {
      setError(t.usuarios.errPwShort);
      return;
    }
    setPwBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.updateUser(u.id, { password: pwValue });
      setMsg(t.usuarios.msgPwUpdated.replace("{nombre}", u.username));
      setPwValue("");
      setPwTemp(null);
      setPwUserId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usuarios.errChangePw);
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
      setMsg(t.usuarios.msgPwReset.replace("{nombre}", u.username));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usuarios.errResetPw);
    } finally {
      setPwBusy(false);
    }
  };

  const remove = async (u: AdminUser) => {
    if (!window.confirm(t.usuarios.confirmDeleteUser.replace("{nombre}", u.username))) return;
    setError(null);
    setMsg(null);
    try {
      await api.deleteUser(u.id);
      setMsg(t.usuarios.msgUserDeleted.replace("{nombre}", u.username));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.usuarios.errDeleteUser);
    }
  };

  return (
    <Panel
      title={t.usuarios.panelTitle}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          {t.usuarios.adminBadge}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        <strong className="text-zinc-300">{t.usuarios.introSuperLabel}</strong>{t.usuarios.introSuperBody}<strong className="text-zinc-300">{t.usuarios.introAdminLabel}</strong>{t.usuarios.introAdminBody}<strong className="text-zinc-300">{t.usuarios.introTrialLabel}</strong>{t.usuarios.introTrialBody}<strong className="text-zinc-300">{t.usuarios.introNewLabel}</strong>{t.usuarios.introNewBody}<strong className="text-zinc-300">{t.usuarios.introKeysLabel}</strong>{t.usuarios.introKeysBody}
      </p>

      {loadError && (
        <p role="alert" className="mb-2 text-sm text-red-400">
          {loadError}
        </p>
      )}

      {users === null ? (
        <p className="py-3 text-center text-sm text-zinc-500">{t.usuarios.loadingUsers}</p>
      ) : users.length === 0 ? (
        <p className="py-3 text-center text-sm text-zinc-500">{t.usuarios.emptyUsers}</p>
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
                        {t.usuarios.pendingBadge}
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
                      title={t.usuarios.approveTitle}
                    >
                      {t.usuarios.activate}
                    </button>
                    <button
                      onClick={() => reject(u)}
                      className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                      title={t.usuarios.rejectTitle}
                    >
                      {t.usuarios.reject}
                    </button>
                  </>
                ) : (
                  <>
                    {u.is_super_admin ? (
                      meSuper && (
                        <button
                          onClick={() => setSuper(u, false)}
                          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                          title={t.usuarios.removeSuperTitle}
                        >
                          {t.usuarios.removeSuper}
                        </button>
                      )
                    ) : (
                      <>
                        <button
                          onClick={() => toggleRole(u)}
                          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                          title={t.usuarios.changeRoleTitle}
                        >
                          {u.is_admin ? t.usuarios.makeTrial : t.usuarios.makeAdmin}
                        </button>
                        {meSuper && (
                          <button
                            onClick={() => setSuper(u, true)}
                            className="rounded-lg border border-violet-900/60 px-2.5 py-1 text-xs text-violet-300 hover:bg-violet-950/50"
                            title={t.usuarios.grantSuperTitle}
                          >
                            {t.usuarios.makeSuper}
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
                      title={t.usuarios.pwTitle}
                    >
                      {t.usuarios.pwButton}
                    </button>
                    <button
                      onClick={() => remove(u)}
                      className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                      title={t.usuarios.deleteTitle}
                    >
                      {t.usuarios.delete}
                    </button>
                  </>
                )}
              </div>
              {pwUserId === u.id && u.status !== "pending" && (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 sm:flex-row sm:items-center">
                  <input
                    aria-label={t.usuarios.newPwAria.replace("{nombre}", u.username)}
                    className={inputCls}
                    placeholder={t.usuarios.newPwPlaceholder}
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
                    {t.usuarios.saveNewPw}
                  </button>
                  <button
                    onClick={() => resetPassword(u)}
                    disabled={pwBusy}
                    className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                    title={t.usuarios.resetTempTitle}
                  >
                    {t.usuarios.resetTemp}
                  </button>
                </div>
              )}
              {pwUserId === u.id && pwTemp && (
                <p className="mt-2 rounded-lg border border-amber-700/60 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {t.usuarios.tempPrefix.replace("{nombre}", u.username)}
                  <code className="font-mono font-semibold">{pwTemp}</code>{t.usuarios.tempSuffix}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
        <p className="text-sm font-semibold text-zinc-200">{t.usuarios.addUser}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input aria-label={t.usuarios.userAria}
            className={inputCls}
            placeholder={t.usuarios.userPlaceholder}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            autoComplete="off"
          />
          <input aria-label={t.usuarios.passwordAria}
            className={inputCls}
            placeholder={t.usuarios.passwordPlaceholder}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
            autoComplete="new-password"
          />
          <select aria-label={t.usuarios.roleAria}
            className={inputCls}
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "prueba" | "super_admin")}
          >
            <option value="prueba">{t.usuarios.roleTrialOption}</option>
            <option value="admin">{t.usuarios.roleAdminOption}</option>
            {meSuper && <option value="super_admin">{t.usuarios.roleSuperOption}</option>}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? t.usuarios.creating : t.usuarios.createUser}
        </button>
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </form>
    </Panel>
  );
}
