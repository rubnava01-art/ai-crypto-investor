// Onboarding de 3 pasos (Fase 4 mejoras-v1, tarea 3): guía de primera
// vez en el dashboard. Estado SOLO en localStorage, por usuario
// (clave con el nombre de usuario): es una guía de interfaz, no un
// dato de negocio — si el usuario cambia de navegador la vuelve a ver
// y puede omitirla con un clic. Nada se inventa: el paso 1 confirma la
// cuenta real con la que entró y el paso 2 enlaza a /planes (precios
// reales) sin prometer activación inmediata (la activa un admin).
export type OnboardingGoal = "clientes" | "facturar" | "crear" | "practicar";

export interface OnboardingState {
  done: boolean;
  step: 1 | 2 | 3;
  goal: OnboardingGoal | null;
}

export const ONBOARDING_DEFAULT: OnboardingState = { done: false, step: 1, goal: null };

export function onboardingKey(username: string): string {
  return `gpb_onboarding_v1:${username}`;
}

export function loadOnboarding(username: string): OnboardingState {
  if (typeof window === "undefined") return ONBOARDING_DEFAULT;
  try {
    const raw = window.localStorage.getItem(onboardingKey(username));
    if (!raw) return ONBOARDING_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      done: parsed.done === true,
      step: parsed.step === 2 || parsed.step === 3 ? parsed.step : 1,
      goal:
        parsed.goal === "clientes" ||
        parsed.goal === "facturar" ||
        parsed.goal === "crear" ||
        parsed.goal === "practicar"
          ? parsed.goal
          : null,
    };
  } catch {
    return ONBOARDING_DEFAULT;
  }
}

export function saveOnboarding(username: string, state: OnboardingState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(onboardingKey(username), JSON.stringify(state));
  } catch {
    // Almacenamiento lleno o bloqueado: la guía se muestra de nuevo en
    // la próxima visita, sin romper nada.
  }
}
