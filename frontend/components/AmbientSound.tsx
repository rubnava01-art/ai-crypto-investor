"use client";

import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Sonido ambiental para meditación: 3 grabaciones reales en bucle,   */
/* empaquetadas en la app (public/sounds/). Sin URLs externas, sin    */
/* descargas en tiempo de uso, sin dependencias nuevas y sin backend. */
/*                                                                     */
/* Procedencia (nota CC0): grabaciones de SnugSounds, dominio público */
/* CC0, sin atribución obligatoria. Copias locales:                   */
/*   - ruido-blanco.mp3: "sound of white noise"                       */
/*   - lluvia-suave.mp3: "cozy rain on window" (lluvia sobre ventana) */
/*   - tonos-suaves.mp3: "healing frequencies" (grabación ambiental   */
/*     suave y sostenida; no se describe como pad ni se le atribuyen  */
/*     efectos: es solo un fondo ambiental).                          */
/*                                                                     */
/* REGLA CRÍTICA iOS: audio.play() se llama SINCRÓNICAMENTE dentro    */
/* del manejador del clic, sin ningún await antes. El fallo anterior  */
/* era esperar a ctx.resume() antes de arrancar el sonido, lo que     */
/* rompía el requisito de gesto del usuario en iOS y dejaba la UI en  */
/* "Sonando" sin sonido. Aquí "Sonando" solo se muestra cuando la     */
/* promesa de play() se resuelve; si rechaza, se muestra un error     */
/* visible y no se muestra "Sonando".                                 */
/*                                                                     */
/* El sonido se detiene al desmontar el componente (salir de Espacio)  */
/* y no toca el temporizador 4-4-6: estado y controles propios.       */
/* ------------------------------------------------------------------ */

type SoundId = "blanco" | "lluvia" | "tonos";

const SOUNDS: { id: SoundId; label: string; hint: string; src: string }[] = [
  {
    id: "blanco",
    label: "Ruido blanco",
    hint: "Grabación real de ruido blanco en bucle, para tapar el ruido de fondo.",
    src: "/sounds/ruido-blanco.mp3",
  },
  {
    id: "lluvia",
    label: "Lluvia suave",
    hint: "Grabación real de lluvia suave sobre una ventana, en bucle.",
    src: "/sounds/lluvia-suave.mp3",
  },
  {
    id: "tonos",
    label: "Tonos suaves",
    hint: "Grabación ambiental suave y sostenida, en bucle.",
    src: "/sounds/tonos-suaves.mp3",
  },
];

const selectCls =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-teal-500 focus:outline-none";

export function AmbientSound() {
  const [sound, setSound] = useState<SoundId>("blanco");
  const [volume, setVolume] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Al salir de Espacio el sonido se detiene.
  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) audio.pause();
    },
    []
  );

  // Debe llamarse desde un clic del usuario: play() SINCRÓNICO, sin
  // await antes. Solo después se atienden la resolución y el rechazo.
  const play = (id: SoundId) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = SOUNDS.find((s) => s.id === id) ?? SOUNDS[0];
    if (audio.getAttribute("src") !== target.src) audio.setAttribute("src", target.src);
    audio.volume = volume / 100;
    audio.loop = true;
    setError(null);
    const result = audio.play();
    if (result) {
      result.then(
        () => setPlaying(true),
        () => {
          setPlaying(false);
          setError("No se pudo reproducir el sonido. Toca Reproducir de nuevo.");
        }
      );
    } else {
      setPlaying(true);
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
  };

  const onVolume = (v: number) => {
    setVolume(v);
    const audio = audioRef.current;
    if (audio) audio.volume = v / 100;
  };

  const onSound = (id: SoundId) => {
    setSound(id);
    // Cambiar de sonido mientras suena cambia al instante; el clic en
    // el selector es un gesto del usuario, así que play() sigue siendo
    // sincrónico aquí.
    if (playing) play(id);
  };

  const onAudioError = () => {
    setPlaying(false);
    setError("No se pudo cargar el sonido. Revisa tu conexión y toca Reproducir de nuevo.");
  };

  const current = SOUNDS.find((s) => s.id === sound) ?? SOUNDS[0];

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-sm font-semibold text-zinc-100">Sonido ambiental</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Grabaciones reales libres (CC0) en bucle, guardadas en la app: acompañan
        la respiración o el temporizador. Se detienen solas al salir de Espacio
        o al cerrar la pestaña. En iPhone hay que tocar Reproducir.
      </p>

      {/* Elemento de audio sin controles visibles; loop y precarga activos. */}
      <audio
        ref={audioRef}
        src={SOUNDS[0].src}
        loop
        preload="auto"
        onError={onAudioError}
        aria-hidden="true"
      />

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

      {/* Play y Stop como dos botones separados y siempre visibles:
          Reproducir solo activo cuando no suena, Detener solo activo
          cuando suena. Así el estado queda claro sin depender del texto
          de un solo botón que cambia. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => play(sound)}
          disabled={playing}
          className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reproducir
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!playing}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Detener
        </button>
      </div>
      {/* Estado siempre visible para que se vea claro si opera o no:
          por default (al entrar) está en Detenido; al sonar, punto
          pulsante verde + "Sonando". */}
      <p
        role="status"
        className="mt-2 flex items-center justify-center gap-2 text-center text-xs font-semibold"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 rounded-full ${
            playing ? "animate-pulse bg-teal-400" : "bg-zinc-600"
          }`}
        />
        {playing ? (
          <span className="text-teal-300">
            Sonando: {current.label} · volumen {volume}%
          </span>
        ) : (
          <span className="text-zinc-500">Detenido — toca Reproducir para empezar</span>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-center text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
