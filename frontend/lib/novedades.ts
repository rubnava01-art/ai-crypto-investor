/** Novedades del sistema: noticias de actualización de la plataforma que
 * viajan DENTRO del frontend publicado, sin credenciales, sin endpoint
 * nuevo y sin tocar el flujo de posts del administrador.
 *
 * Cómo se publica una novedad nueva: se agrega una entrada a este arreglo
 * y se incluye este archivo en el manifiesto del push, cuando el dueño
 * aprueba la publicación. Hasta entonces, la novedad NO existe en vivo.
 *
 * Reglas:
 * - Solo avances reales y verificados de la app. Nunca contenido inventado.
 * - El contenido de cada entrada queda en español por diseño, igual que el
 *   contenido que escriben los usuarios. Solo la etiqueta
 *   ("Actualización de la plataforma") se traduce (t.inicio.systemNews).
 * - Las tarjetas del sistema NUNCA se atribuyen al administrador ni al
 *   dueño: no llevan autor, ni comentarios, ni botones de editar/borrar.
 * - Si el arreglo está vacío, Inicio no muestra ninguna sección del sistema
 *   (sin texto de relleno, sin entrada inventada).
 */

export type NovedadSistema = {
  /** Fecha ISO de la publicación (AAAA-MM-DD). */
  date: string;
  title: string;
  body: string;
};

export const novedadesSistema: NovedadSistema[] = [
  {
    date: "2026-11-01",
    title: "La plataforma tiene una interfaz más profesional",
    body: "Publicado el 1 de noviembre: nueva interfaz PRO con mejor contraste, botones y campos de 44 px con foco visible, y mejor vista en móvil. Sin cambios en rutas, permisos ni en el trading.",
  },
];

/** Entradas del sistema, de la más reciente a la más antigua. */
export function novedadesOrdenadas(): NovedadSistema[] {
  return [...novedadesSistema].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** La novedad del sistema más reciente, o null si no hay ninguna. */
export function ultimaNovedadSistema(): NovedadSistema | null {
  const ordenadas = novedadesOrdenadas();
  return ordenadas.length > 0 ? ordenadas[0] : null;
}
