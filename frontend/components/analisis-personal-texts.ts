/** Textos autocontenidos de "Análisis personal" (Mi perfil). ES + EN
 * completos en este archivo para no tocar los diccionarios compartidos.
 * Todo el contenido es original: preguntas de autoevaluación neutras,
 * sin tests copiados, sin ciencia inventada y sin diagnósticos. Los
 * resultados son conteos descriptivos, no medidas clínicas. */

export type LangAP = "es" | "en";

export type LadoEncuesta = "pro" | "mejora";

export interface OpcionEncuesta {
  texto: string;
  lado: LadoEncuesta;
}

export interface PreguntaEncuesta {
  tema: string;
  pregunta: string;
  opciones: [OpcionEncuesta, OpcionEncuesta];
}

export interface PreguntaEscala {
  tema: string;
  pregunta: string;
}

export interface PasoLean {
  titulo: string;
  texto: string;
}

export interface TextosAnalisisPersonal {
  titulo: string;
  intro: string;
  notaPrivacidad: string;
  pestanas: { lean: string; encuesta: string; estres: string };
  lean: {
    titulo: string;
    intro: string;
    pasos: PasoLean[];
    mvpTitulo: string;
    mvpTexto: string;
    validadoTitulo: string;
    validadoTexto: string;
    pivotTitulo: string;
    pivotTexto: string;
    personalTitulo: string;
    personalTexto: string;
  };
  encuesta: {
    titulo: string;
    intro: string;
    responder: string;
    verResultado: string;
    resultadoTitulo: string;
    prosTitulo: string;
    mejorasTitulo: string;
    mensajeFuerte: string;
    mensajeEquilibrio: string;
    mensajeTrabajo: string;
    sinResponder: string;
    repetir: string;
  };
  estres: {
    titulo: string;
    intro: string;
    aviso: string;
    escala: [string, string, string, string];
    estresTitulo: string;
    enfoqueTitulo: string;
    verResultado: string;
    resultadoTitulo: string;
    bandaBaja: string;
    bandaMedia: string;
    bandaAlta: string;
    estresBajo: string;
    estresMedio: string;
    estresAlto: string;
    enfoqueBajo: string;
    enfoqueMedio: string;
    enfoqueAlto: string;
    sinResponder: string;
    repetir: string;
  };
}

