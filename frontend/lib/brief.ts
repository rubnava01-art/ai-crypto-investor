// Helpers puros del Test exprés para Brief de Marca (NEST, 2026-11-17).
// Sin llamadas al API: la Q2 pide 3 palabras (aviso, nunca bloqueo) y
// el progreso es X/8 respondidas (respuesta = texto no vacío).

export const BRIEF_QUESTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type BriefAnswers = Record<string, string>;

export function countWords(text: string): number {
  return (text || "").split(/\s+/).filter(Boolean).length;
}

export function briefAnswered(answers: BriefAnswers | null | undefined): number {
  if (!answers) return 0;
  return BRIEF_QUESTIONS.filter((n) => (answers[`q${n}`] || "").trim() !== "").length;
}

export function briefMissing(answers: BriefAnswers | null | undefined): number[] {
  if (!answers) return [...BRIEF_QUESTIONS];
  return BRIEF_QUESTIONS.filter((n) => (answers[`q${n}`] || "").trim() === "");
}

/** Aviso de la Q2: hay texto y no son exactamente 3 palabras. */
export function briefQ2Warning(q2: string | null | undefined): boolean {
  const text = (q2 || "").trim();
  return text !== "" && countWords(text) !== 3;
}
