"use client";

// Quiz corto por clase (Fase 5a, tarea 5): preguntas basadas SOLO en el
// material real de la clase, creadas por el admin (con fuente
// obligatoria). Sin preguntas, la clase se marca PENDIENTE en vez de
// inventar un quiz. La corrección es inmediata, con explicación breve,
// y el intento queda registrado en el servidor.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type QuizOut, type QuizQuestionAdmin, type QuizResult } from "../lib/api";
import { ApiErrorBanner, Field, apiErrorText } from "./ui";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";

function QuizAdminForm({
  classId,
  onAdded,
}: {
  classId: number;
  onAdded: () => void;
}) {
  const { t } = useLanguage();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correct, setCorrect] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clean = options.map((o) => o.trim()).filter((o) => o !== "");
      await api.createQuizQuestion(classId, {
        question: question.trim(),
        options: clean,
        correct_index: correct,
        explanation: explanation.trim(),
        source: source.trim(),
      });
      setQuestion("");
      setOptions(["", "", "", ""]);
      setCorrect(0);
      setExplanation("");
      setSource("");
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorText(err, t) : t.clases.quizErrSave);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} data-no-swipe className="mt-3 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="text-sm font-semibold text-zinc-100">{t.clases.quizAddTitle}</p>
      <Field label={t.clases.quizQLabel}>
        <input aria-label={t.clases.quizQLabel} className={inputCls} value={question} onChange={(e) => setQuestion(e.target.value)} required maxLength={1000} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((opt, i) => (
          <label key={i} className="text-xs text-zinc-400">
            {t.clases.quizOptLabel.replace("{n}", String(i + 1))}
            <span className="mt-1 flex items-center gap-2">
              <input
                className={inputCls}
                value={opt}
                onChange={(e) => setOptions((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                required={i < 2}
                maxLength={200}
                autoComplete="off"
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-zinc-200">
                <input
                  type="radio"
                  name={`quiz-${classId}-correct`}
                  checked={correct === i}
                  onChange={() => setCorrect(i)}
                  className="h-4 w-4 accent-emerald-500"
                />
                {t.clases.quizCorrectLabel}
              </label>
            </span>
          </label>
        ))}
      </div>
      <Field label={t.clases.quizExplLabel}>
        <input aria-label={t.clases.quizExplLabel} className={inputCls} value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={1000} autoComplete="off" />
      </Field>
      <Field label={t.clases.quizSourceLabel}>
        <input aria-label={t.clases.quizSourceLabel} className={inputCls} placeholder={t.clases.quizSourcePlaceholder} value={source} onChange={(e) => setSource(e.target.value)} required maxLength={300} autoComplete="off" />
      </Field>
      <button
        type="submit"
        disabled={busy || !question.trim() || !source.trim()}
        className="min-h-[44px] w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
      >
        {busy ? t.clases.quizAddBusy : t.clases.quizAdd}
      </button>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </form>
  );
}

