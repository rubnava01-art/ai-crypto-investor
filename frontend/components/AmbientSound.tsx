"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Sonido ambiental para meditación: 100% sintetizado en el navegador  */
/* con Web Audio API. Sin archivos de audio, sin URLs externas, sin    */
/* descargas, sin dependencias nuevas y sin backend.                   */
/*                                                                     */
/* - "Ruido blanco": ruido blanco suavizado con filtro pasa-bajos.     */
/* - "Lluvia suave": ruido filtrado más grave, con un vaivén lento    */
/*   (LFO) que imita la irregularidad de la lluvia lejana.             */
/* - "Tonos suaves": acorde ambiental (do-mi-sol) con osciladores y   */
/*   un vaivén muy lento en el filtro, sin ritmo ni melodía.           */
/*                                                                     */
/* El AudioContext se crea y se reanuda solo dentro del clic en        */
/* "Reproducir" (los navegadores, y en especial iOS, lo exigen así).  */
/* El sonido se detiene al desmontar el componente (salir de Espacio)  */
/* y no toca el temporizador 4-4-6: estado y temporizadores propios.   */
/* ------------------------------------------------------------------ */

type SoundId = "blanco" | "lluvia" | "tonos";

const SOUNDS: { id: SoundId; label: string; hint: string }[] = [
  { id: "blanco", label: "Ruido blanco", hint: "Constante y parejo, para tapar el ruido de fondo." },
  { id: "lluvia", label: "Lluvia suave", hint: "Ruido filtrado y grave, con vaivén lento como lluvia lejana." },
  { id: "tonos", label: "Tonos suaves", hint: "Acorde ambiental lento, sin ritmo ni melodía." },
];

const selectCls =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-teal-500 focus:outline-none";

function makeNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

type SoundGraph = { stop: () => void };

function startGraph(ctx: AudioContext, out: GainNode, id: SoundId): SoundGraph {
  if (id === "tonos") {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.connect(out);
    const oscs = [261.63, 329.63, 392.0].map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (i - 1) * 4;
      const g = ctx.createGain();
      g.gain.value = 0;
      // Entrada lenta (sin clic) y nivel bajo: es fondo, no protagonista.
      g.gain.setTargetAtTime(0.07, ctx.currentTime, 1.5);
      osc.connect(g);
      g.connect(filter);
      osc.start();
      return osc;
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    return {
      stop: () => {
        oscs.forEach((o) => {
          try {
            o.stop();
          } catch {
            /* ya detenido */
          }
        });
        try {
          lfo.stop();
        } catch {
          /* ya detenido */
        }
      },
    };
  }

  // Ruido blanco y lluvia suave comparten la fuente; cambia el filtro.
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = id === "blanco" ? 1200 : 500;
  const srcGain = ctx.createGain();
  srcGain.gain.value = 1;
  src.connect(filter);
  filter.connect(srcGain);
  srcGain.connect(out);
  src.start();

  let lfo: OscillatorNode | null = null;
  if (id === "lluvia") {
    lfo = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain);
    lfoGain.connect(srcGain.gain);
    lfo.start();
  }

  return {
    stop: () => {
      try {
        src.stop();
      } catch {
        /* ya detenido */
      }
      if (lfo) {
        try {
          lfo.stop();
        } catch {
          /* ya detenido */
        }
      }
    },
  };
}

export function AmbientSound() {
  const [sound, setSound] = useState<SoundId>("blanco");
  const [volume, setVolume] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [supported, setSupported] = useState(true);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const graphRef = useRef<SoundGraph | null>(null);

  const stop = useCallback(() => {
    graphRef.current?.stop();
    graphRef.current = null;
    setPlaying(false);
  }, []);

  // Al salir de Espacio (o cerrar la pestaña) el sonido se detiene:
  // se cierran las fuentes y el contexto de audio.
  useEffect(
    () => () => {
      graphRef.current?.stop();
      graphRef.current = null;
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    },
    []
  );

  // Debe llamarse desde un clic del usuario: crea (o reutiliza) el
  // contexto, lo reanuda si está suspendido y arranca el sonido.
  const play = useCallback(
    async (id: SoundId) => {
      let ctx = ctxRef.current;
      if (!ctx) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          setSupported(false);
          return;
        }
        ctx = new AC();
        ctxRef.current = ctx;
        const master = ctx.createGain();
        master.gain.value = volume / 100;
        master.connect(ctx.destination);
        masterRef.current = master;
      }
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          /* el navegador decide; el botón queda disponible para reintentar */
        }
      }
      const master = masterRef.current;
      if (!master) return;
      graphRef.current?.stop();
      graphRef.current = startGraph(ctx, master, id);
      setPlaying(true);
    },
    [volume]
  );

  const onVolume = (v: number) => {
    setVolume(v);
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (ctx && master) master.gain.setTargetAtTime(v / 100, ctx.currentTime, 0.05);
  };

  const onSound = (id: SoundId) => {
    setSound(id);
    if (playing) void play(id);
  };

  const current = SOUNDS.find((s) => s.id === sound) ?? SOUNDS[0];

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-sm font-semibold text-zinc-100">Sonido ambiental</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Sonido generado en tu navegador, sin archivos ni internet: acompaña la
        respiración o el temporizador. Se detiene solo al salir de Espacio o al
        cerrar la pestaña.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sonido-ambiental" className="text-xs font-semibold text-zinc-400">
            Sonido
          </label>
          <select
            id="sonido-ambiental"
            aria-label="Sonido ambiental"
            className={selectCls}
            value={sound}
            onChange={(e) => onSound(e.target.value as SoundId)}
          >
            {SOUNDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">{current.hint}</p>
        </div>

        <div>
          <label htmlFor="volumen-ambiental" className="text-xs font-semibold text-zinc-400">
            Volumen: {volume}%
          </label>
          <input
            id="volumen-ambiental"
            aria-label="Volumen del sonido ambiental"
            className="mt-2 w-full accent-teal-500"
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => (playing ? stop() : void play(sound))}
        className="mt-3 w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500"
      >
        {playing ? "Detener sonido" : "Reproducir sonido"}
      </button>
      {playing && (
        <p role="status" className="mt-2 text-center text-xs text-teal-300">
          Sonando: {current.label} · volumen {volume}%
        </p>
      )}
      {!supported && (
        <p role="alert" className="mt-2 text-center text-xs text-red-400">
          Este navegador no soporta audio sintetizado.
        </p>
      )}
    </div>
  );
}
