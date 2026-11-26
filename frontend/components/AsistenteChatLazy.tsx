"use client";

import dynamic from "next/dynamic";

/** Asistente flotante con carga diferida (Fase 3 mejoras-v1, tarea 5):
 * el chat (820 líneas + capacidades) no viaja en el bundle inicial de
 * ninguna página: se descarga solo en el cliente, cuando el layout ya
 * está pintado, y el botón flotante aparece entonces. La vista dedicada
 * /asistente sigue importando AsistentePanel directamente desde
 * AsistenteChat (su propio chunk de ruta). */
const AsistenteChat = dynamic(
  () => import("./AsistenteChat").then((m) => m.AsistenteChat),
  { ssr: false },
);

export function AsistenteChatLazy() {
  return <AsistenteChat />;
}