export function ClassQuiz({ classId, isAdmin }: { classId: number; isAdmin: boolean }) {
  const { t } = useLanguage();
  const isCancelled = useCancelled();
  const [open, setOpen] = useState(false);
  const [quiz, setQuiz] = useState<QuizOut | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [adminQuestions, setAdminQuestions] = useState<QuizQuestionAdmin[] | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const q = await api.getQuiz(classId);
      if (isCancelled()) return;
      setQuiz(q);
      setLoadError(null);
      setResult(null);
      setAnswers({});
      if (isAdmin) {
        const aq = await api.listQuizQuestions(classId);
        if (isCancelled()) return;
        setAdminQuestions(aq);
      }
    } catch (err) {
      if (isCancelled()) return;
      setLoadError(err);
    }
  }, [classId, isAdmin, isCancelled]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const submit = async () => {
    if (!quiz) return;
    setSubmitBusy(true);
    setSubmitError(null);
    try {
      const r = await api.submitQuiz(classId, answers);
      if (isCancelled()) return;
      setResult(r);
    } catch (err) {
      if (isCancelled()) return;
      setSubmitError(err instanceof ApiError ? apiErrorText(err, t) : t.clases.quizSubmitErr);
    } finally {
      setSubmitBusy(false);
    }
  };

  const deleteQuestion = async (qid: number) => {
    setDeletingId(qid);
    try {
      await api.deleteQuizQuestion(classId, qid);
      await load();
    } catch {
      /* el error de borrado se ve al recargar la lista */
    } finally {
      setDeletingId((prev) => (prev === qid ? null : prev));
    }
  };

  const allAnswered = quiz !== null && quiz.questions.length > 0 && quiz.questions.every((q) => answers[q.id] !== undefined);
  const resultById = new Map((result?.results ?? []).map((r) => [r.question_id, r]));

  return (
    <div className="mt-2">
      <button
        data-no-swipe
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
      >
        {open ? t.clases.quizHide : t.clases.quizShow}
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-sm font-semibold text-zinc-100">{t.clases.quizTitle}</p>
          {loadError ? (
            <ApiErrorBanner error={loadError} t={t} onRetry={load} />
          ) : quiz === null ? (
            <p className="mt-2 text-sm text-zinc-400">{t.clases.quizLoading}</p>
          ) : !quiz.has_quiz ? (
            <p role="status" className="mt-2 text-sm leading-relaxed text-amber-400">{t.clases.quizPending}</p>
          ) : result !== null ? (
            <>
              <p role="status" className="mt-2 text-sm font-semibold text-zinc-100">
                {t.clases.quizScore.replace("{score}", String(result.score)).replace("{total}", String(result.total))}
              </p>
              <ul className="mt-3 space-y-3">
                {quiz.questions.map((q) => {
                  const r = resultById.get(q.id);
                  if (!r) return null;
                  return (
                    <li key={q.id} className={`rounded-lg border px-3 py-2.5 ${r.correct ? "border-emerald-800 bg-emerald-950/40" : "border-red-900/60 bg-red-950/30"}`}>
                      <p className="text-sm font-semibold text-zinc-100">{q.question}</p>
                      <p className={`mt-1 text-sm ${r.correct ? "text-emerald-400" : "text-red-400"}`}>
                        {r.correct
                          ? t.clases.quizCorrect
                          : t.clases.quizWrong.replace("{option}", q.options[r.correct_index] ?? "—")}
                      </p>
                      {r.explanation && (
                        <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                          {t.clases.quizExplanation.replace("{text}", r.explanation)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button
                data-no-swipe
                type="button"
                onClick={() => { setResult(null); setAnswers({}); }}
                className="mt-3 min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
              >
                {t.clases.quizRetry}
              </button>
            </>
          ) : (
            <>
              <div className="mt-3 space-y-4">
                {quiz.questions.map((q, qi) => (
                  <fieldset key={q.id}>
                    <legend className="text-sm font-semibold text-zinc-100">
                      {qi + 1}. {q.question}
                    </legend>
                    <div className="mt-2 space-y-2">
                      {q.options.map((opt, oi) => (
                        <label key={oi} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200">
                          <input
                            data-no-swipe
                            type="radio"
                            name={`quiz-${classId}-q-${q.id}`}
                            checked={answers[q.id] === oi}
                            onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                            className="h-4 w-4 shrink-0 accent-indigo-500"
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              {!allAnswered && (
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">{t.clases.quizAnswerAll}</p>
              )}
              {submitError && <p role="alert" className="mt-2 text-sm text-red-400">{submitError}</p>}
              <button
                data-no-swipe
                type="button"
                onClick={submit}
                disabled={!allAnswered || submitBusy}
                className="mt-3 min-h-[44px] w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
              >
                {submitBusy ? t.clases.quizSubmitting : t.clases.quizSubmit}
              </button>
            </>
          )}
          {isAdmin && (
            <div className="mt-4 border-t border-zinc-800 pt-3">
              <p className="text-sm font-semibold text-zinc-100">{t.clases.quizAdminTitle}</p>
              {adminQuestions === null ? (
                <p className="mt-1 text-sm text-zinc-400">{t.clases.quizLoading}</p>
              ) : adminQuestions.length === 0 ? (
                <p className="mt-1 text-sm text-zinc-400">{t.clases.quizAdminEmpty}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {adminQuestions.map((q) => (
                    <li key={q.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                      <p className="text-sm font-semibold text-zinc-100">{q.question}</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        {q.options.map((o, i) => (i === q.correct_index ? `✓ ${o}` : o)).join(" · ")}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">{t.clases.quizSource.replace("{source}", q.source)}</p>
                      <button
                        data-no-swipe
                        type="button"
                        onClick={() => deleteQuestion(q.id)}
                        disabled={deletingId === q.id}
                        className="mt-2 min-h-[36px] rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
                      >
                        {deletingId === q.id ? t.clases.progressMarkBusy : t.clases.quizDel}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <QuizAdminForm classId={classId} onAdded={load} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
