"use client";

import { useRef, useState } from "react";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { downloadSvg, downloadSvgAsPng } from "../lib/svgDownload";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

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
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.logo.intro}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <input aria-label={t.logo.brandAria} className={inputCls} placeholder={t.logo.brandPlaceholder} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="off" />
          <input aria-label={t.logo.taglineAria} className={inputCls} placeholder={t.logo.taglinePlaceholder} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={40} autoComplete="off" />
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={style} onChange={(e) => setStyle(e.target.value as Style)} aria-label={t.logo.styleAria}>
              <option value="simbolo">{t.logo.styleSymbol}</option>
              <option value="monograma">{t.logo.styleMonogram}</option>
              <option value="insignia">{t.logo.styleBadge}</option>
            </select>
            <select className={inputCls} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label={t.logo.symbolAria}>
              {symbols.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <select className={inputCls} value={paletteIdx} onChange={(e) => setPaletteIdx(Number(e.target.value))} aria-label={t.logo.paletteAria}>
            {palettes.map((p, i) => (
              <option key={p.name} value={i}>{p.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => download(false)}
              disabled={!name.trim()}
              className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {t.logo.downloadSvg}
            </button>
            <button
              type="button"
              onClick={() => download(true)}
              disabled={!name.trim()}
              className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {t.logo.downloadPng}
            </button>
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        </div>

        <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <svg ref={svgRef} viewBox="0 0 300 300" className="h-56 w-56" role="img" aria-label={t.logo.previewAria}>
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
    </Panel>
  );
}
