"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type AcademyCourse, type AcademyEnrollment, type CrmContact, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const KIND_LABEL: Record<string, string> = {
  ebook: "Ebook",
  pack: "Pack",
  academia: "Academia",
};

const kindBadge: Record<string, string> = {
  ebook: "bg-sky-500/15 text-sky-300",
  pack: "bg-violet-500/15 text-violet-300",
  academia: "bg-emerald-500/15 text-emerald-300",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : null;

function StudentsSection({ course, isAdmin, contacts }: { course: AcademyCourse; isAdmin: boolean; contacts: CrmContact[] }) {
  const [students, setStudents] = useState<AcademyEnrollment[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStudents(await api.listStudents(course.id));
    } catch {
      setStudents([]);
    }
  }, [course.id]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) return;
    setBusy(true);
    setError(null);
    try {
      await api.createEnrollment({
        contact_id: Number(contactId),
        course_id: course.id,
        purchased: true,
        delivered: false,
      });
      setContactId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar la compra.");
    } finally {
      setBusy(false);
    }
  };

  const toggleDelivered = async (enr: AcademyEnrollment) => {
    setError(null);
    try {
      await api.updateEnrollment(enr.id, { delivered: !enr.delivered });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar la entrega.");
    }
  };

  const remove = async (enr: AcademyEnrollment) => {
    if (!window.confirm(`¿Quitar a "${enr.contact_name}" de ${course.title}?`)) return;
    setError(null);
    try {
      await api.deleteEnrollment(enr.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo quitar el registro.");
    }
  };

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Alumnos ({students === null ? "…" : students.length})
      </p>
      {students === null ? (
        <p className="py-2 text-sm text-zinc-500">Cargando alumnos…</p>
      ) : students.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">Todavía no hay compras registradas para este contenido.</p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {students.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-semibold text-zinc-100">{s.contact_name}</span>
              {s.contact_email && <span className="text-xs text-zinc-500">{s.contact_email}</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.purchased ? "bg-sky-500/15 text-sky-300" : "bg-zinc-500/15 text-zinc-400"}`}>
                {s.purchased ? `Comprado${fmtDate(s.purchased_at) ? ` · ${fmtDate(s.purchased_at)}` : ""}` : "Sin compra"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.delivered ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                {s.delivered ? `Entregado${fmtDate(s.delivered_at) ? ` · ${fmtDate(s.delivered_at)}` : ""}` : "Pendiente de entrega"}
              </span>
              {isAdmin && (
                <span className="ml-auto flex gap-1.5">
                  <button
                    onClick={() => toggleDelivered(s)}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    {s.delivered ? "Marcar no entregado" : "Marcar entregado"}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                  >
                    Quitar
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <form onSubmit={add} className="mt-2 flex flex-wrap gap-2">
          <select
            className={`${inputCls} max-w-xs flex-1`}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            aria-label="Contacto del CRM"
            required
          >
            <option value="">Registrar compra: elige un contacto del CRM…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.email ? ` (${c.email})` : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !contactId}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Registrando…" : "Registrar compra"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

function DownloadButtons({ course }: { course: AcademyCourse }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!course.downloads || course.downloads.length === 0) return null;

  const download = async (d: AcademyCourse["downloads"][number]) => {
    setBusyId(d.course_id);
    setError(null);
    try {
      await api.downloadCoursePdf(d.course_id, d.filename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo descargar el PDF.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {course.downloads.map((d) => (
        <button
          key={`${d.course_id}-${d.filename}`}
          onClick={() => download(d)}
          disabled={busyId === d.course_id}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {busyId === d.course_id
            ? "Descargando…"
            : course.downloads.length > 1
              ? `PDF · ${d.title}`
              : "Descargar PDF"}
        </button>
      ))}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}

export function AcademyPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [courses, setCourses] = useState<AcademyCourse[] | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    api.listCourses().then(setCourses).catch(() => setCourses([]));
    api.listContacts().then(setContacts).catch(() => setContacts([]));
  }, []);

  return (
    <div className="space-y-4">
      <Panel
        title="Academia — Catálogo"
        badge={
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {courses === null ? "Cargando…" : `${courses.length} productos`}
          </span>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          Tu catálogo real de contenido: los ebooks de Hotmart, el Pack Creador Completo
          y la Academia de $400. Los PDFs reales viven aquí: descárgalos con el botón
          de cada producto (el Pack trae los 6). Abre cada producto para ver sus
          alumnos (desde el CRM) y registrar compras y entregas.
          {!isAdmin && " Tu rol de prueba es de solo lectura."}
        </p>
      </Panel>

      {courses === null ? (
        <Panel title="Cargando catálogo…">
          <p className="py-2 text-sm text-zinc-500">Cargando…</p>
        </Panel>
      ) : courses.length === 0 ? (
        <Panel title="Sin contenido">
          <p className="py-2 text-sm text-zinc-500">El catálogo está vacío.</p>
        </Panel>
      ) : (
        courses.map((c) => (
          <Panel
            key={c.id}
            title={c.title}
            badge={
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${kindBadge[c.kind] ?? kindBadge.ebook}`}>
                  {KIND_LABEL[c.kind] ?? c.kind}
                </span>
                <span className="rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                  ${c.price_usd} USD
                </span>
              </span>
            }
          >
            {c.description && <p className="text-sm leading-relaxed text-zinc-300">{c.description}</p>}
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">{c.delivery_note}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {c.buy_url && (
                <a
                  href={c.buy_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Link de compra ↗
                </a>
              )}
              <DownloadButtons course={c} />
              <button
                onClick={() => setOpenId(openId === c.id ? null : c.id)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                {openId === c.id ? "Ocultar alumnos" : `Alumnos (${c.students_count})`}
              </button>
            </div>
            {openId === c.id && (
              <StudentsSection course={c} isAdmin={isAdmin} contacts={contacts} />
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
