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
    date: "2026-11-05",
    title: "Login profesional: animación de entrada más visible y formulario rediseñado",
    body: "Publicado el 5 de noviembre: el inicio de sesión ahora se ve claramente profesional — la animación de entrada sube 24px con un leve zoom en cascada, y el formulario se rediseñó con iconos en los campos, botón para ver la contraseña, botón con degradado y spinner al procesar, y línea de acento esmeralda en la tarjeta. El funcionamiento del login sigue igual y se respeta el movimiento reducido. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Login con intro animado profesional",
    body: "Publicado el 5 de noviembre: el inicio de sesión ahora tiene una entrada animada profesional — la marca, el lema y el formulario entran de forma escalonada con una animación sobria, solo con CSS y respetando el movimiento reducido. El funcionamiento del login sigue igual. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Gestos en Estudiar: desliza entre secciones y manuales",
    body: "Publicado el 5 de noviembre: Estudiar ahora se navega con gestos en el móvil — desliza entre Manuales, Juego, Videos, Academia y Clases, y entre los 3 manuales; el quiz avanza deslizando con barra de progreso, y los botones responden al toque. Cada gesto tiene su alternativa visible y se respeta el movimiento reducido. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Nuevo nombre: Grow Business Platform — gestor de negocios",
    body: "Publicado el 5 de noviembre: la plataforma ahora se llama Grow Business Platform — ya es un gestor de negocios y una mega plataforma: invierte, estudia, crea y gestiona tu negocio en un solo lugar. Solo cambia el nombre: los módulos, las rutas y el funcionamiento siguen iguales. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Ajustador: tablero de mejora continua y videos de YouTube en Estudiar",
    body: "Publicado el 5 de noviembre: nuevo módulo Ajustador en Sistema — tablero con las secciones del menú, su agente optimizador y su última mejora real, más propuestas de mejora (solo admin, empiezan vacías) —; y sección Videos en Estudiar con videos de YouTube agregados por el administrador (empieza vacía, sin videos inventados). Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Diaria 5-nov: /api/health informa la base de datos y el Dashboard la muestra",
    body: "Publicado el 5 de noviembre: /api/health ya informa el estado de la base de datos y el Dashboard de Inicio muestra una fila de Base de datos. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-04",
    title: "Análisis personal en Mi perfil: Lean Startup, encuesta de 12 y estrés+enfoque",
    body: "Publicado el 4 de noviembre: sección Análisis personal en Mi perfil con el modelo Lean Startup (crear-medir-aprender), una encuesta rápida de 12 preguntas (fortalezas vs áreas a mejorar) y un autochequeo de estrés y enfoque de 5+5 preguntas, solo en el navegador. El autochequeo es solo reflexión, no un diagnóstico.",
  },
  {
    date: "2026-11-04",
    title: "Juego en Estudiar: bases, estructura y manejo con quiz",
    body: "Publicado el 4 de noviembre: sección Juego en Estudiar con las bases de la plataforma, su estructura en 6 familias y 24 módulos y el manejo de Negocio, más un quiz interactivo de 10 preguntas. Solo funciones reales; la simulación queda intacta.",
  },
  {
    date: "2026-11-04",
    title: "Manuales en Estudiar: manejo general, Invertir (simulación) y Negocio",
    body: "Publicado el 4 de noviembre: tres manuales en Estudiar — manejo general de la plataforma, manejo de Invertir en simulación y manejo de Negocio (Gestor de Clientes, Facturas, Inventario, Talento, Riesgos, Planillas y Análisis) — en español e inglés, con solo funciones reales. Trading real sigue apagado.",
  },
  {
    date: "2026-11-04",
    title: "Gestión de empresa: Talento, Riesgos, Planillas, Gestor de Clientes y Análisis de datos",
    body: "Publicado el 4 de noviembre: tres módulos nuevos en Negocio — Talento humano, Gestión de Riesgos y Planillas (solo registros, sin impuestos ni pagos) —; el CRM ahora es Gestor de Clientes con historial por cliente y asistente por reglas (sin IA); y la herramienta Análisis de datos genera tablas, gráficas y estadísticas desde un texto pegado. Menús más prácticos y lema de mega-plataforma. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-04",
    title: "Diaria 4-nov: hora del precio en VALIDAR y verificación en un comando",
    body: "Publicado el 4 de noviembre: la pantalla VALIDAR de Invertir ya muestra la hora del precio; nuevo script de verificación diaria (pruebas + frontend en un comando). Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-03",
    title: "SEO básico aplicado (reel Peter Lead)",
    body: "Publicado el 3 de noviembre: robots.txt que no bloquea bots, sitemap con las entradas públicas, títulos y descripción con los servicios de la plataforma, analítica preparada (apagada hasta activar) y verificación de Search Console lista. La página de Google no aplica a la app.",
  },
  {
    date: "2026-11-03",
    title: "Seguridad reforzada, estado persistente y UX reorganizada",
    body: "Publicado el 3 de noviembre: seguridad reforzada (contraseña mínima de 12, datos personales redactados para la demo, sandbox solo en staging, sin siembra de la demo en producción); kill switch, escáner y modo ahora persistentes; navegación reorganizada en 6 familias; y la diaria del 3 (validación del exchange y botón Actualizar con estado de carga). Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-02",
    title: "Avance en Inicio, emociones en Espacio y Espacio más rápido",
    body: "Publicado el 2 de noviembre: Inicio muestra el avance de la plataforma con las novedades fechadas; Espacio suma manejo de emociones (cómo te sientes, intensidad y nota, con historial); Accesos con botones más grandes y accesibles; y Espacio ya no descarga el audio al abrir la página, solo al pulsar Reproducir. Sin cambios en permisos ni en el trading.",
  },
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
