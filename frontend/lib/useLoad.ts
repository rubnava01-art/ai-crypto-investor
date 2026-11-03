// Hook compartido de carga (Fase 4, FE2): cancelación al desmontar.
// Antes casi ningún panel cancelaba: al navegar rápido, un setState tras
// await escribía datos de una pantalla ya abandonada (React 19 ya no avisa,
// falla en silencio como dato equivocado). Con cold starts del free tier,
// el caso es probable, no teórico.
//
// Dos herramientas:
// - useCancelled(): guarda simple para cargas existentes (patrón que ya
//   usaban AiAssistant e InvestorPanel): comprobar isCancelled() tras await
//   antes de escribir estado.
// - useAsyncLoad(): máquina tri-estado (loading | error | data) con
//   AbortController real: la señal se pasa al loader y este la entrega al
//   cliente API (request() acepta `signal`), así el fetch se aborta de
//   verdad al desmontar o al recargar, no solo se ignora su resultado.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Guarda de cancelación: true cuando el componente ya se desmontó. */
export function useCancelled(): () => boolean {
  const ref = useRef(false);
  useEffect(
    () => () => {
      ref.current = true;
    },
    [],
  );
  return useCallback(() => ref.current, []);
}

export interface AsyncLoad<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

export function useAsyncLoad<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncLoad<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader(ctrl.signal)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        // Un abort por desmontaje/recarga no es un error que mostrar.
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { data, loading, error, reload };
}
