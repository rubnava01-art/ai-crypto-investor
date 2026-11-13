"use client";

// Sección pública "IA y Automatización" (2026-11-12). Contenido 100 %
// estático: no lee el token ni dispara llamadas. Cada tarjeta nombra la
// herramienta real, dice qué hace y cuál es su límite honesto en la
// misma tarjeta. La tarjeta 7 lista las 5 herramientas de Clases por su
// nombre real (t.clases.*). Ningún enlace va a rutas autenticadas: el
// único CTA va a /login?mode=register.
import Link from "next/link";
import { useLanguage } from "../lib/i18n";

export function LandingAi() {
  const { t } = useLanguage();
  const l = t.landing;
  const cards = [
    { title: l.ai1Title, desc: l.ai1Desc, limit: l.ai1Limit },
    { title: l.ai2Title, desc: l.ai2Desc, limit: l.ai2Limit },
    { title: l.ai3Title, desc: l.ai3Desc, limit: l.ai3Limit },
    { title: l.ai4Title, desc: l.ai4Desc, limit: l.ai4Limit },
    { title: l.ai5Title, desc: l.ai5Desc, limit: l.ai5Limit },
    { title: l.ai6Title, desc: l.ai6Desc, limit: l.ai6Limit },
    { title: l.ai7Title, desc: l.ai7Desc, limit: l.ai7Limit },
    { title: l.ai8Title, desc: l.ai8Desc, limit: l.ai8Limit },
    { title: l.ai9Title, desc: l.ai9Desc, limit: l.ai9Limit },
    { title: l.ai10Title, desc: l.ai10Desc, limit: l.ai10Limit },
    { title: l.ai11Title, desc: l.ai11Desc, limit: l.ai11Limit },
    { title: l.ai12Title, desc: l.ai12Desc, limit: l.ai12Limit },
    { title: l.ai13Title, desc: l.ai13Desc, limit: l.ai13Limit },
  ];
  // Nombres reales de las 5 herramientas de Clases (tarjeta 7), en dos
  // grupos (matiz Agente 2, verificado): sin registro — calculadora y
  // educación Bitcoin, 100 % navegador — y dentro de tu cuenta —
  // conversor, gráfica e indicadores, que usan /api/market/* autenticado.
  const classToolsOpen = [t.clases.calcTitle, t.clases.btcTitle];
  const classToolsAuth = [t.clases.convTitle, t.clases.chartTitle, t.clases.indTitle];

  return (
    <section id="ia" aria-label={l.aiTitle} className="scroll-mt-20 border-t border-zinc-800 py-10 sm:py-12">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.aiTitle}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
        {l.aiIntro}
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => (
          <article key={c.title} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h3 className="text-lg font-bold text-zinc-50">{c.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{c.desc}</p>
            {i === 6 && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{l.ai7GroupOpen}</p>
                  <ul className="mt-1 space-y-1">
                    {classToolsOpen.map((tool) => (
                      <li key={tool} className="flex items-start gap-2 text-sm text-zinc-200">
                        <span aria-hidden="true" className="mt-0.5 text-blue-400">•</span>
                        <span>{tool}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{l.ai7GroupAuth}</p>
                  <ul className="mt-1 space-y-1">
                    {classToolsAuth.map((tool) => (
                      <li key={tool} className="flex items-start gap-2 text-sm text-zinc-200">
                        <span aria-hidden="true" className="mt-0.5 text-blue-400">•</span>
                        <span>{tool}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <p className="mt-3 border-t border-zinc-800 pt-3 text-sm leading-relaxed text-amber-300/90">
              {c.limit}
            </p>
          </article>
        ))}
      </div>
      <div className="mt-6">
        <Link
          href="/login?mode=register"
          className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
        >
          {l.ctaStartFree}
        </Link>
      </div>
    </section>
  );
}
