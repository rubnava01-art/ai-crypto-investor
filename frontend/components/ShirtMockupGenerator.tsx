"use client";

import { useRef, useState } from "react";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { downloadSvg, downloadSvgAsPng } from "../lib/svgDownload";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40";

// Colores: hex fijos; las etiquetas visibles salen del diccionario
// dentro del componente (t.mockup.*).

type Placement = "pecho" | "centro" | "espalda";
type Format = "mockup" | "techpack";

const TEE_PATH =
  "M140 30 L100 60 L60 130 L110 160 L140 120 L140 370 L260 370 L260 120 L290 160 L340 130 L300 60 L260 30 C250 55 230 65 200 65 C170 65 150 55 140 30 Z";

// Tech Pack: hoja de especificaciones en blanco. Todo empieza vacío;
// las fotos del usuario solo definen el formato (cabecera, barra,
// vistas con guías de colocación y cajas por vista), nunca el contenido.
type Pantone = { code: string; color: string };
type TechSection = {
  printSize: string;
  embellishment: string;
  ink: string;
  pantones: Pantone[];
};
type TechSectionKey = "front" | "back" | "rightSleeve" | "leftSleeve" | "label";
type TechPack = {
  client: string;
  design: string;
  garment: string;
  garmentColor: string;
  placeFront: string;
  placeBack: string;
  front: TechSection;
  back: TechSection;
  rightSleeve: TechSection;
  leftSleeve: TechSection;
  label: TechSection;
};

const emptySection = (): TechSection => ({
  printSize: "",
  embellishment: "",
  ink: "",
  pantones: [],
});

const emptyTechPack = (): TechPack => ({
  client: "",
  design: "",
  garment: "",
  garmentColor: "",
  placeFront: "",
  placeBack: "",
  front: emptySection(),
  back: emptySection(),
  rightSleeve: emptySection(),
  leftSleeve: emptySection(),
  label: emptySection(),
});

const MAX_PANTONES = 4;
// Hoja 1000x1100; el PNG se exporta a 1024 de ancho.
const TP_W = 1000;
const TP_H = 1100;
const TP_PNG_W = 1024;
const TP_PNG_H = Math.round((TP_PNG_W * TP_H) / TP_W);

