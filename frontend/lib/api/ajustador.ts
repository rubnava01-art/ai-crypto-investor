// Ajustador y videos educativos — SOLO frontend.
// Contrato del backend (2026-11-05): GET/POST/PUT/DELETE en
// /api/ajustes y /api/videos. Las listas son arrays pelados
// (response_model=list[...]); por tolerancia se acepta también
// {items:[...]}. GET para cualquier usuario autenticado (prueba lee el
// tablero y los videos); las escrituras requieren admin (403 para
// prueba). Ambas listas empiezan VACÍAS: sin propuestas ni videos
// sembrados. La URL de video se valida en el servidor (solo
// youtube.com/watch o youtu.be); el frontend extrae el id con la
// misma regla para el embed de privacidad mejorada (youtube-nocookie).
import { request } from "./client";

export type AgenteKey = "agente1" | "agente2" | "agente3";
export type AjusteEstado = "propuesta" | "en_curso" | "aplicada";

export interface Ajuste {
  id: number;
  seccion: string;
  agente: AgenteKey;
  propuesta: string;
  estado: AjusteEstado;
  created_at: string | null;
  updated_at: string | null;
}
export interface AjusteInput {
  seccion: string;
  agente?: AgenteKey;
  propuesta: string;
  estado?: AjusteEstado;
}

export interface VideoEducativo {
  id: number;
  url: string;
  titulo: string;
  added_at: string | null;
}
export interface VideoInput {
  url: string;
  titulo: string;
}

// Las 24 secciones optimizables: todas las rutas del menú menos
// /ajustador (el tablero gestiona las secciones, no es una de ellas).
export const SECCIONES_AJUSTADOR: string[] = [
  "inicio",
  "invertir",
  "estudiar",
  "crear",
  "analizador",
  "crm",
  "referidos",
  "business",
  "espacio",
  "facturas",
  "correos",
  "chat",
  "recomendaciones",
  "desarrollo",
  "talento",
  "riesgos",
  "planillas",
  "analisis",
  "tendencias",
  "auditor",
  "privacidad",
  "inventario",
  "perfil",
  "usuarios",
];

// Extrae el id de video con la misma regla que valida el backend:
// youtube.com/watch?v=ID o youtu.be/ID. Devuelve null si no es un
// enlace de YouTube válido (nunca se inventa un id).
export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    const idOk = /^[A-Za-z0-9_-]+$/.test;
    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname !== "/watch") return null;
      const v = parsed.searchParams.get("v");
      return v && idOk(v) ? v : null;
    }
    if (host === "youtu.be") {
      const seg = parsed.pathname.split("/").filter(Boolean)[0];
      return seg && idOk(seg) ? seg : null;
    }
    return null;
  } catch {
    return null;
  }
}

// Normaliza la forma de lista: array pelado (patrón actual del backend)
// o {items:[...]} si el backend nuevo opta por envoltorio. Cualquier otra
// forma se trata como lista vacía en vez de romper el panel.
function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

async function list<T>(path: string): Promise<T[]> {
  const data = await request<unknown>(path, { auth: true, retry: true });
  return asList<T>(data);
}

export const ajustadorApi = {
  listAjustes: () => list<Ajuste>("/api/ajustes"),
  createAjuste: (body: AjusteInput) =>
    request<Ajuste>("/api/ajustes", { method: "POST", auth: true, body }),
  updateAjuste: (id: number, body: Partial<AjusteInput>) =>
    request<Ajuste>(`/api/ajustes/${id}`, { method: "PUT", auth: true, body }),
  deleteAjuste: (id: number) =>
    request<void>(`/api/ajustes/${id}`, { method: "DELETE", auth: true }),

  listVideos: () => list<VideoEducativo>("/api/videos"),
  createVideo: (body: VideoInput) =>
    request<VideoEducativo>("/api/videos", { method: "POST", auth: true, body }),
  updateVideo: (id: number, body: Partial<VideoInput>) =>
    request<VideoEducativo>(`/api/videos/${id}`, { method: "PUT", auth: true, body }),
  deleteVideo: (id: number) =>
    request<void>(`/api/videos/${id}`, { method: "DELETE", auth: true }),
};
