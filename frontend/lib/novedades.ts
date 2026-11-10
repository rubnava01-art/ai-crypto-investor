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
    date: "2026-11-10",
    title: "Flujos, Correos, Acceso y menús más fluidos",
    body: "Publicado el 10 de noviembre: Flujos ya no re-renderiza todo el panel al arrastrar un nodo, con puertos táctiles más grandes para el celular; Correos carga las listas bajo demanda y guarda el borrador aunque expire la sesión; Acceso precarga el reto anti-bots con spinner; y cambiar de módulo ya no recarga el menú completo. En el servidor, la primera petición tras la inactividad ya no falla y Correos tiene límite de 30 por minuto. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-10",
    title: "Usuarios: el panel ya no muestra dos mensajes a la vez al fallar la carga",
    body: "Publicado el 10 de noviembre: si la carga de usuarios falla, el panel de usuarios ahora muestra solo el error con botón de reintentar, sin el mensaje de 'Sin usuarios todavía' a la vez; y /api/system/metrics incluye las 10 rutas con mayor latencia media para ver qué endpoint va lento. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-10",
    title: "Caché de cotizaciones con tope y respaldos verificados",
    body: "Publicado el 10 de noviembre: el caché de cotizaciones ahora tiene tope de 128 entradas por símbolo para no crecer sin límite, y el script de respaldo verifica la integridad del archivo y lo borra si está roto. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-10",
    title: "Invertir: velas e indicadores marcan datos obsoletos",
    body: "Publicado el 10 de noviembre: en Invertir, las velas y los indicadores ahora marcan si los datos están obsoletos, y el panel avisa cuando el precio viene de caché para no operar con datos viejos. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-10",
    title: "Invertir: aviso si el precio no carga y paridad de idiomas",
    body: "Publicado el 10 de noviembre: en Invertir, el panel ahora avisa si el precio no carga (con reintento) y limpia el precio al cambiar de símbolo; y un chequeo automático verifica que los textos en español e inglés estén parejos. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-10",
    title: "Estudiar: nuevo manual — qué declarar como influencer en EE. UU. (guía FTC)",
    body: "Publicado el 10 de noviembre: en Estudiar, nuevo Manual 4 con la guía de la FTC para influencers en redes sociales, en español e inglés: qué declarar, cómo y cuándo, fiel al documento oficial. Es una página de la plataforma, no un PDF. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-06",
    title: "Planes de suscripción: Esencial $19, Crecimiento $49 y Negocio Total $99",
    body: "Publicado el 6 de noviembre: nuevo módulo Planes en Negocio con los precios de suscripción de Grow Business Platform — Esencial $19, Crecimiento $49 y Negocio Total $99 al mes — y lo que incluye cada uno. Todos los planes incluyen 14 días de prueba gratis. Todavía no hay cobro en línea: la prueba y la suscripción se activan con el administrador. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-06",
    title: "Mejoras del sistema: Terminal, videos, analizadores, Flujos y botón Inicio",
    body: "Publicado el 6 de noviembre: la Terminal ahora guarda historial y suma comandos nuevos; Estudiar tiene reproductor de videos con búsqueda y orden; el Analizador suma revisiones de estructura y un analizador de redes con estimaciones honestas; el Auditor muestra un informe gráfico; nuevo constructor visual Flujos en simulación; y el botón Inicio ya está siempre visible arriba del menú. Cada módulo con fallo muestra su propio error sin tumbar la web. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-06",
    title: "Invertir: el evaluador ya no usa velas obsoletas",
    body: "Publicado el 6 de noviembre: /api/strategy/evaluate ya no genera señales con velas obsoletas — si la última vela cerrada es más vieja que 2 timeframes, responde 503 y no persiste ninguna señal. Antes evaluaba con datos muertos si el escáner llevaba caído. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Tech Pack en Crear: formato de hoja de especificaciones para camisetas",
    body: "Publicado el 5 de noviembre: el generador de mockups de camisetas en Crear ahora tiene el formato Tech Pack — una hoja de especificaciones en blanco con cabecera editable (cliente, diseño, prenda y color), barra TECH PACK, vistas de frente y espalda con guías de colocación, y cinco cajas (FRONT, BACK, RIGHT SLEEVE, LEFT SLEEVE, LABEL) con tamaño de impresión, embellishment, tinta y Pantones con muestras de color; descarga en SVG o PNG. Los campos empiezan vacíos, sin datos de ejemplo. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Auditor estilo Semrush: informe de Salud del sitio por categorías",
    body: "Publicado el 5 de noviembre: el Auditor web ahora informa estilo Semrush — Salud del sitio con el puntaje y el conteo de errores, advertencias y avisos, y las revisiones agrupadas por SEO, Social, Rastreo y Rendimiento, con 4 revisiones nuevas: robots.txt, sitemap.xml, Twitter card y favicon. Es la revisión propia de la app sobre la página, no datos de Semrush ni de Lighthouse. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Terminal de pruebas en Sistema: consola simulada para admin",
    body: "Publicado el 5 de noviembre: nuevo módulo Terminal en Sistema, solo para administradores — una consola de pruebas simulada con comandos seguros (help, status, health, modules, about, date, echo, clear), sin ejecución en el servidor. Los comandos status y health informan con honestidad si la API responde o no. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
  {
    date: "2026-11-05",
    title: "Login Metro: logo NEST y acceso azul y blanco",
    body: "Publicado el 5 de noviembre: el inicio de sesión ahora lleva el logo NEST en el encabezado y un acceso estilo Metro, plano y en azul fuerte con blanco — fondo azul con mosaicos, tarjeta blanca de esquinas rectas y botón azul. El funcionamiento del login sigue igual y se respeta el movimiento reducido. Trading real sigue apagado y las etiquetas de simulación intactas.",
  },
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
