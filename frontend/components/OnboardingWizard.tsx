"use client";

import { useState } from "react";
import Link from "next/link";
import { useLanguage } from "../lib/i18n";
import { Panel } from "./Panel";
import {
  loadOnboarding,
  saveOnboarding,
  type OnboardingGoal,
  type OnboardingState,
} from "../lib/onboarding";

/** Guía inicial de 3 pasos (Fase 4 mejoras-v1, tarea 3):
 * 1) cuenta — la cuenta real con la que entró, ya lista;
 * 2) plan / primer objetivo — tarjetas de planes reales (enlazan a
 *    /planes) + un objetivo a elegir (decide por dónde empezar);
 * 3) primera acción — crear el primer contacto (solo admin: el rol
 *    Prueba es de solo lectura) o probar una herramienta.
 * Estado en localStorage por usuario (lib/onboarding.ts); "Omitir"
 * la cierra sin más. Solo se muestra si el usuario no la completó. */
const GOALS: { key: OnboardingGoal; href: string }[] = [
  { key: "clientes", href: "/crm" },
  { key: "facturar", href: "/facturas" },
  { key: "crear", href: "/crear" },
  { key: "practicar", href: "/" },
];

export function OnboardingWizard({
  username,
  isAdmin,
}: {
  username: string;
  isAdmin: boolean;
}) {
  const { t } = useLanguage();
  const o = t.onboarding;
  const [state, setState] = useState<OnboardingState>(() => loadOnboarding(username));

  if (state.done) return null;

  const update = (next: OnboardingState) => {
    setState(next);
    saveOnboarding(username, next);
  };
  const finish = () => update({ ...state, done: true });

  const plans = [
    { name: t.planes.nameEsencial, price: t.planes.priceEsencial },
    { name: t.planes.nameCrecimiento, price: t.planes.priceCrecimiento },
    { name: t.planes.nameTotal, price: t.planes.priceTotal },
  ];

  return (
    <Panel
      title={o.title}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {o.stepBadge.replace("{n}", String(state.step))}
        </span>
      }
    >
      {/* Progreso: 3 puntos, el actual en ámbar. */}
      <ol className="mb-4 flex items-center gap-2" aria-label={o.title}>
        {[1, 2, 3].map((n) => (
          <li key={n} className="flex items-center gap-2">
            <span
              aria-current={state.step === n ? "step" : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                state.step === n
                  ? "bg-amber-500 text-zinc-950"
                  : state.step > n
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {n}
            </span>
            {n < 3 && <span aria-hidden="true" className="h-px w-6 bg-zinc-700" />}
          </li>
        ))}
      </ol>

      {state.step === 1 && (
        <div>
          <h3 className="text-base font-bold text-zinc-100">{o.step1Title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">
            {o.step1Body.replace("{usuario}", username)}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{o.step1Note}</p>
        </div>
      )}

      {state.step === 2 && (
        <div>
          <h3 className="text-base font-bold text-zinc-100">{o.step2Title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{o.step2Body}</p>
          {/* A 390 px las 3 tarjetas apiladas (más cómodo que 3 columnas
              estrechas); a partir de 420 px, en fila. */}
          <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
            {plans.map((p) => (
              <Link
                key={p.name}
                href="/planes"
                className="rounded-lg border border-zinc-700 px-3 py-2.5 text-center hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <span className="block text-sm font-semibold text-zinc-100">{p.name}</span>
                <span className="mt-0.5 block text-sm font-bold text-amber-400">
                  {p.price}
                  {t.planes.perMonth}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-4 text-sm font-semibold text-zinc-200">{o.goalLabel}</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {GOALS.map((g) => (
              <button
                key={g.key}
                type="button"
                aria-pressed={state.goal === g.key}
                onClick={() => update({ ...state, goal: g.key })}
                className={`min-h-[44px] rounded-lg border px-3 py-2.5 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                  state.goal === g.key
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                    : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                {o[`goal_${g.key}`]}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.step === 3 && (
        <div>
          <h3 className="text-base font-bold text-zinc-100">{o.step3Title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{o.step3Body}</p>
          {state.goal && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {o.goalChosen} <strong className="text-zinc-200">{o[`goal_${state.goal}`]}</strong>
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {isAdmin ? (
              <Link
                href="/crm"
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {o.actionContact}
              </Link>
            ) : (
              <p className="flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm leading-relaxed text-zinc-400">
                {o.readOnlyNote}
              </p>
            )}
            <Link
              href="/estudiar"
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {o.actionTool}
            </Link>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {state.step > 1 && (
          <button
            type="button"
            onClick={() => update({ ...state, step: (state.step - 1) as 1 | 2 })}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {o.back}
          </button>
        )}
        {state.step < 3 ? (
          <button
            type="button"
            onClick={() => update({ ...state, step: (state.step + 1) as 2 | 3 })}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            {o.next}
          </button>
        ) : (
          <button
            type="button"
            onClick={finish}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            {o.finish}
          </button>
        )}
        <button
          type="button"
          onClick={finish}
          className="ml-auto inline-flex min-h-[44px] items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {o.skip}
        </button>
      </div>
    </Panel>
  );
}
