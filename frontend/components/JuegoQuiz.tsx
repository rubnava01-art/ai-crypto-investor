"use client";

import { useState } from "react";
import { useLanguage } from "../lib/i18n";
import { useSwipeNav } from "../lib/useSwipeNav";

/** Interactive platform quiz, client-side only: no backend, no fetch, no
 * new dependency. One question at a time, instant feedback per answer,
 * final score with a fun tier message. Option order is identical in ES
 * and EN, so the correct index below is language-independent. */

type Question = { text: string; options: [string, string, string]; correct: number; why: string };

export function JuegoQuiz() {
  const { t } = useLanguage();
  const j = t.juego;
  const questions: Question[] = [
    { text: j.q1Text, options: [j.q1A, j.q1B, j.q1C], correct: 1, why: j.q1Why },
    { text: j.q2Text, options: [j.q2A, j.q2B, j.q2C], correct: 0, why: j.q2Why },
    { text: j.q3Text, options: [j.q3A, j.q3B, j.q3C], correct: 1, why: j.q3Why },
    { text: j.q4Text, options: [j.q4A, j.q4B, j.q4C], correct: 1, why: j.q4Why },
    { text: j.q5Text, options: [j.q5A, j.q5B, j.q5C], correct: 1, why: j.q5Why },
    { text: j.q6Text, options: [j.q6A, j.q6B, j.q6C], correct: 1, why: j.q6Why },
    { text: j.q7Text, options: [j.q7A, j.q7B, j.q7C], correct: 2, why: j.q7Why },
    { text: j.q8Text, options: [j.q8A, j.q8B, j.q8C], correct: 1, why: j.q8Why },
    { text: j.q9Text, options: [j.q9A, j.q9B, j.q9C], correct: 1, why: j.q9Why },
    { text: j.q10Text, options: [j.q10A, j.q10B, j.q10C], correct: 1, why: j.q10Why },
  ];
  const total = questions.length;
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const restart = () => {
    setIndex(0);
    setPicked(null);
    setScore(0);
    setDone(false);
  };

  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    if (i === questions[index].correct) setScore((s) => s + 1);
  };

  const next = () => {
    if (index + 1 >= total) {
      setDone(true);
    } else {
      setIndex((n) => n + 1);
      setPicked(null);
    }
  };

  const answered = picked !== null;
  // Swipe izquierda para avanzar, solo con la pregunta respondida.
  // Swipe derecha: sin acción — el quiz es de avance único, no hay
  // pregunta anterior. El botón Siguiente es la alternativa visible.
  const quizSwipe = useSwipeNav({ onSwipeLeft: answered ? next : undefined });

  if (done) {
    const tier = score === total ? j.tier10 : score >= 7 ? j.tier79 : score >= 4 ? j.tier46 : j.tier03;
    return (
      <section aria-label={j.quizTitle} className="rounded-2xl border-2 border-sky-500/60 bg-sky-500/10 px-4 py-4 sm:px-5">
        <h2 className="text-base font-bold text-zinc-100">{j.quizFinished}</h2>
        <p className="mt-2 text-lg font-bold text-zinc-100">{j.quizResult.replace("{score}", String(score)).replace("{total}", String(total))}</p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-300">{tier}</p>
        <button
          type="button"
          onClick={restart}
          className="mt-4 flex min-h-[44px] items-center rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-500 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
        >
          {j.quizRestart}
        </button>
      </section>
    );
  }

  const q = questions[index];
  const isCorrect = picked === q.correct;
  const g = t.estudiarGestos;
  return (
    <section aria-label={j.quizTitle} data-estudiar {...quizSwipe} className="rounded-2xl border-2 border-sky-500/60 bg-sky-500/10 px-4 py-4 sm:px-5">
      <h2 className="text-base font-bold text-zinc-100">{j.quizTitle}</h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-300">{j.quizIntro}</p>
      <p className="mt-3 text-xs font-semibold text-zinc-400">{j.quizProgress.replace("{n}", String(index + 1)).replace("{total}", String(total))}</p>
      <div
        role="progressbar"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={g.quizProgressAria.replace("{n}", String(index + 1)).replace("{total}", String(total))}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-sky-500 motion-safe:transition-[width]"
          style={{ width: `${((index + 1) / total) * 100}%` }}
        />
      </div>
      {answered && <p className="mt-1 text-xs text-zinc-400">{g.quizSwipeHint}</p>}
      <p className="mt-2 text-base font-semibold leading-relaxed text-zinc-100">{q.text}</p>
      <div className="mt-3 space-y-2">
        {q.options.map((opt, i) => {
          const isPicked = picked === i;
          const isAnswer = i === q.correct;
          const cls = !answered
            ? "border-zinc-700 bg-zinc-900/70 hover:border-sky-500 hover:bg-zinc-800"
            : isAnswer
              ? "border-emerald-500 bg-emerald-500/10"
              : isPicked
                ? "border-red-500 bg-red-500/10"
                : "border-zinc-700 bg-zinc-900/70 opacity-60";
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={answered}
              aria-pressed={isPicked}
              className={`flex min-h-[44px] w-full items-center rounded-xl border px-4 py-3 text-left text-sm font-semibold text-zinc-100 transition-colors motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${cls}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {answered && (
        <div aria-live="polite" className="mt-4 space-y-2">
          <p className={`text-sm font-bold ${isCorrect ? "text-emerald-300" : "text-red-300"}`}>
            {isCorrect ? j.quizCorrect : `${j.quizWrong} ${q.options[q.correct]}`}
          </p>
          <p className="text-sm leading-relaxed text-zinc-300">{q.why}</p>
          <button
            type="button"
            onClick={next}
            className="flex min-h-[44px] items-center rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-500 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            {index + 1 >= total ? j.quizFinish : j.quizNext}
          </button>
        </div>
      )}
    </section>
  );
}
