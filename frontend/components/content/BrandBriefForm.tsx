// Formulario + resumen del Test exprés para Brief de Marca (NEST, 2026-11-17).
// Las 8 preguntas usan el texto EXACTO de Rubén (i18n `brief.qNText` /
// `qNHelp`). La Q2 pide 3 palabras: el contador avisa si no son 3,
// nunca bloquea el guardado. Guardado parcial por pregunta: el
// servidor solo aplica las respuestas enviadas.
"use client";

import { useEffect, useState } from "react";
import { ApiError, type BrandBrief, type BrandBriefInput } from "../../lib/api";
import { BRIEF_QUESTIONS, briefAnswered, countWords } from "../../lib/brief";
import { useLanguage } from "../../lib/i18n";
import { Panel } from "../Panel";
import { Field } from "../ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

export function BrandBriefForm({
  brief,
  contactName,
  onSave,
}: {
  brief: BrandBrief | null;
  contactName: string;
  onSave: (answers: BrandBriefInput) => Promise<BrandBrief>;
}) {
  const { t } = useLanguage();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [view, setView] = useState<"form" | "summary">("form");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (brief) setAnswers({ ...brief.answers });
  }, [brief]);

  const answered = briefAnswered(answers);
  const q2Words = countWords(answers.q2 || "");
  const q2Warning = (answers.q2 || "").trim() !== "" && q2Words !== 3;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setMsg(null);
    setBusy(true);
    try {
      await onSave(answers);
      setMsg(t.brief.msgSaved);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t.brief.errSave);
    } finally {
      setBusy(false);
    }
  };

  const questionText = (n: number) => (t.brief as Record<string, string>)[`q${n}Text`] ?? "";
  const questionHelp = (n: number) => (t.brief as Record<string, string>)[`q${n}Help`] ?? "";

  return (
    <Panel title={`${t.brief.panelTitle} — ${contactName}`}>
      <div className="mb-4">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-zinc-300">
            {t.brief.progress.replace("{n}", String(answered))}
          </span>
          <span className="text-xs text-zinc-400">
            {answered}/8
          </span>
        </div>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-800"
          role="progressbar"
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={8}
          aria-label={t.brief.progress.replace("{n}", String(answered))}
        >
          <div
            className="h-2 rounded-full bg-emerald-600"
            style={{ width: `${(answered / 8) * 100}%` }}
          />
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setView("form")}
          aria-pressed={view === "form"}
          className={
            view === "form"
              ? "min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
              : "min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800"
          }
        >
          {t.brief.viewForm}
        </button>
        <button
          type="button"
          onClick={() => setView("summary")}
          aria-pressed={view === "summary"}
          className={
            view === "summary"
              ? "min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
              : "min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800"
          }
        >
          {t.brief.viewSummary}
        </button>
      </div>

      {view === "summary" ? (
        <div className="space-y-4">
          {answered === 0 && (
            <p className="text-sm text-zinc-400">{t.brief.emptySummary}</p>
          )}
          {BRIEF_QUESTIONS.map((n) => {
            const answer = (answers[`q${n}`] || "").trim();
            return (
              <div key={n} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="text-sm font-semibold text-zinc-100">{questionText(n)}</p>
                {answer ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{answer}</p>
                ) : (
                  <p className="mt-1 text-sm italic text-zinc-500">—</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <form onSubmit={save} className="space-y-5">
          <p className="text-sm leading-relaxed text-zinc-400">{t.brief.intro}</p>
          {BRIEF_QUESTIONS.map((n) => (
            <div key={n}>
              <Field label={questionText(n)}>
                <textarea
                  aria-label={questionText(n)}
                  className={inputCls}
                  rows={n === 2 ? 2 : 3}
                  placeholder={t.brief.answerPlaceholder}
                  value={answers[`q${n}`] || ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [`q${n}`]: e.target.value }))
                  }
                  maxLength={5000}
                />
              </Field>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">{questionHelp(n)}</p>
              {n === 2 && (
                <p className="mt-1 text-xs text-zinc-400">
                  {t.brief.q2Hint} · {t.brief.q2Words.replace("{n}", String(q2Words))}
                  {q2Warning && (
                    <span className="ml-2 font-semibold text-amber-300">
                      {t.brief.q2Warning.replace("{n}", String(q2Words))}
                    </span>
                  )}
                </p>
              )}
            </div>
          ))}
          {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
          >
            {busy ? t.brief.saving : t.brief.save}
          </button>
        </form>
      )}
    </Panel>
  );
}
