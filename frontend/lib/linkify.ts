// Segmentación de texto con URLs clicables (F4-3, chat-potencia
// 2026-11-24). Función pura y testeable: divide el texto en tramos de
// texto plano y enlaces http(s) validados con `safeHttpHref`. Nunca se
// usa `dangerouslySetInnerHTML`: el renderizado lo hace React con nodos
// <a> normales, así que el texto no puede inyectar HTML.
import { safeHttpHref } from "./urls";

export type LinkSegment = { text: string; href?: string };

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** Quita puntuación final que suele ser del texto, no de la URL. */
function trimTrailingPunct(url: string): { url: string; trail: string } {
  let end = url.length;
  while (end > 0 && ".,;:!?".includes(url[end - 1])) end -= 1;
  // Un paréntesis de cierre sin su apertura también es texto.
  if (url[end - 1] === ")" && !url.slice(0, end).includes("(")) end -= 1;
  return { url: url.slice(0, end), trail: url.slice(end) };
}

export function splitLinks(text: string): LinkSegment[] {
  if (!text) return [];
  const segments: LinkSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const idx = m.index ?? 0;
    const { url, trail } = trimTrailingPunct(raw);
    const href = safeHttpHref(url);
    if (!href) continue;
    if (idx > last) segments.push({ text: text.slice(last, idx) });
    segments.push({ text: url, href });
    last = idx + url.length;
    // La puntuación recortada vuelve como texto plano.
    if (trail) segments.push({ text: trail });
    last = idx + raw.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.length > 0 ? segments : [{ text }];
}