const es: TextosAnalisisPersonal = {
  titulo: "Análisis personal",
  intro:
    "Un espacio para mirarte con calma: un modelo para gestionar tus metas como experimentos, una encuesta rápida de fortalezas y áreas a mejorar, y un autochequeo de estrés y enfoque. Todo se calcula en tu navegador; nada se envía a ningún lado.",
  notaPrivacidad:
    "Tus respuestas no se guardan ni se envían: existen solo mientras ves esta pantalla.",
  pestanas: { lean: "Modelo Lean Startup", encuesta: "Encuesta rápida", estres: "Estrés y enfoque" },
  lean: {
    titulo: "Tu vida como experimento: el modelo Lean Startup",
    intro:
      "El modelo Lean Startup nació para crear negocios, pero aquí lo usamos para gestionar metas personales: en vez de un plan gigante que nunca arranca, haces un experimento pequeño, mides qué pasó y decides con datos, no con suposiciones.",
    pasos: [
      {
        titulo: "1. Crear",
        texto: "Convierte tu meta en algo pequeño y concreto que puedas probar esta semana: un hábito, una acción, una primera versión. No tiene que ser perfecto; tiene que existir.",
      },
      {
        titulo: "2. Medir",
        texto: "Observa qué pasó de verdad: ¿lo hiciste? ¿cuántas veces? ¿qué te costó más? Anota hechos simples, no opiniones. Sin medir, solo adivinas.",
      },
      {
        titulo: "3. Aprender",
        texto: "Con lo medido, decide: ¿esto funciona para mí? El aprendizaje vale solo si cambia tu siguiente paso. Si no aprendiste nada, el experimento fue demasiado grande o demasiado vago.",
      },
    ],
    mvpTitulo: "MVP: tu producto mínimo viable",
    mvpTexto:
      "La versión más pequeña de tu meta que te permite aprender. ¿Quieres hacer ejercicio? Tu MVP no es un gimnasio nuevo: es caminar 15 minutos tres días. Si eso funciona, creces desde ahí.",
    validadoTitulo: "Aprendizaje validado",
    validadoTexto:
      "Aprender de hechos, no de suposiciones. 'Creo que no tengo tiempo' es una suposición; 'esta semana tuve 40 minutos libres el martes y el jueves' es un hecho. Las decisiones buenas se toman con hechos.",
    pivotTitulo: "Pivotar o perseverar",
    pivotTexto:
      "Después de medir y aprender, solo hay dos caminos honestos: perseverar (seguir porque los datos lo respaldan) o pivotar (cambiar el camino sin abandonar la meta: otro horario, otro formato, otra ayuda). Quedarse igual sin datos es la única opción que no aprende.",
    personalTitulo: "Tus metas como experimentos",
    personalTexto:
      "Prueba este ciclo con una meta tuya: una semana, un experimento pequeño, una revisión al final. Repite el ciclo y tu plan se vuelve cada vez más real, porque se construye con tu propia evidencia.",
  },
  encuesta: {
    titulo: "Encuesta rápida: pros y áreas a mejorar",
    intro:
      "12 preguntas cortas sobre tu día a día. Cada respuesta apunta a una fortaleza (pro) o a un área a mejorar. Al final verás el conteo y en qué temas saliste más fuerte y en cuáles hay trabajo por hacer. No es un diagnóstico: es una foto para reflexionar.",
    responder: "Responde las 12 preguntas",
    verResultado: "Ver mi resultado",
    resultadoTitulo: "Tu foto de hoy",
    prosTitulo: "Pros: tus fortalezas",
    mejorasTitulo: "Áreas a mejorar",
    mensajeFuerte:
      "En esta revisión dominan tus fortalezas. Úsalas como base: lo que ya haces bien es el mejor punto de partida para mejorar lo demás.",
    mensajeEquilibrio:
      "Tu foto está equilibrada: tantas fortalezas como áreas a mejorar. Elige una sola área y haz un experimento pequeño con ella esta semana.",
    mensajeTrabajo:
      "En esta revisión hay varias áreas a mejorar. No las ataques todas a la vez: elige la que más te pese y conviértela en tu experimento de la semana.",
    sinResponder: "Responde todas las preguntas para ver tu resultado.",
    repetir: "Volver a responder",
  },
  estres: {
    titulo: "Autochequeo: estrés y enfoque",
    intro:
      "10 preguntas: 5 sobre estrés y 5 sobre enfoque. Responde según las últimas dos semanas. El resultado es descriptivo: te muestra si tus respuestas señalan pocas, algunas o varias señales en cada área.",
    aviso:
      "Aviso importante: esto es un autochequeo para reflexionar, NO es un diagnóstico médico ni psicológico y no sustituye el consejo de un profesional. Si te sientes mal, busca apoyo profesional.",
    escala: ["Nunca", "A veces", "A menudo", "Casi siempre"],
    estresTitulo: "Estrés (5 preguntas)",
    enfoqueTitulo: "Enfoque (5 preguntas)",
    verResultado: "Ver mi resultado",
    resultadoTitulo: "Tu resultado descriptivo",
    bandaBaja: "Señales bajas",
    bandaMedia: "Señales moderadas",
    bandaAlta: "Señales altas",
    estresBajo:
      "En tus respuestas hay pocas señales de estrés. Sigue cuidando lo que ya funciona: descanso, pausas y límites claros.",
    estresMedio:
      "En tus respuestas hay algunas señales de estrés. Vale la pena revisar qué lo está generando y probar un cambio pequeño: una pausa real al día, una preocupación escrita en vez de guardada.",
    estresAlto:
      "En tus respuestas hay varias señales de estrés. Tómalo como una invitación a cuidarte: reduce un compromiso, pide ayuda y, si persiste, consulta con un profesional.",
    enfoqueBajo:
      "En tus respuestas hay pocas dificultades de enfoque. Tu atención está respondiendo bien últimamente.",
    enfoqueMedio:
      "En tus respuestas hay algunas dificultades de enfoque. Un experimento útil: una sola tarea a la vez, teléfono fuera de vista por 25 minutos, y una lista corta de prioridades al empezar el día.",
    enfoqueAlto:
      "En tus respuestas hay varias dificultades de enfoque. Empieza por lo más simple: un espacio sin interrupciones, una sola prioridad por bloque de tiempo, y descansos cortos entre tareas.",
    sinResponder: "Responde las 10 preguntas para ver tu resultado.",
    repetir: "Volver a responder",
  },
};

