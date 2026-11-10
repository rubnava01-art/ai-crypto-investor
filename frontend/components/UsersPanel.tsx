"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AdminUser } from "../lib/api";
import { Panel } from "./Panel";
import { useConfirm, Field } from "./ui";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";


export function UsersPanel() {
  const isCancelled = useCancelled();
  const { t } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
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
      const _load1 = await api.listUsers();
      if (isCancelled()) return;
      setUsers(_load1);
    } catch {
      setUsers([]);
      setLoadError(t.usuarios.loadError);
    }
    try {
      const _meSuper = await api.me();
      if (isCancelled()) return;
      setMeSuper(_meSuper.is_super_admin);
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
    if (!(await confirm(t.usuarios.confirmChangeRole.replace("{nombre}", u.username)))) return;
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
    if (!(await confirm((grant ? t.usuarios.confirmSuperGrant : t.usuarios.confirmSuperRemove).replace("{nombre}", u.username)))) return;
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
    if (!(await confirm(t.usuarios.confirmApprove.replace("{nombre}", u.username)))) return;
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
    if (!(await confirm(t.usuarios.confirmReject.replace("{nombre}", u.username)))) return;
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
    if (!(await confirm(t.usuarios.confirmDeleteUser.replace("{nombre}", u.username)))) return;
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
    <>
      {dialog}
    <Panel
      title={t.usuarios.panelTitle}
      badge={
        <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          {t.usuarios.adminBadge}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        <strong className="text-zinc-300">{t.usuarios.introSuperLabel}</strong>{t.usuarios.introSuperBody}<strong className="text-zinc-300">{t.usuarios.introAdminLabel}</strong>{t.usuarios.introAdminBody}<strong className="text-zinc-300">{t.usuarios.introTrialLabel}</strong>{t.usuarios.introTrialBody}<strong className="text-zinc-300">{t.usuarios.introNewLabel}</strong>{t.usuarios.introNewBody}<strong className="text-zinc-300">{t.usuarios.introKeysLabel}</strong>{t.usuarios.introKeysBody}
      </p>

      {loadError && (
        <div role="alert" className="mb-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-red-400">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="min-h-[36px] rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.misc.retry}
          </button>
        </div>
      )}

      {users === null ? (
        <p className="py-4 text-center text-sm text-zinc-400">{t.usuarios.loadingUsers}</p>
      ) : users.length === 0 ? (
        // A5 (2026-11-10): con error de carga no se muestra el vacío: el
        // fallo ya está anunciado arriba y "Sin usuarios todavía." mentiría.
        loadError ? null : (
          <p className="py-4 text-center text-sm text-zinc-400">{t.usuarios.emptyUsers}</p>
        )
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {users.map((u) => (
            <li key={u.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${
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
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {u.username}
                    {u.status === "pending" && (
                      <span className="ml-2 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                        {t.usuarios.pendingBadge}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400">{roleLabel(u)}</p>
                </div>
                {u.status === "pending" ? (
                  <>
                    <button
                      onClick={() => approve(u)}
                      aria-label={t.usuarios.approveTitle}
                      className="min-h-[44px] rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                      title={t.usuarios.approveTitle}
                    >
                      {t.usuarios.activate}
                    </button>
                    <button
                      onClick={() => reject(u)}
                      aria-label={t.usuarios.rejectTitle}
                      className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
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
                          aria-label={t.usuarios.removeSuperTitle}
                          className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                          title={t.usuarios.removeSuperTitle}
                        >
                          {t.usuarios.removeSuper}
                        </button>
                      )
                    ) : (
                      <>
                        <button
                          onClick={() => toggleRole(u)}
                          aria-label={t.usuarios.changeRoleTitle}
                          className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                          title={t.usuarios.changeRoleTitle}
                        >
                          {u.is_admin ? t.usuarios.makeTrial : t.usuarios.makeAdmin}
                        </button>
                        {meSuper && (
                          <button
                            onClick={() => setSuper(u, true)}
                            aria-label={t.usuarios.grantSuperTitle}
                            className="min-h-[44px] rounded-lg border border-violet-900/60 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
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
                      aria-label={t.usuarios.pwTitle}
                      className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                      title={t.usuarios.pwTitle}
                    >
                      {t.usuarios.pwButton}
                    </button>
                    <button
                      onClick={() => remove(u)}
                      aria-label={t.usuarios.deleteTitle}
                      className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                      title={t.usuarios.deleteTitle}
                    >
                      {t.usuarios.delete}
                    </button>
                  </>
                )}
              </div>
              {pwUserId === u.id && u.status !== "pending" && (
                <div className="mt-3 flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:flex-row sm:items-center">
                  <Field label={t.usuarios.newPwAria.replace("{nombre}", u.username)} className="flex-1"><input
                    aria-label={t.usuarios.newPwAria.replace("{nombre}", u.username)}
                    className={inputCls}
                    placeholder={t.usuarios.newPwPlaceholder}
                    type="password"
                    value={pwValue}
                    onChange={(e) => setPwValue(e.target.value)}
                    autoComplete="new-password"
                  /></Field>
                  <button
                    onClick={() => savePassword(u)}
                    disabled={pwBusy}
                    className="min-h-[44px] shrink-0 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  >
                    {t.usuarios.saveNewPw}
                  </button>
                  <button
                    onClick={() => resetPassword(u)}
                    disabled={pwBusy}
                    className="min-h-[44px] shrink-0 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    title={t.usuarios.resetTempTitle}
                  >
                    {t.usuarios.resetTemp}
                  </button>
                </div>
              )}
              {pwUserId === u.id && pwTemp && (
                <p className="mt-3 rounded-lg border border-amber-700/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  {t.usuarios.tempPrefix.replace("{nombre}", u.username)}
                  <code className="font-mono font-semibold">{pwTemp}</code>{t.usuarios.tempSuffix}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
        <p className="text-sm font-semibold text-zinc-200">{t.usuarios.addUser}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t.usuarios.userAria}><input aria-label={t.usuarios.userAria}
            className={inputCls}
            placeholder={t.usuarios.userPlaceholder}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            autoComplete="off"
          /></Field>
          <Field label={t.usuarios.passwordAria}><input aria-label={t.usuarios.passwordAria}
            className={inputCls}
            placeholder={t.usuarios.passwordPlaceholder}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          /></Field>
          <Field label={t.usuarios.roleAria}><select aria-label={t.usuarios.roleAria}
            className={inputCls}
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "prueba" | "super_admin")}
          >
            <option value="prueba">{t.usuarios.roleTrialOption}</option>
            <option value="admin">{t.usuarios.roleAdminOption}</option>
            {meSuper && <option value="super_admin">{t.usuarios.roleSuperOption}</option>}
          </select></Field>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {busy ? t.usuarios.creating : t.usuarios.createUser}
        </button>
        {msg && <p role="status" className="text-sm text-emerald-400">{msg}</p>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </form>
    </Panel>
    </>
  );
}
