// Contraste WCAG 2.x (4.1, 2026-11-26): luminancia relativa y ratio de
// contraste para auditar los colores de texto, badges y banners de la
// plataforma. Módulo puro, sin dependencias: lo usa el test que fija
// que los badges y banners lleguen a AA (>= 4.5:1 en texto normal).
// Fórmulas WCAG 2.1 (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance):
// luminancia = 0.2126 R + 0.7152 G + 0.0722 B con cada canal
// linealizado; ratio = (Lclaro + 0.05) / (Loscuro + 0.05).

/** Luminancia relativa (0-1) de un color hex (#rgb o #rrggbb). */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const channel = (i: number): number => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Ratio de contraste WCAG entre texto (fg) y fondo (bg), 1-21. */
export function contrastRatio(fg: string, bg: string): number {
  const [lighter, darker] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Mezcla un color con opacidad `alpha` (0-1) sobre un fondo sólido:
 * el color efectivo de un bg tipo `bg-sky-500/10` sobre la página. */
export function blendColor(fg: string, bg: string, alpha: number): string {
  const ch = (hex: string, i: number): number => parseInt(hex.replace("#", "").slice(i, i + 2), 16);
  const mix = (i: number): string =>
    Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

/** ¿Llega el par texto/fondo a WCAG AA? 4.5:1 en texto normal,
 * 3:1 en texto grande (>= 18pt / 14pt negrita). */
export function meetsAa(fg: string, bg: string, largeText = false): boolean {
  return contrastRatio(fg, bg) >= (largeText ? 3 : 4.5);
}
