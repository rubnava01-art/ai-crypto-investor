"use client";

import { useState } from "react";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import {
  textosAnalisisPersonal,
  preguntasEncuesta,
  preguntasEstres,
  preguntasEnfoque,
  bandaDeSuma,
  type LadoEncuesta,
} from "./analisis-personal-texts";

type TabAP = "lean" | "encuesta" | "estres";

const tabBtn = (active: boolean) =>
  `min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
    active ? "bg-teal-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
  }`;

const optBtn = (selected: boolean) =>
  `min-h-[44px] w-full rounded-lg border px-4 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
    selected
      ? "border-teal-500 bg-teal-950 text-teal-100"
      : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500"
  }`;

const primaryBtn =
  "min-h-[44px] rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

const ghostBtn =
  "min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

/** Análisis personal dentro de Mi perfil: modelo Lean Startup, encuesta
 * rápida de pros/áreas a mejorar y autochequeo de estrés y enfoque.
 * Todo es solo cliente: las respuestas viven en el estado local, nada
 * se guarda ni se envía. Los resultados son conteos descriptivos, no
 * medidas clínicas ni diagnósticos. */
export function AnalisisPersonalPanel() {
  const { lang } = useLanguage();
  const tx = textosAnalisisPersonal[lang];
  const [tab, setTab] = useState<TabAP>("lean");

  // Encuesta rápida: un lado por pregunta (null = sin responder).
  const [respEncuesta, setRespEncuesta] = useState<(LadoEncuesta | null)[]>(Array(12).fill(null));
  const [verEncuesta, setVerEncuesta] = useState(false);

  // Estrés (0-4) + enfoque (5-9): un valor 0-3 por pregunta.
  const [respEstres, setRespEstres] = useState<(number | null)[]>(Array(10).fill(null));
  const [verEstres, setVerEstres] = useState(false);

  const preguntas = preguntasEncuesta[lang];
  const pEstres = preguntasEstres[lang];
  const pEnfoque = preguntasEnfoque[lang];

  const encuestaCompleta = respEncuesta.every((r) => r !== null);
  const estresCompleto = respEstres.every((r) => r !== null);

  const pros = preguntas.filter((_, i) => respEncuesta[i] === "pro").map((p) => p.tema);
  const mejoras = preguntas.filter((_, i) => respEncuesta[i] === "mejora").map((p) => p.tema);
  const mensajeEncuesta =
    pros.length > mejoras.length ? tx.encuesta.mensajeFuerte
    : pros.length === mejoras.length ? tx.encuesta.mensajeEquilibrio
    : tx.encuesta.mensajeTrabajo;

  const sumaEstres = respEstres.slice(0, 5).reduce<number>((a, v) => a + (v ?? 0), 0);
  const sumaEnfoque = respEstres.slice(5, 10).reduce<number>((a, v) => a + (v ?? 0), 0);
  const bandaEstres = bandaDeSuma(sumaEstres);
  const bandaEnfoque = bandaDeSuma(sumaEnfoque);
  const nombreBanda = { baja: tx.estres.bandaBaja, media: tx.estres.bandaMedia, alta: tx.estres.bandaAlta };
  const textoEstres = { baja: tx.estres.estresBajo, media: tx.estres.estresMedio, alta: tx.estres.estresAlto };
  const textoEnfoque = { baja: tx.estres.enfoqueBajo, media: tx.estres.enfoqueMedio, alta: tx.estres.enfoqueAlto };

  return (
    <Panel title={tx.titulo} badge={<span className="rounded-full bg-teal-900 px-3 py-1 text-xs font-semibold text-teal-200">Personal</span>}>
      <p className="text-sm leading-relaxed text-zinc-400">{tx.intro}</p>
      <p className="mt-2 text-xs text-zinc-500">{tx.notaPrivacidad}</p>

      <div role="tablist" aria-label={tx.titulo} className="mt-4 flex flex-wrap gap-2">
        <button role="tab" aria-selected={tab === "lean"} onClick={() => setTab("lean")} className={tabBtn(tab === "lean")}>
          {tx.pestanas.lean}
        </button>
        <button role="tab" aria-selected={tab === "encuesta"} onClick={() => setTab("encuesta")} className={tabBtn(tab === "encuesta")}>
          {tx.pestanas.encuesta}
        </button>
        <button role="tab" aria-selected={tab === "estres"} onClick={() => setTab("estres")} className={tabBtn(tab === "estres")}>
          {tx.pestanas.estres}
        </button>
      </div>

      {tab === "lean" && (
        <div className="mt-5 space-y-4">
          <h3 className="text-base font-semibold text-zinc-100">{tx.lean.titulo}</h3>
          <p className="text-sm leading-relaxed text-zinc-400">{tx.lean.intro}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {tx.lean.pasos.map((p) => (
              <div key={p.titulo} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm font-semibold text-teal-300">{p.titulo}</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{p.texto}</p>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {[
              { t: tx.lean.mvpTitulo, x: tx.lean.mvpTexto },
              { t: tx.lean.validadoTitulo, x: tx.lean.validadoTexto },
              { t: tx.lean.pivotTitulo, x: tx.lean.pivotTexto },
              { t: tx.lean.personalTitulo, x: tx.lean.personalTexto },
            ].map((b) => (
              <div key={b.t} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm font-semibold text-zinc-100">{b.t}</p>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{b.x}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "encuesta" && (
        <div className="mt-5 space-y-4">
          <h3 className="text-base font-semibold text-zinc-100">{tx.encuesta.titulo}</h3>
          <p className="text-sm leading-relaxed text-zinc-400">{tx.encuesta.intro}</p>
          {!verEncuesta ? (
            <>
              <div className="space-y-4">
                {preguntas.map((p, i) => (
                  <fieldset key={p.tema}>
                    <legend className="text-sm font-medium text-zinc-100">
                      {i + 1}. {p.pregunta}
                    </legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {p.opciones.map((o) => (
                        <button
                          key={o.texto}
                          type="button"
                          aria-pressed={respEncuesta[i] === o.lado}
                          onClick={() => {
                            const next = [...respEncuesta];
                            next[i] = o.lado;
                            setRespEncuesta(next);
                          }}
                          className={optBtn(respEncuesta[i] === o.lado)}
                        >
                          {o.texto}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              {!encuestaCompleta && <p className="text-sm text-zinc-500">{tx.encuesta.sinResponder}</p>}
              <button type="button" disabled={!encuestaCompleta} onClick={() => setVerEncuesta(true)} className={`${primaryBtn} disabled:cursor-not-allowed disabled:opacity-50`}>
                {tx.encuesta.verResultado}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <h4 className="text-base font-semibold text-zinc-100">{tx.encuesta.resultadoTitulo}</h4>
              <p className="text-sm leading-relaxed text-zinc-400">{mensajeEncuesta}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-800/60 bg-zinc-950 p-4">
                  <p className="text-sm font-semibold text-emerald-300">{tx.encuesta.prosTitulo} ({pros.length})</p>
                  <ul className="mt-2 list-inside list-disc text-sm text-zinc-300">
                    {pros.map((t) => <li key={t}>{t}</li>)}
                    {pros.length === 0 && <li>—</li>}
                  </ul>
                </div>
                <div className="rounded-lg border border-amber-800/60 bg-zinc-950 p-4">
                  <p className="text-sm font-semibold text-amber-300">{tx.encuesta.mejorasTitulo} ({mejoras.length})</p>
                  <ul className="mt-2 list-inside list-disc text-sm text-zinc-300">
                    {mejoras.map((t) => <li key={t}>{t}</li>)}
                    {mejoras.length === 0 && <li>—</li>}
                  </ul>
                </div>
              </div>
              <button type="button" onClick={() => { setRespEncuesta(Array(12).fill(null)); setVerEncuesta(false); }} className={ghostBtn}>
                {tx.encuesta.repetir}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "estres" && (
        <div className="mt-5 space-y-4">
          <h3 className="text-base font-semibold text-zinc-100">{tx.estres.titulo}</h3>
          <p className="text-sm leading-relaxed text-zinc-400">{tx.estres.intro}</p>
          <p role="note" className="rounded-lg border border-amber-800/60 bg-amber-950/40 p-4 text-sm leading-relaxed text-amber-200">
            {tx.estres.aviso}
          </p>
          {!verEstres ? (
            <>
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-zinc-100">{tx.estres.estresTitulo}</h4>
                {pEstres.map((p, i) => (
                  <fieldset key={p.tema}>
                    <legend className="text-sm font-medium text-zinc-100">{p.pregunta}</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {tx.estres.escala.map((label, v) => (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={respEstres[i] === v}
                          onClick={() => { const next = [...respEstres]; next[i] = v; setRespEstres(next); }}
                          className={optBtn(respEstres[i] === v)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <h4 className="text-sm font-semibold text-zinc-100">{tx.estres.enfoqueTitulo}</h4>
                {pEnfoque.map((p, j) => {
                  const i = 5 + j;
                  return (
                    <fieldset key={p.tema}>
                      <legend className="text-sm font-medium text-zinc-100">{p.pregunta}</legend>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {tx.estres.escala.map((label, v) => (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={respEstres[i] === v}
                            onClick={() => { const next = [...respEstres]; next[i] = v; setRespEstres(next); }}
                            className={optBtn(respEstres[i] === v)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
              {!estresCompleto && <p className="text-sm text-zinc-500">{tx.estres.sinResponder}</p>}
              <button type="button" disabled={!estresCompleto} onClick={() => setVerEstres(true)} className={`${primaryBtn} disabled:cursor-not-allowed disabled:opacity-50`}>
                {tx.estres.verResultado}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <h4 className="text-base font-semibold text-zinc-100">{tx.estres.resultadoTitulo}</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-sm font-semibold text-zinc-100">{tx.estres.estresTitulo} — {nombreBanda[bandaEstres]}</p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{textoEstres[bandaEstres]}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-sm font-semibold text-zinc-100">{tx.estres.enfoqueTitulo} — {nombreBanda[bandaEnfoque]}</p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{textoEnfoque[bandaEnfoque]}</p>
                </div>
              </div>
              <p role="note" className="rounded-lg border border-amber-800/60 bg-amber-950/40 p-4 text-sm leading-relaxed text-amber-200">
                {tx.estres.aviso}
              </p>
              <button type="button" onClick={() => { setRespEstres(Array(10).fill(null)); setVerEstres(false); }} className={ghostBtn}>
                {tx.estres.repetir}
              </button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
