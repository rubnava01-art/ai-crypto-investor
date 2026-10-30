"use client";

import { useRef, useState } from "react";
import { Panel } from "./Panel";
import { downloadSvg, downloadSvgAsPng } from "../lib/svgDownload";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const SHIRT_COLORS: { name: string; hex: string; seam: string }[] = [
  { name: "Negro", hex: "#18181b", seam: "#000000" },
  { name: "Blanco", hex: "#f4f4f5", seam: "#d4d4d8" },
  { name: "Azul marino", hex: "#1e3a5f", seam: "#12233a" },
  { name: "Gris", hex: "#52525b", seam: "#3f3f46" },
  { name: "Rojo", hex: "#991b1b", seam: "#7f1d1d" },
  { name: "Verde oliva", hex: "#3f6212", seam: "#365314" },
];

const TEXT_COLORS: { name: string; hex: string }[] = [
  { name: "Blanco", hex: "#ffffff" },
  { name: "Negro", hex: "#111111" },
  { name: "Dorado", hex: "#d4af37" },
  { name: "Amarillo", hex: "#fde047" },
  { name: "Rojo", hex: "#ef4444" },
];

type Placement = "pecho" | "centro" | "espalda";

const TEE_PATH =
  "M140 30 L100 60 L60 130 L110 160 L140 120 L140 370 L260 370 L260 120 L290 160 L340 130 L300 60 L260 30 C250 55 230 65 200 65 C170 65 150 55 140 30 Z";

export function ShirtMockupGenerator() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [shirtIdx, setShirtIdx] = useState(0);
  const [textIdx, setTextIdx] = useState(0);
  const [designText, setDesignText] = useState("NEST");
  const [subText, setSubText] = useState("TU MARCA");
  const [placement, setPlacement] = useState<Placement>("centro");
  const [msg, setMsg] = useState<string | null>(null);

  const shirt = SHIRT_COLORS[shirtIdx];
  const ink = TEXT_COLORS[textIdx];
  const isBack = placement === "espalda";
  const fileBase = `mockup-camiseta-${(designText.trim() || "diseno").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Posición del diseño: pecho = chico arriba, centro/espalda = grande al medio.
  const mainY = placement === "pecho" ? 150 : 210;
  const mainSize = placement === "pecho" ? 26 : 44;
  const subY = placement === "pecho" ? 175 : 245;

  const download = (png: boolean) => {
    if (png) downloadSvgAsPng(svgRef.current, `${fileBase}.png`);
    else downloadSvg(svgRef.current, `${fileBase}.svg`);
    setMsg(png ? "Mockup descargado en PNG." : "Mockup descargado en SVG (editable).");
  };

  return (
    <Panel
      title="Generador de mockups de camisetas"
      badge={
        <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
          Plantillas
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Arma un mockup rápido para mostrarle un diseño a un cliente: color de la
        camiseta, texto, posición (pecho, centro o espalda) y descárgalo en PNG o SVG.
        Es una vista previa con plantillas, no el arte final para imprimir: para
        producción usa siempre el logo original del cliente en alta resolución.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <input aria-label="Texto del diseño" className={inputCls} placeholder="Texto del diseño *" value={designText} onChange={(e) => setDesignText(e.target.value)} maxLength={24} autoComplete="off" />
          <input aria-label="Texto secundario (opcional)" className={inputCls} placeholder="Texto secundario (opcional)" value={subText} onChange={(e) => setSubText(e.target.value)} maxLength={40} autoComplete="off" />
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={shirtIdx} onChange={(e) => setShirtIdx(Number(e.target.value))} aria-label="Color de camiseta">
              {SHIRT_COLORS.map((c, i) => (
                <option key={c.name} value={i}>Camiseta: {c.name}</option>
              ))}
            </select>
            <select className={inputCls} value={textIdx} onChange={(e) => setTextIdx(Number(e.target.value))} aria-label="Color del texto">
              {TEXT_COLORS.map((c, i) => (
                <option key={c.name} value={i}>Texto: {c.name}</option>
              ))}
            </select>
          </div>
          <select className={inputCls} value={placement} onChange={(e) => setPlacement(e.target.value as Placement)} aria-label="Posición">
            <option value="pecho">Pecho (logo chico, frente)</option>
            <option value="centro">Centro (logo grande, frente)</option>
            <option value="espalda">Espalda (logo grande)</option>
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => download(false)}
              disabled={!designText.trim()}
              className="flex-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Descargar SVG
            </button>
            <button
              type="button"
              onClick={() => download(true)}
              disabled={!designText.trim()}
              className="flex-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Descargar PNG
            </button>
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        </div>

        <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <svg ref={svgRef} viewBox="0 0 400 400" className="h-64 w-64" role="img" aria-label="Vista previa del mockup de camiseta">
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
              {isBack ? "Vista: espalda" : "Vista: frente"}
            </text>
          </svg>
        </div>
      </div>
    </Panel>
  );
}
