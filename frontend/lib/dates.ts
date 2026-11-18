// Fechas y zona horaria de negocio (NEST, 2026-11-17).
// Rubén revisa en iPhone (America/Los_Angeles): las citas se guardan en
// ISO UTC con offset y se muestran SIEMPRE con timeZone explícito, nunca
// con la zona del dispositivo. Los días del calendario son fechas civiles
// (YYYY-MM-DD), no instantes, para no romper con el cambio de hora.

export const BUSINESS_TIME_ZONE = "America/Los_Angeles";

/** Desplazamiento de la zona en minutos para un instante UTC dado. */
export function tzOffsetMinutes(date: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wallAsUtc - date.getTime()) / 60000);
}

/** Partes civiles (año/mes/día/hora/minuto) de un instante en la zona. */
export function tzParts(
  date: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Fecha civil (YYYY-MM-DD) de un instante ISO en la zona de negocio. */
export function dateKeyInTz(iso: string | null | undefined, timeZone: string = BUSINESS_TIME_ZONE): string | null {
  if (!iso) return null;
  const p = tzParts(new Date(iso), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Fecha y hora en la zona de negocio (con timeZone explícito). */
export function formatDateTimeTz(
  iso: string | null | undefined,
  locale: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Fecha sola en la zona de negocio (con timeZone explícito). */
export function formatDateTz(
  iso: string | null | undefined,
  locale: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Valor para <input type="date"> a partir de un ISO (fecha civil en la zona). */
export function toDateInputValue(iso: string | null | undefined, timeZone: string = BUSINESS_TIME_ZONE): string {
  return dateKeyInTz(iso, timeZone) ?? "";
}

/** Valor para <input type="time"> a partir de un ISO (hora civil en la zona). */
export function toTimeInputValue(iso: string | null | undefined, timeZone: string = BUSINESS_TIME_ZONE): string {
  if (!iso) return "";
  const p = tzParts(new Date(iso), timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Fecha + hora civiles en la zona → ISO UTC. Interpreta la hora de pared
 * en la zona (no en la zona del dispositivo). Devuelve "" si no hay fecha. */
export function combineDateTimeToIso(
  dateStr: string,
  timeStr: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  // La hora de pared como UTC, corregida por el offset de la zona en ese
  // instante (dos iteraciones bastan incluso en el cambio de hora).
  const wallAsUtc = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i += 1) {
    guess = wallAsUtc - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  }
  return new Date(guess).toISOString();
}

// ---------- Calendario mes (días civiles, semanas de lunes a domingo) ----------

export interface CalendarDay {
  /** Fecha civil YYYY-MM-DD (medianoche UTC, solo para ordenar/agrupar). */
  key: string;
  year: number;
  month: number; // 1-12
  day: number;
  inMonth: boolean;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Rejilla del mes: filas de 7 días (lunes…domingo), con los días de los
 * meses vecinos para completar la primera y la última semana. */
export function buildMonthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay: 0 domingo … 6 sábado; lunes = 0 en nuestra rejilla.
  const lead = (first.getUTCDay() + 6) % 7;
  const total = daysInMonth(year, month);
  const cells: CalendarDay[] = [];
  const start = new Date(Date.UTC(year, month - 1, 1 - lead));
  const cellCount = Math.ceil((lead + total) / 7) * 7;
  for (let i = 0; i < cellCount; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    const cy = d.getUTCFullYear();
    const cm = d.getUTCMonth() + 1;
    const cd = d.getUTCDate();
    cells.push({
      key: `${cy}-${String(cm).padStart(2, "0")}-${String(cd).padStart(2, "0")}`,
      year: cy,
      month: cm,
      day: cd,
      inMonth: cm === month && cy === year,
    });
  }
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Suma días civiles a una fecha YYYY-MM-DD. */
export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Hoy civil en la zona de negocio. */
export function todayKey(timeZone: string = BUSINESS_TIME_ZONE): string {
  return dateKeyInTz(new Date().toISOString(), timeZone) ?? "";
}