const en: TextosAnalisisPersonal = {
  titulo: "Personal analysis",
  intro:
    "A space to look at yourself calmly: a model for managing your goals as experiments, a quick survey of strengths and areas to improve, and a stress and focus self-check. Everything is computed in your browser; nothing is sent anywhere.",
  notaPrivacidad:
    "Your answers are not saved or sent: they only exist while you view this screen.",
  pestanas: { lean: "Lean Startup model", encuesta: "Quick survey", estres: "Stress and focus" },
  lean: {
    titulo: "Your life as an experiment: the Lean Startup model",
    intro:
      "The Lean Startup model was born for building businesses, but here we use it to manage personal goals: instead of a giant plan that never starts, you run a small experiment, measure what happened, and decide with data, not assumptions.",
    pasos: [
      {
        titulo: "1. Build",
        texto: "Turn your goal into something small and concrete you can try this week: a habit, an action, a first version. It does not have to be perfect; it has to exist.",
      },
      {
        titulo: "2. Measure",
        texto: "Observe what really happened: did you do it? How many times? What cost you the most? Write down simple facts, not opinions. Without measuring, you are only guessing.",
      },
      {
        titulo: "3. Learn",
        texto: "With what you measured, decide: does this work for me? Learning only counts if it changes your next step. If you learned nothing, the experiment was too big or too vague.",
      },
    ],
    mvpTitulo: "MVP: your minimum viable product",
    mvpTexto:
      "The smallest version of your goal that lets you learn. Want to exercise? Your MVP is not a new gym: it is walking 15 minutes three days. If that works, you grow from there.",
    validadoTitulo: "Validated learning",
    validadoTexto:
      "Learning from facts, not assumptions. 'I think I have no time' is an assumption; 'this week I had 40 free minutes on Tuesday and Thursday' is a fact. Good decisions are made with facts.",
    pivotTitulo: "Pivot or persevere",
    pivotTexto:
      "After measuring and learning, there are only two honest paths: persevere (keep going because the data supports it) or pivot (change the path without abandoning the goal: another schedule, another format, another kind of help). Staying the same without data is the only option that learns nothing.",
    personalTitulo: "Your goals as experiments",
    personalTexto:
      "Try this cycle with one of your goals: one week, one small experiment, one review at the end. Repeat the cycle and your plan becomes more and more real, because it is built on your own evidence.",
  },
  encuesta: {
    titulo: "Quick survey: pros and areas to improve",
    intro:
      "12 short questions about your daily life. Each answer points to a strength (pro) or an area to improve. At the end you will see the count and which themes came out stronger and which need work. This is not a diagnosis: it is a snapshot for reflection.",
    responder: "Answer the 12 questions",
    verResultado: "See my result",
    resultadoTitulo: "Your snapshot today",
    prosTitulo: "Pros: your strengths",
    mejorasTitulo: "Areas to improve",
    mensajeFuerte:
      "In this review your strengths dominate. Use them as your base: what you already do well is the best starting point for improving the rest.",
    mensajeEquilibrio:
      "Your snapshot is balanced: as many strengths as areas to improve. Pick just one area and run a small experiment with it this week.",
    mensajeTrabajo:
      "In this review there are several areas to improve. Do not attack them all at once: pick the one that weighs on you most and make it your experiment of the week.",
    sinResponder: "Answer all the questions to see your result.",
    repetir: "Answer again",
  },
  estres: {
    titulo: "Self-check: stress and focus",
    intro:
      "10 questions: 5 about stress and 5 about focus. Answer based on the last two weeks. The result is descriptive: it shows whether your answers point to few, some, or several signals in each area.",
    aviso:
      "Important notice: this is a self-check for reflection, NOT a medical or psychological diagnosis, and it does not replace professional advice. If you feel unwell, seek professional support.",
    escala: ["Never", "Sometimes", "Often", "Almost always"],
    estresTitulo: "Stress (5 questions)",
    enfoqueTitulo: "Focus (5 questions)",
    verResultado: "See my result",
    resultadoTitulo: "Your descriptive result",
    bandaBaja: "Low signals",
    bandaMedia: "Moderate signals",
    bandaAlta: "High signals",
    estresBajo:
      "Your answers show few signs of stress. Keep caring for what already works: rest, pauses, and clear boundaries.",
    estresMedio:
      "Your answers show some signs of stress. It is worth reviewing what is generating it and trying one small change: one real pause a day, one worry written down instead of kept inside.",
    estresAlto:
      "Your answers show several signs of stress. Take it as an invitation to take care of yourself: drop one commitment, ask for help, and if it persists, consult a professional.",
    enfoqueBajo:
      "Your answers show few focus difficulties. Your attention has been responding well lately.",
    enfoqueMedio:
      "Your answers show some focus difficulties. A useful experiment: one task at a time, phone out of sight for 25 minutes, and a short priority list at the start of the day.",
    enfoqueAlto:
      "Your answers show several focus difficulties. Start with the simplest: a space without interruptions, one priority per time block, and short breaks between tasks.",
    sinResponder: "Answer all 10 questions to see your result.",
    repetir: "Answer again",
  },
};