export function ShirtMockupGenerator() {
  const { t } = useLanguage();
  const shirtColors: { name: string; hex: string; seam: string }[] = [
    { name: t.mockup.shirtBlack, hex: "#18181b", seam: "#000000" },
    { name: t.mockup.shirtWhite, hex: "#f4f4f5", seam: "#d4d4d8" },
    { name: t.mockup.shirtNavy, hex: "#1e3a5f", seam: "#12233a" },
    { name: t.mockup.shirtGray, hex: "#52525b", seam: "#3f3f46" },
    { name: t.mockup.shirtRed, hex: "#991b1b", seam: "#7f1d1d" },
    { name: t.mockup.shirtOlive, hex: "#3f6212", seam: "#365314" },
  ];
  const textColors: { name: string; hex: string }[] = [
    { name: t.mockup.inkWhite, hex: "#ffffff" },
    { name: t.mockup.inkBlack, hex: "#111111" },
    { name: t.mockup.inkGold, hex: "#d4af37" },
    { name: t.mockup.inkYellow, hex: "#fde047" },
    { name: t.mockup.inkRed, hex: "#ef4444" },
  ];
  const svgRef = useRef<SVGSVGElement>(null);
  const techSvgRef = useRef<SVGSVGElement>(null);
  const [format, setFormat] = useState<Format>("mockup");
  const [shirtIdx, setShirtIdx] = useState(0);
  const [textIdx, setTextIdx] = useState(0);
  const [designText, setDesignText] = useState("NEST");
  const [subText, setSubText] = useState(t.mockup.defaultSub);
  const [placement, setPlacement] = useState<Placement>("centro");
  const [techPack, setTechPack] = useState<TechPack>(emptyTechPack);
  const [msg, setMsg] = useState<string | null>(null);

  const shirt = shirtColors[shirtIdx];
  const ink = textColors[textIdx];
  const isBack = placement === "espalda";
  const isTech = format === "techpack";
  const slug = (techPack.design.trim() || techPack.client.trim() || designText.trim() || "diseno")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const fileBase = isTech ? `tech-pack-${slug}` : `mockup-camiseta-${(designText.trim() || "diseno").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Posición del diseño: pecho = chico arriba, centro/espalda = grande al medio.
  const mainY = placement === "pecho" ? 150 : 210;
  const mainSize = placement === "pecho" ? 26 : 44;
  const subY = placement === "pecho" ? 175 : 245;

  const download = (png: boolean) => {
    if (isTech) {
      if (png) downloadSvgAsPng(techSvgRef.current, `${fileBase}.png`, TP_PNG_W, TP_PNG_H);
      else downloadSvg(techSvgRef.current, `${fileBase}.svg`);
    } else {
      if (png) downloadSvgAsPng(svgRef.current, `${fileBase}.png`);
      else downloadSvg(svgRef.current, `${fileBase}.svg`);
    }
    setMsg(png ? t.mockup.msgPng : t.mockup.msgSvg);
  };

  const setHeader = (key: "client" | "design" | "garment" | "garmentColor" | "placeFront" | "placeBack", value: string) =>
    setTechPack((p) => ({ ...p, [key]: value }));
  const setSectionField = (key: TechSectionKey, field: "printSize" | "embellishment" | "ink", value: string) =>
    setTechPack((p) => ({ ...p, [key]: { ...p[key], [field]: value } }));
  const setPantone = (key: TechSectionKey, idx: number, field: "code" | "color", value: string) =>
    setTechPack((p) => ({
      ...p,
      [key]: { ...p[key], pantones: p[key].pantones.map((pt, i) => (i === idx ? { ...pt, [field]: value } : pt)) },
    }));
  const addPantone = (key: TechSectionKey) =>
    setTechPack((p) =>
      p[key].pantones.length >= MAX_PANTONES
        ? p
        : { ...p, [key]: { ...p[key], pantones: [...p[key].pantones, { code: "", color: "#000000" }] } },
    );
  const removePantone = (key: TechSectionKey, idx: number) =>
    setTechPack((p) => ({ ...p, [key]: { ...p[key], pantones: p[key].pantones.filter((_, i) => i !== idx) } }));

  const sectionDefs: { key: TechSectionKey; title: string }[] = [
    { key: "front", title: t.mockup.tpFront },
    { key: "back", title: t.mockup.tpBack },
    { key: "rightSleeve", title: t.mockup.tpRightSleeve },
    { key: "leftSleeve", title: t.mockup.tpLeftSleeve },
    { key: "label", title: t.mockup.tpLabel },
  ];

  // Una línea "ETIQUETA: valor" dentro del SVG; si el valor está vacío
  // solo se muestra la etiqueta.
  const specLine = (x: number, y: number, label: string, value: string, key: string) => (
    <text key={key} x={x} y={y} fontSize="15" fill="#18181b" fontFamily="Arial, sans-serif">
      <tspan fontWeight="700">{label}</tspan>
      {value.trim() ? <tspan>: {value.trim()}</tspan> : <tspan>:</tspan>}
    </text>
  );

  const specBox = (x: number, y: number, w: number, h: number, title: string, s: TechSection) => (
    <g key={title}>
      <rect x={x} y={y} width={w} height={h} fill="#f4f4f5" stroke="#d4d4d8" strokeWidth="1" />
      <rect x={x} y={y} width={w} height="38" fill="#18181b" />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fontSize="17" fontWeight="700" letterSpacing="2" fill="#ffffff" fontFamily="Arial, sans-serif">
        {title}
      </text>
      {specLine(x + 16, y + 64, t.mockup.tpPrintSize, s.printSize, "ps")}
      {specLine(x + 16, y + 88, t.mockup.tpEmbellishment, s.embellishment, "em")}
      {specLine(x + 16, y + 112, t.mockup.tpInk, s.ink, "ink")}
      {specLine(x + 16, y + 136, t.mockup.tpPantones, "", "pan")}
      {s.pantones.map((pt, i) => (
        <g key={i}>
          <rect x={x + 16} y={y + 146 + i * 24} width="14" height="14" fill={pt.color} stroke="#d4d4d8" strokeWidth="1" />
          <text x={x + 38} y={y + 158 + i * 24} fontSize="15" fill="#18181b" fontFamily="Arial, sans-serif">
            {pt.code.trim()}
          </text>
        </g>
      ))}
    </g>
  );

  const techTee = (tx: number, cx: number, note: string) => (
    <g>
      {note.trim() && (
        <g>
          <text x={cx} y={178} textAnchor="middle" fontSize="16" letterSpacing="1" fill="#dc2626" fontFamily="Arial, sans-serif">
            {note.trim().toUpperCase()}
          </text>
          <line x1={cx} y1={188} x2={cx} y2={212} stroke="#dc2626" strokeWidth="1.5" strokeDasharray="4 4" />
        </g>
      )}
      <g transform={`translate(${tx} 205) scale(0.85)`}>
        <path d={TEE_PATH} fill={shirt.hex} stroke={shirt.seam} strokeWidth="2" />
        <path d="M160 32 C170 55 230 55 240 32" fill="none" stroke={shirt.seam} strokeWidth="3" />
        <text x="200" y="210" textAnchor="middle" fontSize="44" fontWeight="800" letterSpacing="2" fill={ink.hex} fontFamily="Arial, sans-serif">
          {designText.trim().toUpperCase()}
        </text>
        {subText.trim() && (
          <text x="200" y="245" textAnchor="middle" fontSize="16" letterSpacing="3" fill={ink.hex} fontFamily="Arial, sans-serif">
            {subText.trim().toUpperCase()}
          </text>
        )}
      </g>
    </g>
  );

  const headerField = (x: number, y: number, label: string, value: string, key: string) => (
    <text key={key} x={x} y={y} fontSize="20" fill="#18181b" fontFamily="Arial, sans-serif">
      <tspan fontWeight="700">{label}</tspan>
      {value.trim() ? <tspan>: {value.trim()}</tspan> : <tspan>:</tspan>}
    </text>
  );

  const sectionForm = (def: { key: TechSectionKey; title: string }) => {
    const s = techPack[def.key];
    return (
      <details key={def.key} className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-100">{def.title}</summary>
        <div className="mt-2 space-y-2">
          <input aria-label={`${def.title} ${t.mockup.tpPrintSize}`} className={inputCls} placeholder={t.mockup.tpPrintSize} value={s.printSize} onChange={(e) => setSectionField(def.key, "printSize", e.target.value)} maxLength={40} autoComplete="off" />
          <input aria-label={`${def.title} ${t.mockup.tpEmbellishment}`} className={inputCls} placeholder={t.mockup.tpEmbellishment} value={s.embellishment} onChange={(e) => setSectionField(def.key, "embellishment", e.target.value)} maxLength={40} autoComplete="off" />
          <input aria-label={`${def.title} ${t.mockup.tpInk}`} className={inputCls} placeholder={t.mockup.tpInk} value={s.ink} onChange={(e) => setSectionField(def.key, "ink", e.target.value)} maxLength={40} autoComplete="off" />
          <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{t.mockup.tpPantones}</p>
          {s.pantones.map((pt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`${def.title} ${t.mockup.tpPantoneCode}`} className={inputCls} placeholder={t.mockup.tpPantoneCode} value={pt.code} onChange={(e) => setPantone(def.key, i, "code", e.target.value)} maxLength={24} autoComplete="off" />
              <input aria-label={`${def.title} ${t.mockup.tpPantoneColor}`} type="color" className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900" value={pt.color} onChange={(e) => setPantone(def.key, i, "color", e.target.value)} />
              <button type="button" aria-label={`${t.mockup.tpRemovePantone} ${i + 1}`} onClick={() => removePantone(def.key, i)} className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addPantone(def.key)}
            disabled={s.pantones.length >= MAX_PANTONES}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {t.mockup.tpAddPantone}
          </button>
        </div>
      </details>
    );
  };

  return (
    <Panel
      title={t.mockup.title}
      badge={
        <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
          {t.mockup.badge}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {isTech ? t.mockup.tpIntro : t.mockup.intro}
      </p>

      <div className="mb-4 flex gap-2" role="group" aria-label={t.mockup.formatAria}>
        <button
          type="button"
          aria-pressed={!isTech}
          onClick={() => setFormat("mockup")}
          className={`flex-1 rounded-lg min-h-[44px] px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${!isTech ? "bg-sky-600 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
        >
          {t.mockup.formatMockup}
        </button>
        <button
          type="button"
          aria-pressed={isTech}
          onClick={() => setFormat("techpack")}
          className={`flex-1 rounded-lg min-h-[44px] px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${isTech ? "bg-sky-600 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
        >
          {t.mockup.formatTechPack}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <input aria-label={t.mockup.designAria} className={inputCls} placeholder={t.mockup.designPlaceholder} value={designText} onChange={(e) => setDesignText(e.target.value)} maxLength={24} autoComplete="off" />
          <input aria-label={t.mockup.subAria} className={inputCls} placeholder={t.mockup.subPlaceholder} value={subText} onChange={(e) => setSubText(e.target.value)} maxLength={40} autoComplete="off" />
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={shirtIdx} onChange={(e) => setShirtIdx(Number(e.target.value))} aria-label={t.mockup.shirtAria}>
              {shirtColors.map((c, i) => (
                <option key={c.name} value={i}>{t.mockup.shirtPrefix}{c.name}</option>
              ))}
            </select>
            <select className={inputCls} value={textIdx} onChange={(e) => setTextIdx(Number(e.target.value))} aria-label={t.mockup.textAria}>
              {textColors.map((c, i) => (
                <option key={c.name} value={i}>{t.mockup.textPrefix}{c.name}</option>
              ))}
            </select>
          </div>
          {!isTech && (
            <select className={inputCls} value={placement} onChange={(e) => setPlacement(e.target.value as Placement)} aria-label={t.mockup.placementAria}>
              <option value="pecho">{t.mockup.placeChest}</option>
              <option value="centro">{t.mockup.placeCenter}</option>
              <option value="espalda">{t.mockup.placeBack}</option>
            </select>
          )}

          {isTech && (
            <>
              <input aria-label={t.mockup.tpClient} className={inputCls} placeholder={t.mockup.tpClient} value={techPack.client} onChange={(e) => setHeader("client", e.target.value)} maxLength={40} autoComplete="off" />
              <input aria-label={t.mockup.tpDesign} className={inputCls} placeholder={t.mockup.tpDesign} value={techPack.design} onChange={(e) => setHeader("design", e.target.value)} maxLength={40} autoComplete="off" />
              <div className="grid grid-cols-2 gap-2">
                <input aria-label={t.mockup.tpGarment} className={inputCls} placeholder={t.mockup.tpGarment} value={techPack.garment} onChange={(e) => setHeader("garment", e.target.value)} maxLength={24} autoComplete="off" />
                <input aria-label={t.mockup.tpGarmentColor} className={inputCls} placeholder={t.mockup.tpGarmentColor} value={techPack.garmentColor} onChange={(e) => setHeader("garmentColor", e.target.value)} maxLength={24} autoComplete="off" />
              </div>
              <input aria-label={t.mockup.tpPlaceFront} className={inputCls} placeholder={t.mockup.tpPlaceFrontPh} value={techPack.placeFront} onChange={(e) => setHeader("placeFront", e.target.value)} maxLength={60} autoComplete="off" />
              <input aria-label={t.mockup.tpPlaceBack} className={inputCls} placeholder={t.mockup.tpPlaceBackPh} value={techPack.placeBack} onChange={(e) => setHeader("placeBack", e.target.value)} maxLength={60} autoComplete="off" />
              {sectionDefs.map(sectionForm)}
            </>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => download(false)}
              disabled={!designText.trim()}
              className="flex-1 rounded-lg bg-sky-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
            >
              {t.mockup.downloadSvg}
            </button>
            <button
              type="button"
              onClick={() => download(true)}
              disabled={!designText.trim()}
              className="flex-1 rounded-lg bg-sky-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
            >
              {t.mockup.downloadPng}
            </button>
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        </div>

        <div className="flex items-start justify-center rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          {isTech ? (
            <svg ref={techSvgRef} viewBox={`0 0 ${TP_W} ${TP_H}`} className="h-auto w-full max-w-md" role="img" aria-label={t.mockup.tpTechPack}>
              <rect width={TP_W} height={TP_H} fill="#ffffff" />
              {headerField(40, 40, t.mockup.tpClient, techPack.client, "c")}
              {headerField(40, 68, t.mockup.tpDesign, techPack.design, "d")}
              {headerField(600, 40, t.mockup.tpGarment, techPack.garment, "g")}
              {headerField(600, 68, t.mockup.tpGarmentColor, techPack.garmentColor, "gc")}
              <rect x="0" y="92" width={TP_W} height="46" fill="#18181b" />
              <text x={TP_W / 2} y="122" textAnchor="middle" fontSize="24" fontWeight="700" letterSpacing="4" fill="#ffffff" fontFamily="Arial, sans-serif">
                {t.mockup.tpTechPack}
              </text>
              {techTee(140, 310, techPack.placeFront)}
              {techTee(560, 730, techPack.placeBack)}
              <text x="310" y="545" textAnchor="middle" fontSize="18" fontWeight="700" letterSpacing="2" fill="#18181b" fontFamily="Arial, sans-serif">
                {t.mockup.tpCaptionFront}
              </text>
              <text x="730" y="545" textAnchor="middle" fontSize="18" fontWeight="700" letterSpacing="2" fill="#18181b" fontFamily="Arial, sans-serif">
                {t.mockup.tpCaptionBack}
              </text>
              {specBox(40, 580, 280, 240, t.mockup.tpFront, techPack.front)}
              {specBox(360, 580, 280, 240, t.mockup.tpBack, techPack.back)}
              {specBox(680, 580, 280, 240, t.mockup.tpRightSleeve, techPack.rightSleeve)}
              {specBox(40, 840, 280, 240, t.mockup.tpLeftSleeve, techPack.leftSleeve)}
              {specBox(360, 840, 280, 240, t.mockup.tpLabel, techPack.label)}
            </svg>
          ) : (
            <svg ref={svgRef} viewBox="0 0 400 400" className="h-auto w-full max-w-64" role="img" aria-label={t.mockup.previewAria}>
              <rect width="400" height="400" fill="#09090b" />
              <path d={TEE_PATH} fill={shirt.hex} stroke={shirt.seam} strokeWidth="2" />
              {/* Cuello */}
              <path d="M160 32 C170 55 230 55 240 32" fill="none" stroke={shirt.seam} strokeWidth="3" />
              <text x="200" y={mainY} textAnchor="middle" fontSize={mainSize} fontWeight="800" letterSpacing="2" fill={ink.hex} fontFamily="Arial, sans-serif">
                {designText.trim().toUpperCase()}
              </text>
              {subText.trim() && (
                <text x="200" y={subY} textAnchor="middle" fontSize={placement === "pecho" ? 12 : 16} letterSpacing="3" fill={ink.hex} fontFamily="Arial, sans-serif">
                  {subText.trim().toUpperCase()}
                </text>
              )}
              <text x="200" y="392" textAnchor="middle" fontSize="11" fill="#71717a" fontFamily="Arial, sans-serif">
                {isBack ? t.mockup.viewBack : t.mockup.viewFront}
              </text>
            </svg>
          )}
        </div>
      </div>
    </Panel>
  );
}
