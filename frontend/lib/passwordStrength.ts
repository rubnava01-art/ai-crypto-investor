// Pista de seguridad de la contraseña en el registro (2026-11-17).
//
// Solo una pista visual en cliente: el backend sigue siendo el gate
// real (mínimo 12 caracteres, decisión de Rubén 2026-11-02; máximo
// 72 bytes UTF-8 por el cap de bcrypt). Nada de esto promete
// seguridad: una contraseña "Fuerte" aquí solo significa larga y
// variada, y el medidor nunca bloquea el envío — el formulario ya
// exige minLength={12}.
//
// Puntos (0–5): +1 por ≥12 caracteres, +1 por ≥16, +1 por usar al
// menos 2 clases de caracteres (minúscula, mayúscula, dígito, símbolo),
// +1 por al menos 3 clases, +1 por las 4. Menos de 12 caracteres es
// siempre "Débil", porque el registro la rechazaría de todos modos.
export type PasswordStrengthLevel = "weak" | "fair" | "good" | "strong";

export interface PasswordStrength {
  level: PasswordStrengthLevel;
  /** Puntos 0–5; 4 segmentos en la barra (weak=1, fair=2, good=3, strong=4). */
  segments: number;
}

export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length < 12) return { level: "weak", segments: 1 };
  const classes =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(pw) ? 1 : 0);
  const score =
    1 + // ≥12 caracteres
    (pw.length >= 16 ? 1 : 0) +
    (classes >= 2 ? 1 : 0) +
    (classes >= 3 ? 1 : 0) +
    (classes >= 4 ? 1 : 0);
  if (score <= 1) return { level: "weak", segments: 1 };
  if (score === 2) return { level: "fair", segments: 2 };
  if (score === 3) return { level: "good", segments: 3 };
  return { level: "strong", segments: 4 };
}