export const textosAnalisisPersonal: Record<LangAP, TextosAnalisisPersonal> = { es, en };

/** 12 preguntas originales de la encuesta rápida. Cada opción apunta a
 * un lado: "pro" (fortaleza) o "mejora" (área a mejorar). El orden de
 * los lados varía para no sesgar por posición. */
export const preguntasEncuesta: Record<LangAP, PreguntaEncuesta[]> = {
  es: [
    { tema: "Organización del día", pregunta: "¿Cómo sueles empezar tu día?", opciones: [
      { texto: "Con un plan claro de lo importante", lado: "pro" },
      { texto: "Improvisando según lo que llegue", lado: "mejora" },
    ] },
    { tema: "Constancia", pregunta: "Cuando empiezas algo, ¿qué pasa normalmente?", opciones: [
      { texto: "Lo dejo a medias con frecuencia", lado: "mejora" },
      { texto: "Lo termino aunque cueste", lado: "pro" },
    ] },
    { tema: "Enfoque", pregunta: "Al trabajar en algo importante, ¿qué te pasa?", opciones: [
      { texto: "Me concentro sin distraerme fácil", lado: "pro" },
      { texto: "Me distraigo con facilidad", lado: "mejora" },
    ] },
    { tema: "Aprendizaje", pregunta: "¿Con qué frecuencia aprendes algo nuevo?", opciones: [
      { texto: "Casi nunca busco aprender cosas nuevas", lado: "mejora" },
      { texto: "Cada semana aprendo algo nuevo", lado: "pro" },
    ] },
    { tema: "Finanzas", pregunta: "¿Cómo llevas tus gastos?", opciones: [
      { texto: "Llevo un control y sé en qué gasto", lado: "pro" },
      { texto: "No sé bien en qué se va el dinero", lado: "mejora" },
    ] },
    { tema: "Salud y descanso", pregunta: "¿Cómo cuidas tu sueño y tu movimiento?", opciones: [
      { texto: "Duermo y me muevo con regularidad", lado: "pro" },
      { texto: "Descuido el sueño y el movimiento", lado: "mejora" },
    ] },
    { tema: "Comunicación", pregunta: "¿Cómo te va al pedir lo que necesitas?", opciones: [
      { texto: "Me cuesta pedir ayuda o decir que no", lado: "mejora" },
      { texto: "Lo digo con claridad y respeto", lado: "pro" },
    ] },
    { tema: "Metas", pregunta: "¿Dónde viven tus metas?", opciones: [
      { texto: "Escritas, y las reviso con frecuencia", lado: "pro" },
      { texto: "Solo en mi cabeza, sin revisarlas", lado: "mejora" },
    ] },
    { tema: "Tiempo", pregunta: "¿Cómo se siente tu tiempo en un día normal?", opciones: [
      { texto: "Apago fuegos todo el día", lado: "mejora" },
      { texto: "Priorizo lo importante primero", lado: "pro" },
    ] },
    { tema: "Adaptación", pregunta: "Cuando algo cambia tus planes, ¿qué haces?", opciones: [
      { texto: "Ajusto el plan y sigo adelante", lado: "pro" },
      { texto: "Me frustro y me detengo", lado: "mejora" },
    ] },
    { tema: "Relaciones", pregunta: "Cuando hay presión, ¿qué pasa con tu gente?", opciones: [
      { texto: "Me aíslo y dejo de contestar", lado: "mejora" },
      { texto: "Mantengo el contacto aunque sea breve", lado: "pro" },
    ] },
    { tema: "Progreso", pregunta: "¿Cómo miras tus avances?", opciones: [
      { texto: "Reconozco lo que ya avancé", lado: "pro" },
      { texto: "Solo me fijo en lo que falta", lado: "mejora" },
    ] },
  ],
  en: [
    { tema: "Day organization", pregunta: "How do you usually start your day?", opciones: [
      { texto: "With a clear plan of what matters", lado: "pro" },
      { texto: "Improvising as things come up", lado: "mejora" },
    ] },
    { tema: "Consistency", pregunta: "When you start something, what usually happens?", opciones: [
      { texto: "I often leave it half done", lado: "mejora" },
      { texto: "I finish it even when it is hard", lado: "pro" },
    ] },
    { tema: "Focus", pregunta: "When working on something important, what happens to you?", opciones: [
      { texto: "I concentrate without getting distracted easily", lado: "pro" },
      { texto: "I get distracted easily", lado: "mejora" },
    ] },
    { tema: "Learning", pregunta: "How often do you learn something new?", opciones: [
      { texto: "I almost never seek to learn new things", lado: "mejora" },
      { texto: "Every week I learn something new", lado: "pro" },
    ] },
    { tema: "Finances", pregunta: "How do you handle your spending?", opciones: [
      { texto: "I keep track and know where it goes", lado: "pro" },
      { texto: "I am not sure where the money goes", lado: "mejora" },
    ] },
    { tema: "Health and rest", pregunta: "How do you care for your sleep and movement?", opciones: [
      { texto: "I sleep and move regularly", lado: "pro" },
      { texto: "I neglect sleep and movement", lado: "mejora" },
    ] },
    { tema: "Communication", pregunta: "How do you do asking for what you need?", opciones: [
      { texto: "I struggle to ask for help or say no", lado: "mejora" },
      { texto: "I say it clearly and respectfully", lado: "pro" },
    ] },
    { tema: "Goals", pregunta: "Where do your goals live?", opciones: [
      { texto: "Written down, and I review them often", lado: "pro" },
      { texto: "Only in my head, never reviewed", lado: "mejora" },
    ] },
    { tema: "Time", pregunta: "How does your time feel on a normal day?", opciones: [
      { texto: "I put out fires all day", lado: "mejora" },
      { texto: "I prioritize what matters first", lado: "pro" },
    ] },
    { tema: "Adaptability", pregunta: "When something changes your plans, what do you do?", opciones: [
      { texto: "I adjust the plan and keep going", lado: "pro" },
      { texto: "I get frustrated and stop", lado: "mejora" },
    ] },
    { tema: "Relationships", pregunta: "When there is pressure, what happens with your people?", opciones: [
      { texto: "I isolate myself and stop replying", lado: "mejora" },
      { texto: "I keep in touch even if briefly", lado: "pro" },
    ] },
    { tema: "Progress", pregunta: "How do you look at your progress?", opciones: [
      { texto: "I recognize what I have already achieved", lado: "pro" },
      { texto: "I only notice what is missing", lado: "mejora" },
    ] },
  ],
};

