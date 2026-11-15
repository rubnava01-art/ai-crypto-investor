"use client";

import { useRef, useState } from "react";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { downloadSvg, downloadSvgAsPng } from "../lib/svgDownload";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40";

// Símbolos y paletas: valores/hex fijos; las etiquetas visibles salen del
// diccionario dentro del componente (t.logo.*).

type Style = "monograma" | "simbolo" | "insignia";

export function LogoGenerator() {
  const { t } = useLanguage();
  const symbols: { value: string; label: string; path: string }[] = [
    { value: "estrella", label: t.logo.symStar, path: "M50 5 L61 39 L98 39 L68 61 L79 95 L50 74 L21 95 L32 61 L2 39 L39 39 Z" },
    { value: "rayo", label: t.logo.symBolt, path: "M55 5 L20 55 L45 55 L40 95 L80 40 L52 40 Z" },
    { value: "montana", label: t.logo.symMountain, path: "M5 90 L35 30 L55 60 L70 35 L95 90 Z" },
    { value: "hoja", label: t.logo.symLeaf, path: "M50 5 C80 25 90 60 50 95 C10 60 20 25 50 5 Z" },
    { value: "corona", label: t.logo.symCrown, path: "M10 80 L10 35 L30 55 L50 25 L70 55 L90 35 L90 80 Z" },
    { value: "hexagono", label: t.logo.symHex, path: "M50 5 L90 28 L90 72 L50 95 L10 72 L10 28 Z" },
  ];
  const palettes: { name: string; bg: string; fg: string; accent: string }[] = [
    { name: t.logo.palBlackGold, bg: "#111111", fg: "#ffffff", accent: "#d4af37" },
    { name: t.logo.palWhiteBlack, bg: "#ffffff", fg: "#111111", accent: "#111111" },
    { name: t.logo.palEmerald, bg: "#064e3b", fg: "#ffffff", accent: "#34d399" },
    { name: t.logo.palMidnight, bg: "#1e3a8a", fg: "#ffffff", accent: "#60a5fa" },
    { name: t.logo.palTerracotta, bg: "#7c2d12", fg: "#ffffff", accent: "#fdba74" },
    { name: t.logo.palViolet, bg: "#4c1d95", fg: "#ffffff", accent: "#c4b5fd" },
  ];
  const svgRef = useRef<SVGSVGElement>(null);
  const [name, setName] = useState("NEST");
  const [tagline, setTagline] = useState(t.logo.defaultTagline);
  const [style, setStyle] = useState<Style>("simbolo");
  const [symbol, setSymbol] = useState("estrella");
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const palette = palettes[paletteIdx];
  const symbolDef = symbols.find((s) => s.value === symbol) ?? symbols[0];
  const styleLabel = style === "monograma" ? t.logo.styleMonogram : style === "insignia" ? t.logo.styleBadge : t.logo.styleSymbol;
  const styleOptions: { value: Style; label: string }[] = [
    { value: "simbolo", label: t.logo.styleSymbol },
    { value: "monograma", label: t.logo.styleMonogram },
    { value: "insignia", label: t.logo.styleBadge },
  ];
  const initials = name.trim().slice(0, 2).toUpperCase() || "N";
  const fileBase = `logo-${(name.trim() || "marca").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const download = (png: boolean) => {
    if (png) downloadSvgAsPng(svgRef.current, `${fileBase}.png`);
    else downloadSvg(svgRef.current, `${fileBase}.svg`);
    setMsg(png ? t.logo.msgPng : t.logo.msgSvg);
  };

  return (
    <Panel
      title={t.logo.title}
      badge={
        <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-300">
          {t.logo.badge}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {t.logo.intro}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <input aria-label={t.logo.brandAria} className={inputCls} placeholder={t.logo.brandPlaceholder} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="off" />
          <input aria-label={t.logo.taglineAria} className={inputCls} placeholder={t.logo.taglinePlaceholder} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={40} autoComplete="off" />
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.logo.styleAria}</span>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label={t.logo.styleAria}>
              {styleOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={style === o.value}
                  onClick={() => setStyle(o.value)}
                  className={`min-h-[44px] rounded-lg px-2 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${style === o.value ? "bg-violet-600 text-white" : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.logo.symbolAria}</span>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label={t.logo.symbolAria}>
              {symbols.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={symbol === s.value}
                  aria-label={s.label}
                  onClick={() => setSymbol(s.value)}
                  className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${symbol === s.value ? "border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/40" : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"}`}
                >
                  <svg viewBox="0 0 100 100" className="h-7 w-7" aria-hidden="true">
                    <path d={s.path} fill={palette.accent} />
                  </svg>
                  <span className="text-xs font-semibold text-zinc-200">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.logo.paletteAria}</span>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t.logo.paletteAria}>
              {palettes.map((p, i) => (
                <button
                  key={p.name}
                  type="button"
                  aria-pressed={paletteIdx === i}
                  aria-label={p.name}
                  onClick={() => setPaletteIdx(i)}
                  className={`flex min-h-[44px] items-center gap-2.5 rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${paletteIdx === i ? "border-violet-500 bg-violet-500/10 ring-2 ring-violet-500/40" : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"}`}
                >
                  <span className="flex shrink-0 items-center" aria-hidden="true">
                    <span className="h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: p.bg }} />
                    <span className="-ml-1.5 h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: p.fg }} />
                    <span className="-ml-1.5 h-5 w-5 rounded-full border border-white/30" style={{ backgroundColor: p.accent }} />
                  </span>
                  <span className="text-xs font-semibold text-zinc-200">{p.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => download(false)}
              disabled={!name.trim()}
              className="flex-1 rounded-lg bg-violet-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
            >
              {t.logo.downloadSvg}
            </button>
            <button
              type="button"
              onClick={() => download(true)}
              disabled={!name.trim()}
              className="flex-1 rounded-lg bg-violet-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
            >
              {t.logo.downloadPng}
            </button>
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{t.logo.previewAria}</p>
            <p className="text-xs text-zinc-400">{styleLabel} · {palette.name}</p>
          </div>
          <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <svg ref={svgRef} viewBox="0 0 300 300" className="h-auto w-full max-w-56" role="img" aria-label={t.logo.previewAria}>
            <rect width="300" height="300" fill={palette.bg} />
            {style === "monograma" ? (
              <>
                <circle cx="150" cy="120" r="62" fill="none" stroke={palette.accent} strokeWidth="4" />
                <text x="150" y="140" textAnchor="middle" fontSize="52" fontWeight="800" fill={palette.fg} fontFamily="Arial, sans-serif">
                  {initials}
                </text>
                <text x="150" y="225" textAnchor="middle" fontSize="26" fontWeight="700" letterSpacing="4" fill={palette.fg} fontFamily="Arial, sans-serif">
                  {name.trim().toUpperCase()}
                </text>
                {tagline.trim() && (
                  <text x="150" y="252" textAnchor="middle" fontSize="13" letterSpacing="3" fill={palette.accent} fontFamily="Arial, sans-serif">
                    {tagline.trim().toUpperCase()}
                  </text>
                )}
              </>
            ) : style === "insignia" ? (
              <>
                <circle cx="150" cy="150" r="105" fill="none" stroke={palette.accent} strokeWidth="3" />
                <circle cx="150" cy="150" r="92" fill="none" stroke={palette.accent} strokeWidth="1" />
                <g transform="translate(100,72) scale(1)" fill={palette.accent}>
                  <path d={symbolDef.path} />
                </g>
                <text x="150" y="205" textAnchor="middle" fontSize="24" fontWeight="800" letterSpacing="2" fill={palette.fg} fontFamily="Arial, sans-serif">
                  {name.trim().toUpperCase()}
                </text>
                {tagline.trim() && (
                  <text x="150" y="230" textAnchor="middle" fontSize="12" letterSpacing="3" fill={palette.accent} fontFamily="Arial, sans-serif">
                    {tagline.trim().toUpperCase()}
                  </text>
                )}
              </>
            ) : (
              <>
                <g transform="translate(100,45) scale(1)" fill={palette.accent}>
                  <path d={symbolDef.path} />
                </g>
                <text x="150" y="205" textAnchor="middle" fontSize="30" fontWeight="800" letterSpacing="2" fill={palette.fg} fontFamily="Arial, sans-serif">
                  {name.trim().toUpperCase()}
                </text>
                {tagline.trim() && (
                  <text x="150" y="238" textAnchor="middle" fontSize="14" letterSpacing="3" fill={palette.accent} fontFamily="Arial, sans-serif">
                    {tagline.trim().toUpperCase()}
                  </text>
                )}
              </>
            )}
          </svg>
          </div>
        </div>
      </div>
    </Panel>
  );
}
