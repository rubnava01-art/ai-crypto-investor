"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { dictEs } from "./i18n/es";
import type { Dictionary, Lang, NavKey } from "./i18n/types";

export type { Dictionary, Lang, NavKey } from "./i18n/types";

const STORAGE_KEY = "aci_lang";

type LanguageCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dictionary;
};

const Ctx = createContext<LanguageCtx | null>(null);

/** Proveedor de idioma (Fase 4): el diccionario español viaja en el bundle
 * principal y el inglés se carga bajo demanda con import() dinámico al
 * elegir EN (o al restaurar una preferencia EN guardada), para no incluir
 * ambos idiomas en cada página. El primer render es siempre español para
 * no romper la hidratación; mientras el diccionario EN carga, se sigue
 * mostrando español. Las cadenas españolas son byte-idénticas a antes.
 * El idioma también se refleja en <html lang> (antes hardcodeado a "es"). */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("es");
  const [dictEn, setDictEn] = useState<Dictionary | null>(null);

  const loadEn = useCallback(async () => {
    if (dictEn) return;
    try {
      const m = await import("./i18n/en");
      setDictEn(m.dictEn);
    } catch {
      // Sin diccionario EN: se queda en español, nunca en pantalla vacía.
    }
  }, [dictEn]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "es" || saved === "en") {
        setLangState(saved);
        document.documentElement.lang = saved;
        if (saved === "en") void loadEn();
      }
    } catch {
      // Sin acceso a localStorage (modo privado, etc.): se queda en español.
    }
  }, [loadEn]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Sin persistencia, el cambio igual aplica a la sesión actual.
    }
    document.documentElement.lang = l;
    if (l === "en") void loadEn();
  };

  const t = lang === "en" ? (dictEn ?? dictEs) : dictEs;
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLanguage(): LanguageCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLanguage debe usarse dentro de <LanguageProvider>");
  return ctx;
}

/** Interruptor ES/EN del encabezado: dos botones siempre visibles, el
 * activo resaltado en verde. No navega ni recarga: cambia el idioma de
 * toda la plataforma en el acto y lo guarda para la próxima visita. */
export function LanguageToggle() {
  const { lang, setLang, t } = useLanguage();
  const opts: { code: Lang; short: string }[] = [
    { code: "es", short: "ES" },
    { code: "en", short: "EN" },
  ];
  return (
    <div
      role="group"
      aria-label={t.header.language}
      className="flex items-center overflow-hidden rounded-lg border border-zinc-700"
    >
      {opts.map((o) => {
        const active = lang === o.code;
        return (
          <button
            key={o.code}
            type="button"
            aria-pressed={active}
            aria-label={o.code === "es" ? "Español" : "English"}
            onClick={() => setLang(o.code)}
            className={`min-h-[44px] px-3 py-2.5 text-xs font-bold ${
              active ? "bg-emerald-600 text-white" : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}