/** 5 preguntas de estrés + 5 de enfoque. Todas están redactadas como
 * dificultad (a mayor frecuencia, más señales), para que la suma por
 * área se lea igual en ambos bloques. Escala 0–3, suma por área 0–15:
 * 0–4 baja, 5–9 moderada, 10–15 alta. Bandas descriptivas, no clínicas. */
export const preguntasEstres: Record<LangAP, PreguntaEscala[]> = {
  es: [
    { tema: "Tensión", pregunta: "¿Con qué frecuencia sientes tensión en el cuerpo (cuello, espalda, mandíbula)?" },
    { tema: "Sueño", pregunta: "¿Con qué frecuencia te cuesta dormir o despiertas cansado/a?" },
    { tema: "Irritabilidad", pregunta: "¿Con qué frecuencia reaccionas con irritación por cosas pequeñas?" },
    { tema: "Preocupación", pregunta: "¿Con qué frecuencia tu mente no deja de darle vueltas a un problema?" },
    { tema: "Agobio", pregunta: "¿Con qué frecuencia sientes que todo junto te supera?" },
  ],
  en: [
    { tema: "Tension", pregunta: "How often do you feel tension in your body (neck, back, jaw)?" },
    { tema: "Sleep", pregunta: "How often do you struggle to sleep or wake up tired?" },
    { tema: "Irritability", pregunta: "How often do you react with irritation over small things?" },
    { tema: "Worry", pregunta: "How often does your mind keep going over a problem?" },
    { tema: "Overwhelm", pregunta: "How often do you feel that everything together overwhelms you?" },
  ],
};

