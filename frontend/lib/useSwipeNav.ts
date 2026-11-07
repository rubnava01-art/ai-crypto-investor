import { useEffect, useRef, useState } from "react";
import type React from "react";

/** Gestos Estudiar (2026-11-05): navegación por swipe horizontal basada
 * en Pointer Events (dedo, ratón y lápiz; lo que Safari iOS soporta).
 * El gesto es un atajo: cada swipe tiene un botón visible equivalente.
 * El scroll vertical nativo nunca se rompe: el swipe es estrictamente
 * horizontal y el contenedor usa `touch-action: pan-y` (ver globals.css).
 * El hook NO anima nada: el desplazamiento lo controla el llamador
 * según `usePrefersReducedMotion()`. */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export interface UseSwipeNavOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Selector de elementos donde el gesto NO se activa. */
  ignoreSelector?: string;
  thresholdPx?: number;
  maxDurationMs?: number;
  /** No activar si el gesto empieza a menos de esto del borde lateral
   * del viewport: evita pelear con el swipe atrás/adelante de Safari. */
  edgeGuardPx?: number;
}

const DEFAULT_IGNORE = "input, textarea, select, iframe, video, [data-no-swipe]";

type GestureStart = {
  x: number;
  y: number;
  t: number;
  panY: boolean;
  horizontal: boolean;
};

export function useSwipeNav(opts: UseSwipeNavOptions): {
  onPointerDown: React.PointerEventHandler;
  onPointerMove: React.PointerEventHandler;
  onPointerUp: React.PointerEventHandler;
  onPointerCancel: React.PointerEventHandler;
} {
  const {
    onSwipeLeft,
    onSwipeRight,
    ignoreSelector = DEFAULT_IGNORE,
    thresholdPx = 60,
    maxDurationMs = 400,
    edgeGuardPx = 24,
  } = opts;
  const startRef = useRef<GestureStart | null>(null);

  const onPointerDown: React.PointerEventHandler = (e) => {
    const target = e.target as Element | null;
    if (target && typeof target.closest === "function" && target.closest(ignoreSelector)) {
      startRef.current = null;
      return;
    }
    const x = e.clientX;
    if (typeof window !== "undefined" && (x < edgeGuardPx || x > window.innerWidth - edgeGuardPx)) {
      startRef.current = null;
      return;
    }
    let panY = false;
    const current = e.currentTarget as Element | null;
    if (typeof window !== "undefined" && current && typeof window.getComputedStyle === "function") {
      panY = window.getComputedStyle(current).touchAction.includes("pan-y");
    }
    startRef.current = { x, y: e.clientY, t: performance.now(), panY, horizontal: false };
  };

  const onPointerMove: React.PointerEventHandler = (e) => {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      if (!s.horizontal) {
        s.horizontal = true;
        // Solo si el contenedor tiene touch-action: pan-y (el scroll
        // vertical lo resuelve el navegador de forma nativa).
        if (s.panY && e.cancelable) e.preventDefault();
      }
    } else if (!s.horizontal && Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > 8) {
      // El gesto se volvió vertical: el scroll nativo manda, se cancela.
      startRef.current = null;
    }
  };

  const onPointerUp: React.PointerEventHandler = (e) => {
    const s = startRef.current;
    startRef.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dt = performance.now() - s.t;
    if (Math.abs(dx) >= thresholdPx && Math.abs(dx) > 1.5 * Math.abs(dy) && dt <= maxDurationMs) {
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    }
  };

  const onPointerCancel: React.PointerEventHandler = () => {
    startRef.current = null;
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
