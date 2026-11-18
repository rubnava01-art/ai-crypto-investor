// Formulario de cita (NEST, 2026-11-17): crear/editar. Solo admin.
// Fecha + hora en inputs separados (mejor UX en iOS que datetime-local);
// se guardan como ISO UTC interpretando la hora de pared en
// America/Los_Angeles (lib/dates.ts). Duración 15–480 min.
"use client";

import { useState } from "react";
import { api, ApiError, type Appointment, type CrmContact } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import { Field } from "../ui";
import { combineDateTimeToIso, toDateInputValue, toTimeInputValue } from "../../lib/dates";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

export function AppointmentForm({
  contacts,
  initial,
  onSaved,
  onCancel,
}: {
  contacts: CrmContact[];
  initial?: Appointment | null;
  onSaved: (msg: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [contactId, setContactId] = useState<string>(initial?.contact_id ? String(initial.contact_id) : "");
  const [clientName, setClientName] = useState(initial?.client_name ?? "");
  const [service, setService] = useState(initial?.service_type ?? "");
  const [date, setDate] = useState(toDateInputValue(initial?.starts_at));
  const [time, setTime] = useState(toTimeInputValue(initial?.starts_at) || "10:00");
  const [duration, setDuration] = useState(String(initial?.duration_min ?? 60));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickContact = (id: string) => {
    setContactId(id);
    if (id) {
      const c = contacts.find((x) => String(x.id) === id);
      if (c) setClientName(c.name);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const name = clientName.trim();
    const svc = service.trim();
    const dur = Number(duration);
    if (!name || !svc || !date || !time || !Number.isFinite(dur) || dur < 15 || dur > 480) {
      setError(t.citas.errSave);
      return;
    }
    setBusy(true);
    try {
      const starts_at = combineDateTimeToIso(date, time);
      if (initial) {
        // El backend rechaza starts_at en el pasado (422): en edición solo
        // se envía la fecha/hora si cambió respecto a la cita guardada.
        const initialDate = toDateInputValue(initial.starts_at);
        const initialTime = toTimeInputValue(initial.starts_at);
        const patch: { service_type: string; notes: string; starts_at?: string; duration_min?: number } = {
          service_type: svc,
          notes: notes.trim(),
        };
        if (date !== initialDate || time !== initialTime) patch.starts_at = starts_at;
        if (dur !== initial.duration_min) patch.duration_min = dur;
        await api.updateAppointment(initial.id, patch);
        onSaved(t.citas.msgUpdated);
      } else {
        await api.createAppointment({
          contact_id: contactId ? Number(contactId) : null,
          client_name: name,
          service_type: svc,
          starts_at,
          duration_min: dur,
          notes: notes.trim(),
        });
        onSaved(t.citas.msgCreated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.citas.errSave);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-sm font-semibold text-zinc-200">{initial ? t.citas.formEditTitle : t.citas.formTitle}</p>
      <Field label={t.citas.clientAria}>
        <select
          aria-label={t.citas.clientAria}
          className={inputCls}
          value={contactId}
          onChange={(e) => pickContact(e.target.value)}
        >
          <option value="">{t.citas.clientOption}</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label={t.citas.clientNameAria}>
        <input
          aria-label={t.citas.clientNameAria}
          className={inputCls}
          placeholder={t.citas.clientNamePlaceholder}
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          required
          maxLength={200}
          autoComplete="off"
        />
      </Field>
      <Field label={t.citas.serviceAria}>
        <input
          aria-label={t.citas.serviceAria}
          className={inputCls}
          placeholder={t.citas.servicePlaceholder}
          value={service}
          onChange={(e) => setService(e.target.value)}
          required
          maxLength={128}
          autoComplete="off"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.citas.dateAria}>
          <input
            aria-label={t.citas.dateAria}
            type="date"
            className={inputCls}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field label={t.citas.timeAria}>
          <input
            aria-label={t.citas.timeAria}
            type="time"
            className={inputCls}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label={t.citas.durationAria}>
        <input
          aria-label={t.citas.durationAria}
          type="number"
          min={15}
          max={480}
          step={15}
          className={inputCls}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          required
        />
      </Field>
      <Field label={t.citas.notesAria}>
        <textarea
          aria-label={t.citas.notesAria}
          className={inputCls}
          rows={2}
          placeholder={t.citas.notesPlaceholder}
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
        />
      </Field>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
        >
          {busy ? t.citas.saving : t.citas.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {t.citas.cancelBtn}
        </button>
      </div>
    </form>
  );
}