export const preguntasEnfoque: Record<LangAP, PreguntaEscala[]> = {
  es: [
    { tema: "Atención", pregunta: "¿Con qué frecuencia te cuesta mantener la atención en una tarea?" },
    { tema: "Terminar", pregunta: "¿Con qué frecuencia dejas tareas empezadas sin terminar?" },
    { tema: "Teléfono", pregunta: "¿Con qué frecuencia el teléfono te saca de lo que estabas haciendo?" },
    { tema: "Interrupciones", pregunta: "¿Con qué frecuencia te cuesta retomar una tarea tras una interrupción?" },
    { tema: "Prioridades", pregunta: "¿Con qué frecuencia no tienes claro por qué empezar el día?" },
  ],
  en: [
    { tema: "Attention", pregunta: "How often do you struggle to keep your attention on a task?" },
    { tema: "Finishing", pregunta: "How often do you leave tasks started but unfinished?" },
    { tema: "Phone", pregunta: "How often does your phone pull you away from what you were doing?" },
    { tema: "Interruptions", pregunta: "How often do you struggle to resume a task after an interruption?" },
    { tema: "Priorities", pregunta: "How often are you unclear about what to start the day with?" },
  ],
};

/** Banda descriptiva de una suma 0–15. Solo describe las respuestas;
 * nunca es un diagnóstico ni una medida clínica. */
export function bandaDeSuma(suma: number): "baja" | "media" | "alta" {
  if (suma <= 4) return "baja";
  if (suma <= 9) return "media";
  return "alta";
}
