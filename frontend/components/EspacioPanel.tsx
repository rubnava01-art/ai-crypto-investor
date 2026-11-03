"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type EmotionEntry, type MeResponse, type Revelation } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { AmbientSound } from "./AmbientSound";
import { Panel } from "./Panel";
import { useConfirm, Field } from "./ui";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;

/* ------------------------------------------------------------------ */
/* Meditación: respiración guiada 4-4-6 + temporizador, todo local.    */
/* ------------------------------------------------------------------ */

type BreathPhaseId = "inhale" | "hold" | "exhale";
type BreathPhase = { id: BreathPhaseId; seconds: number };

const BREATH: BreathPhase[] = [
  { id: "inhale", seconds: 4 },
  { id: "hold", seconds: 4 },
  { id: "exhale", seconds: 6 },
];

function MeditationPanel() {
  const { t } = useLanguage();
  const [breathing, setBreathing] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [phaseLeft, setPhaseLeft] = useState(BREATH[0].seconds);
  const [cycles, setCycles] = useState(0);
  const [timerMin, setTimerMin] = useState(5);
  const [timerLeft, setTimerLeft] = useState<number | null>(null);
  const [timerDone, setTimerDone] = useState(false);
  const breathTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopBreath = useCallback(() => {
    if (breathTimer.current) clearInterval(breathTimer.current);
    breathTimer.current = null;
    setBreathing(false);
  }, []);

  useEffect(() => () => {
    stopBreath();
    if (timerRef.current) clearInterval(timerRef.current);
  }, [stopBreath]);

  const startBreath = () => {
    stopBreath();
    setPhaseIdx(0);
    setPhaseLeft(BREATH[0].seconds);
    setCycles(0);
    setBreathing(true);
    breathTimer.current = setInterval(() => {
      setPhaseLeft((left) => {
        if (left > 1) return left - 1;
        setPhaseIdx((idx) => {
          const next = (idx + 1) % BREATH.length;
          if (next === 0) setCycles((c) => c + 1);
          setPhaseLeft(BREATH[next].seconds);
          return next;
        });
        return left;
      });
    }, 1000);
  };

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerDone(false);
    setTimerLeft(timerMin * 60);
    timerRef.current = setInterval(() => {
      setTimerLeft((left) => {
        if (left === null || left <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setTimerDone(true);
          return 0;
        }
        return left - 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setTimerLeft(null);
    setTimerDone(false);
  };

  const phase = BREATH[phaseIdx];
  const phaseLabel = t.espacio[phase.id];
  const circleScale = phase.id === "inhale" ? 1.25 : phase.id === "exhale" ? 0.8 : 1.1;
  const mm = timerLeft === null ? null : `${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, "0")}`;

  return (
    <Panel
      title={t.espacio.meditationTitle}
      badge={
        <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-semibold text-teal-300">
          {t.espacio.breatheBadge}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.espacio.meditationIntro}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-center shadow-sm">
          <div
            className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-teal-500/20 ring-1 ring-teal-500/30 transition-transform duration-1000 motion-reduce:transition-none"
            style={{ transform: `scale(${breathing ? circleScale : 1})` }}
          >
            <span className="text-lg font-semibold text-teal-200">
              {breathing ? phaseLabel : t.espacio.breatheIdle}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            {breathing ? (
              <>
                {phaseLeft}s · {t.espacio.cycle.replace("{nombre}", String(cycles + 1))}
              </>
            ) : (
              t.espacio.rhythmIdle
            )}
          </p>
          <button
            type="button"
            onClick={breathing ? stopBreath : startBreath}
            className="mt-4 min-h-[44px] w-full rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            {breathing ? t.espacio.stopBreath : t.espacio.startBreath}
          </button>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-center shadow-sm">
          <p className="text-4xl font-bold tracking-wider text-zinc-100">
            {mm ?? `${timerMin}:00`}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            {timerDone ? t.espacio.timerDone : timerLeft !== null ? t.espacio.timerRunning : t.espacio.timerIdle}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            {[5, 10, 15].map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={timerMin === m}
                onClick={() => { setTimerMin(m); setTimerLeft(null); setTimerDone(false); }}
                className={`min-h-[44px] rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${timerMin === m ? "bg-teal-600 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
              >
                {m} {t.espacio.min}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={timerLeft !== null && !timerDone ? stopTimer : startTimer}
            className="mt-4 min-h-[44px] w-full rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            {timerLeft !== null && !timerDone ? t.espacio.stopTimer : t.espacio.startMeditation}
          </button>
        </div>
      </div>

      {/* Sonido ambiental: independiente de la respiración y del temporizador. */}
      <AmbientSound />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Revelaciones: diario personal (lo escribes tú, nada inventado).     */
/* ------------------------------------------------------------------ */

function RevelationsPanel({ isAdmin }: { isAdmin: boolean }) {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [rows, setRows] = useState<Revelation[] | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const _load1 = await api.listRevelations();
      if (isCancelled()) return;
      setRows(_load1);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createRevelation({ title: title.trim(), text });
      setMsg(t.espacio.saved);
      setTitle("");
      setText("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.espacio.saveError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Revelation) => {
    if (!(await confirm(t.espacio.deleteConfirm.replace("{nombre}", r.title)))) return;
    setError(null);
    try {
      await api.deleteRevelation(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.espacio.deleteError);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={t.espacio.revelationsTitle}
      badge={
        <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-semibold text-teal-300">
          {rows === null ? t.espacio.loading : t.espacio.notesCount.replace("{nombre}", String(rows.length))}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.espacio.revelationsIntro}
        {!isAdmin && t.espacio.readOnly}
      </p>

      {isAdmin && (
        <form onSubmit={add} className="space-y-3">
          <Field label={t.espacio.titleAria}><input aria-label={t.espacio.titleAria} className={inputCls} placeholder={t.espacio.titlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
          <Field label={t.espacio.textAria}><textarea aria-label={t.espacio.textAria} className={inputCls} placeholder={t.espacio.textPlaceholder} value={text} onChange={(e) => setText(e.target.value)} rows={3} /></Field>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="min-h-[44px] w-full rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t.espacio.saving : t.espacio.saveRevelation}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {rows === null ? (
          <p className="py-2 text-sm text-zinc-500">{t.espacio.loadingRevelations}</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{t.espacio.emptyRevelations}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{r.title}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{fmtDate(r.created_at, locale)}</span>
                    {isAdmin && (
                      <button
                        onClick={() => remove(r)}
                        className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                      >
                        {t.espacio.delete}
                      </button>
                    )}
                  </span>
                </div>
                {r.text && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{r.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Manejo de emociones: registro diario manual (patrón Monitor de      */
/* Emociones). Misma persistencia que las revelaciones: backend,      */
/* lectura para cualquier autenticado, escritura solo admin. Nada se   */
/* genera solo: cada registro lo escribe el usuario.                  */
/* ------------------------------------------------------------------ */

const EMOTION_OPTIONS = [
  { id: "tranquilo", key: "emotionCalm" },
  { id: "contento", key: "emotionHappy" },
  { id: "estresado", key: "emotionStressed" },
  { id: "cansado", key: "emotionTired" },
  { id: "motivado", key: "emotionMotivated" },
  { id: "triste", key: "emotionSad" },
  { id: "ansioso", key: "emotionAnxious" },
  { id: "agradecido", key: "emotionGrateful" },
] as const;

function EmotionsPanel({ isAdmin }: { isAdmin: boolean }) {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const emotionLabel = (id: string) => {
    const opt = EMOTION_OPTIONS.find((o) => o.id === id);
    return opt ? (t.espacio[opt.key] as string) : id;
  };
  const [rows, setRows] = useState<EmotionEntry[] | null>(null);
  const [emotion, setEmotion] = useState<string>(EMOTION_OPTIONS[0].id);
  const [intensity, setIntensity] = useState(3);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<EmotionEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const _load2 = await api.listEmotions();
      if (isCancelled()) return;
      setRows(_load2);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEmotion(EMOTION_OPTIONS[0].id);
    setIntensity(3);
    setNote("");
    setEditing(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      if (editing) {
        await api.updateEmotion(editing.id, { emotion, intensity, note });
      } else {
        await api.createEmotion({ emotion, intensity, note });
      }
      setMsg(t.espacio.savedEmotion);
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.espacio.saveError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: EmotionEntry) => {
    if (!(await confirm(t.espacio.deleteEmotionConfirm.replace("{nombre}", emotionLabel(r.emotion))))) return;
    setError(null);
    try {
      await api.deleteEmotion(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.espacio.deleteError);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={t.espacio.emotionsTitle}
      badge={
        <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-semibold text-teal-300">
          {rows === null ? t.espacio.loading : t.espacio.emotionsCount.replace("{nombre}", String(rows.length))}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.espacio.emotionsIntro}
        {!isAdmin && t.espacio.readOnly}
      </p>

      {isAdmin && (
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="emocion-registro" className="text-xs font-semibold text-zinc-300">
                {t.espacio.emotionAria}
              </label>
              <Field label={t.espacio.emotionAria}><select
                id="emocion-registro"
                aria-label={t.espacio.emotionAria}
                className={`${inputCls} mt-1`}
                value={emotion}
                onChange={(e) => setEmotion(e.target.value)}
              >
                {EMOTION_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t.espacio[o.key] as string}
                  </option>
                ))}
              </select></Field>
            </div>
            <div>
              <p id="intensidad-etiqueta" className="text-xs font-semibold text-zinc-300">
                {t.espacio.intensityLabel.replace("{nombre}", String(intensity))}
              </p>
              <div className="mt-1 flex gap-1.5" role="group" aria-labelledby="intensidad-etiqueta">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={intensity === n}
                    aria-label={`${t.espacio.intensityAria}: ${n}`}
                    onClick={() => setIntensity(n)}
                    className={`min-h-[44px] min-w-[44px] rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${intensity === n ? "bg-teal-600 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Field label={t.espacio.noteAria}><textarea aria-label={t.espacio.noteAria} className={inputCls} placeholder={t.espacio.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t.espacio.saving : editing ? t.espacio.updateEmotion : t.espacio.saveEmotion}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
                {t.espacio.cancelEdit}
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {rows === null ? (
          <p className="py-2 text-sm text-zinc-500">{t.espacio.loadingEmotions}</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{t.espacio.emptyEmotions}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{emotionLabel(r.emotion)}</span>
                  <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-semibold text-teal-300">
                    {t.espacio.intensityLabel.replace("{nombre}", String(r.intensity))}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{fmtDate(r.created_at, locale)}</span>
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => { setEditing(r); setEmotion(r.emotion); setIntensity(r.intensity); setNote(r.note); }}
                          className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                        >
                          {t.espacio.editEmotion}
                        </button>
                        <button
                          onClick={() => remove(r)}
                          className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                        >
                          {t.espacio.delete}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {r.note && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{r.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
    </>
  );
}

export function EspacioPanel() {
  const isCancelled = useCancelled();
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then((v) => { if (!isCancelled()) setMe(v); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, []);

  return (
    <div className="space-y-4">
      <MeditationPanel />
      <EmotionsPanel isAdmin={isAdmin} />
      <RevelationsPanel isAdmin={isAdmin} />
    </div>
  );
}
