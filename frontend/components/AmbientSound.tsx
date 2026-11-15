"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n";

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

const selectCls =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 focus:border-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

export function AmbientSound() {
  const { t } = useLanguage();
  const [sound, setSound] = useState<SoundId>("blanco");
  const [volume, setVolume] = useState(50);
  const [playing, setPlaying] = useState(false);
  // "Sonando" solo con la promesa de play() no prueba sonido: el
  // tiempo transcurrido (onTimeUpdate) demuestra que el cabezal de
  // reproducción avanza de verdad, y "Cargando…" (onWaiting) que el
  // audio aún no ha empezado. El volumen o el interruptor de silencio
  // del teléfono siguen siendo lo único que Rubén puede comprobar.
  const [elapsed, setElapsed] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fmtElapsed = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Las etiquetas se resuelven desde el diccionario; los ids y las rutas
  // de archivo no cambian (son identificadores, no texto traducible).
  const SOUNDS: { id: SoundId; label: string; hint: string; src: string }[] = [
    {
      id: "blanco",
      label: t.ambient.whiteLabel,
      hint: t.ambient.whiteHint,
      src: "/sounds/ruido-blanco.mp3",
    },
    {
      id: "lluvia",
      label: t.ambient.rainLabel,
      hint: t.ambient.rainHint,
      src: "/sounds/lluvia-suave.mp3",
    },
    {
      id: "tonos",
      label: t.ambient.tonesLabel,
      hint: t.ambient.tonesHint,
      src: "/sounds/tonos-suaves.mp3",
    },
  ];

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
    setWaiting(true);
    const result = audio.play();
    if (result) {
      result.then(
        () => {
          setPlaying(true);
          setWaiting(false);
        },
        () => {
          setPlaying(false);
          setWaiting(false);
          setError(t.ambient.playError);
        }
      );
    } else {
      setPlaying(true);
      setWaiting(false);
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setWaiting(false);
    setElapsed(0);
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
    if (playing) {
      setElapsed(0);
      play(id);
    }
  };

  const onAudioError = () => {
    setPlaying(false);
    setWaiting(false);
    setElapsed(0);
    setError(t.ambient.loadError);
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio) setElapsed(Math.floor(audio.currentTime));
  };

  const onPlaying = () => setWaiting(false);
  const onWaiting = () => setWaiting(true);

  const current = SOUNDS.find((s) => s.id === sound) ?? SOUNDS[0];

  return (
    <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-sm">
      <p className="text-base font-semibold leading-snug text-zinc-100">{t.ambient.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">
        {t.ambient.intro}
      </p>

      {/* Elemento de audio sin controles visibles. Sin src inicial ni
          precarga (optimización 2026-11-02): con preload="auto" el
          navegador descargaba 1.4 MB de MP3 al abrir Espacio aunque
          nunca se tocara Reproducir. Ahora el audio se descarga solo
          al tocar Reproducir — play() ya pone el src antes de
          reproducir, así que la regla iOS del gesto sigue intacta. */}
      <audio
        ref={audioRef}
        loop
        preload="none"
        onError={onAudioError}
        onTimeUpdate={onTimeUpdate}
        onPlaying={onPlaying}
        onWaiting={onWaiting}
        aria-hidden="true"
      />

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sonido-ambiental" className="text-xs font-semibold text-zinc-300">
            {t.ambient.soundLabel}
          </label>
          <select
            id="sonido-ambiental"
            aria-label={t.ambient.soundAria}
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
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{current.hint}</p>
        </div>

        <div>
          <label htmlFor="volumen-ambiental" className="text-xs font-semibold text-zinc-300">
            {t.ambient.volume.replace("{nombre}", String(volume))}
          </label>
          <input
            id="volumen-ambiental"
            aria-label={t.ambient.volumeAria}
            className="mt-2 w-full cursor-pointer py-2 accent-teal-500"
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
          />
          {volume === 0 && (
            <p className="mt-1 text-xs leading-relaxed text-amber-400">
              {t.espacio.volumeZero}
            </p>
          )}
        </div>
      </div>

      {/* Play y Stop como dos botones separados y siempre visibles:
          Reproducir solo activo cuando no suena, Detener solo activo
          cuando suena. Así el estado queda claro sin depender del texto
          de un solo botón que cambia. */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => play(sound)}
          disabled={playing}
          className="min-h-[44px] rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.ambient.play}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!playing}
          className="min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.ambient.stop}
        </button>
      </div>
      {/* Estado siempre visible para que se vea claro si opera o no:
          por default (al entrar) está en Detenido; al sonar, punto
          pulsante verde + "Sonando". El tiempo transcurrido es la
          prueba visible de que el cabezal avanza (no solo la promesa
          de play()). "Cargando…" es el estado mientras el audio aún
          no ha empezado O SE ATASCA a mitad de reproducción: `waiting`
          tiene prioridad sobre `playing`, así que un atasco no se
          disfraza de "Sonando" con el tiempo congelado. Ninguno de los
          dos prueba que se oiga: eso solo lo comprueba Rubén con sus
          oídos (ver nota abajo). */}
      <p
        role="status"
        className="mt-2 flex items-center justify-center gap-2 text-center text-xs font-semibold"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 rounded-full ${
            waiting ? "animate-pulse bg-amber-400" : playing ? "animate-pulse bg-teal-400" : "bg-zinc-600"
          }`}
        />
        {waiting ? (
          <span className="text-amber-300">{t.espacio.loading}</span>
        ) : playing ? (
          <span className="text-teal-300">
            {t.ambient.playing.replace("{nombre}", current.label)} · {t.ambient.volumeWord} {volume}% · {fmtElapsed(elapsed)}
          </span>
        ) : (
          <span className="text-zinc-400">{t.ambient.stopped}</span>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-center text-xs text-red-400">
          {error}
        </p>
      )}
      <p className="mt-2 text-center text-xs leading-relaxed text-zinc-400">
        {t.espacio.iphoneSilent}
      </p>
    </div>
  );
}
