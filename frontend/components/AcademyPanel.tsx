"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type AcademyCourse, type AcademyEnrollment, type CrmContact, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const kindBadge: Record<string, string> = {
  ebook: "bg-sky-500/15 text-sky-300",
  pack: "bg-violet-500/15 text-violet-300",
  academia: "bg-emerald-500/15 text-emerald-300",
};

const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;

function StudentsSection({ course, isAdmin, contacts }: { course: AcademyCourse; isAdmin: boolean; contacts: CrmContact[] }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [students, setStudents] = useState<AcademyEnrollment[] | null>(null);
  const [contactId, setContactId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStudents(await api.listStudents(course.id));
    } catch {
      setStudents([]);
      setLoadError(t.academy.loadError);
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
      setError(err instanceof ApiError ? err.message : t.academy.errRegister);
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
      setError(err instanceof ApiError ? err.message : t.academy.errUpdateDelivery);
    }
  };

  const remove = async (enr: AcademyEnrollment) => {
    if (!window.confirm(t.academy.confirmRemove.replace("{nombre}", enr.contact_name).replace("{curso}", course.title))) return;
    setError(null);
    try {
      await api.deleteEnrollment(enr.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.academy.errRemove);
    }
  };

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {t.academy.students} ({students === null ? "…" : students.length})
      </p>
      {loadError && (
        <p role="alert" className="py-2 text-sm text-red-400">
          {loadError}
        </p>
      )}
      {students === null ? (
        <p className="py-2 text-sm text-zinc-500">{t.academy.loadingStudents}</p>
      ) : students.length === 0 && !loadError ? (
        <p className="py-2 text-sm text-zinc-500">{t.academy.emptyStudents}</p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {students.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-semibold text-zinc-100">{s.contact_name}</span>
              {s.contact_email && <span className="text-xs text-zinc-500">{s.contact_email}</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.purchased ? "bg-sky-500/15 text-sky-300" : "bg-zinc-500/15 text-zinc-400"}`}>
                {s.purchased ? `${t.academy.purchased}${fmtDate(s.purchased_at, locale) ? ` · ${fmtDate(s.purchased_at, locale)}` : ""}` : t.academy.noPurchase}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.delivered ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                {s.delivered ? `${t.academy.delivered}${fmtDate(s.delivered_at, locale) ? ` · ${fmtDate(s.delivered_at, locale)}` : ""}` : t.academy.pendingDelivery}
              </span>
              {isAdmin && (
                <span className="ml-auto flex gap-1.5">
                  <button
                    onClick={() => toggleDelivered(s)}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    {s.delivered ? t.academy.markUndelivered : t.academy.markDelivered}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                  >
                    {t.academy.remove}
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
            aria-label={t.academy.contactAria}
            required
          >
            <option value="">{t.academy.selectContact}</option>
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
            {busy ? t.academy.registerBusy : t.academy.register}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

function DownloadButtons({ course }: { course: AcademyCourse }) {
  const { t } = useLanguage();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!course.downloads || course.downloads.length === 0) return null;

  const download = async (d: AcademyCourse["downloads"][number]) => {
    setBusyId(d.course_id);
    setError(null);
    try {
      await api.downloadCoursePdf(d.course_id, d.filename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.academy.errDownload);
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
            ? t.academy.downloadBusy
            : course.downloads.length > 1
              ? t.academy.pdfTitle.replace("{titulo}", d.title)
              : t.academy.downloadPdf}
        </button>
      ))}
      {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    </>
  );
}

export function AcademyPanel() {
  const { t } = useLanguage();
  const kindLabel = (k: string) => (k === "ebook" ? t.academy.kindEbook : k === "pack" ? t.academy.kindPack : k === "academia" ? t.academy.kindAcademia : k);
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
        title={t.academy.panelTitle}
        badge={
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {courses === null ? t.academy.badgeLoading : `${courses.length} ${t.academy.productsWord}`}
          </span>
        }
      >
        <p className="text-sm leading-relaxed text-zinc-400">
          {t.academy.intro}
          {!isAdmin && t.academy.readonly}
        </p>
      </Panel>

      {courses === null ? (
        <Panel title={t.academy.loadingCatalogTitle}>
          <p className="py-2 text-sm text-zinc-500">{t.academy.loading}</p>
        </Panel>
      ) : courses.length === 0 ? (
        <Panel title={t.academy.emptyTitle}>
          <p className="py-2 text-sm text-zinc-500">{t.academy.emptyText}</p>
        </Panel>
      ) : (
        courses.map((c) => (
          <Panel
            key={c.id}
            title={c.title}
            badge={
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${kindBadge[c.kind] ?? kindBadge.ebook}`}>
                  {kindLabel(c.kind)}
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
                  {t.academy.buyLink}
                </a>
              )}
              <DownloadButtons course={c} />
              <button
                onClick={() => setOpenId(openId === c.id ? null : c.id)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                {openId === c.id ? t.academy.hideStudents : `${t.academy.students} (${c.students_count})`}
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
