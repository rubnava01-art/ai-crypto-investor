// Tipos de contrato del API (extraídos de lib/api.ts en Fase 4, sin cambios).
// El dinero sigue siendo string de punta a punta; el formateo es solo de render.

// ---------- contract types ----------

export interface HealthResponse {
  status: string;
  version: string;
  mode: string;
  timestamp_utc: string;
  // 2026-11-05: "ok" | "error" (ausente en APIs viejas).
  database?: string;
}
export interface TokenResponse {
  access_token: string;
  token_type: string;
}
export interface SystemStatus {
  mode: "demo" | "live";
  exchange_connected: boolean;
  scanner_running: boolean;
  simulation_mode: "simulation" | "paper" | "real";
  kill_switch: boolean;
  data_source: string;
  last_update_utc: string;
}
export interface BalancesResponse {
  equity_usd: string;
  available_usd: string;
  currency: string;
  demo: boolean;
  as_of_utc: string;
}
export interface PerformanceResponse {
  realized_pnl_usd: string;
  unrealized_pnl_usd: string;
  max_drawdown_pct: string;
  fees_paid_usd: string;
  demo: boolean;
  as_of_utc: string;
}
export type SignalSide = "buy" | "sell" | "hold";
export interface SignalHistory {
  wins: number;
  losses: number;
  total: number;
  win_rate_pct: number | null;
}
export interface SignalOut {
  id: number;
  symbol: string;
  side: SignalSide;
  entry_price: string | null;
  target_price: string | null;
  invalidation_price: string | null;
  reason: string;
  status: string;
  created_utc: string;
  confidence_pct: number | null;
  history: SignalHistory | null;
}
export interface SignalsResponse {
  signals: SignalOut[];
  demo: boolean;
}
export interface StrategyOut {
  id: number;
  name: string;
  version: string;
  status: string;
  notes: string;
}
export interface ScannerState {
  running: boolean;
}
export interface SimulationModes {
  modes: ("simulation" | "paper" | "real")[];
  current: string;
  real_enabled: boolean;
}
export interface OperationsResponse {
  orders: Record<string, unknown>[];
  trades: Record<string, unknown>[];
}
export interface RiskLimits {
  max_risk_per_trade_pct: string;
  max_daily_loss_usd: string;
  max_trades_per_day: number;
  spot_only: boolean;
  no_leverage: boolean;
  kill_switch: boolean;
}
export interface KillSwitchResponse {
  kill_switch: boolean;
  engaged_utc: string;
  idempotent_replay: boolean;
}
export interface LogEntry {
  id: number;
  level: string;
  category: string;
  message: string;
  created_utc: string;
}
export interface AIAskResponse {
  answer: string;
  refused: boolean;
  demo: boolean;
  confidence: number | null;
  signal_id: number | null;
}
export interface CalibrationBucket {
  bucket: string;
  n: number;
  claimed_avg_pct: number;
  actual_win_pct: number;
  miscalibrated: boolean;
}
export interface AILessonsResponse {
  summary_es: string;
  calibration: CalibrationBucket[];
  demo_note: string;
}
export interface AIStatusResponse {
  provider: string;
  configured: boolean;
  demo: boolean;
}

export interface CoinPrice {
  symbol: string;
  name: string;
  pair: string;
  price_usd: number | null;
  change_24h_pct: number | null;
  sparkline_24h: number[];
}

export interface MarketPricesResponse {
  source: string;
  updated_utc: string;
  stale: boolean;
  prices: CoinPrice[];
}

// ---------- Mercado: velas, ticker e indicadores (Clases, 2026-11-10) ----------
// El backend devuelve OHLCV como CADENAS (CandleOut) y `last` como cadena
// o null (TickerResponse); el frontend los parsea a número aquí, en la
// frontera del cliente, y descarta las velas con OHLC no numérico en vez
// de inventar un valor. Un 503 significa "sin datos" (sin velas o sin
// suficientes velas): nunca se muestra un precio o una gráfica inventados.

/** Vela tal como la devuelve el backend (cadenas). */
export interface MarketCandleRaw {
  open_time_utc: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/** Vela ya parseada a número (lista para graficar). */
export interface MarketCandle {
  openTimeUtc: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketCandlesResponse {
  symbol: string;
  timeframe: string;
  source: string;
  updated_utc: string;
  stale: boolean;
  newest_candle_utc: string;
  candles: MarketCandle[];
}

export interface MarketTickerResponse {
  symbol: string;
  last: number | null;
  source: string;
  updated_utc: string;
  stale: boolean;
}

export interface MacdOut {
  macd_line: number | null;
  signal_line: number | null;
  histogram: number | null;
}

export interface MarketIndicators {
  rsi_14: number | null;
  macd: MacdOut | null;
  sma_20: number | null;
  sma_50: number | null;
  ema_20: number | null;
  volatility_20: number | null;
  volume_sma_20: number | null;
  last_close: number | null;
  n_candles: number;
}

export interface MarketIndicatorsResponse {
  symbol: string;
  timeframe: string;
  source: string;
  updated_utc: string;
  stale: boolean;
  newest_candle_utc: string;
  indicators: MarketIndicators;
}

export interface MeResponse {
  username: string;
  is_admin: boolean;
  is_super_admin: boolean;
  role: "admin" | "prueba" | "super_admin";
  // Fase 1 mejoras-v1, tarea 1 y 3: el backend /me devuelve el correo
  // y su verificación, y si el 2FA está activo en la cuenta.
  email: string | null;
  email_verified: boolean;
  two_factor_enabled: boolean;
  // Perfil editable (paquete 2026-10-28): vacíos hasta que el usuario
  // los llene — nunca se inventan.
  display_name: string | null;
  address: string | null;
  avatar_data_url: string | null;
}

export interface UserProfile {
  id: number;
  username: string;
  role: "admin" | "prueba" | "super_admin";
  is_admin: boolean;
  display_name: string | null;
  email: string | null;
  address: string | null;
  avatar_data_url: string | null;
  created_at: string | null;
  // Rediseño perfil 2026-11-17 (tarjeta de red): todo opcional.
  bio: string | null;
  location: string | null;
  business_handle: string | null;
  business_description: string | null;
  skills: string[] | null;
  // Fase 1 mejoras-v1, tarea 1: el backend /api/profile/me devuelve si
  // el correo está verificado (el panel muestra el aviso + reenvío).
  email_verified: boolean;
}

export interface UserProfileInput {
  display_name?: string;
  email?: string;
  address?: string;
  avatar_data_url?: string;
  bio?: string;
  location?: string;
  business_handle?: string;
  business_description?: string;
  skills?: string[];
}

// Fase 7 mejoras-v1: suscripción propia (GET /api/suscripciones/mia).
export interface Suscripcion {
  id: number;
  user_id: number;
  plan: string;
  plan_nombre: string;
  precio_mensual_usd: number;
  estado: string;
  estado_efectivo: string;
  acceso_activo: boolean;
  prueba_inicio: string | null;
  prueba_fin: string | null;
  renovacion_en: string | null;
  cancelada_en: string | null;
  acceso_hasta: string | null;
  dias_restantes_prueba: number | null;
  creado_en: string | null;
  actualizado_en: string | null;
}

export interface MiSuscripcion {
  suscripcion: Suscripcion | null;
  pago_en_linea: {
    configurado: boolean;
    proveedor: string | null;
    mensaje: string;
    pendientes: string[];
  };
}

export interface CancelarSuscripcionResult {
  suscripcion: Suscripcion;
  mensaje: string;
}

// ---------- Chat en vivo ----------

export interface ChatMessage {
  id: number;
  author_username: string;
  author_label: string;
  text: string;
  created_at: string | null;
}

// ---------- Recomendaciones ----------

export type RecommendationCategory = "curso" | "herramienta";

export interface Recommendation {
  id: number;
  title: string;
  description: string;
  url: string;
  category: RecommendationCategory;
  created_at: string | null;
  updated_at: string | null;
}

export interface RecommendationInput {
  title: string;
  description?: string;
  url?: string;
  category?: RecommendationCategory;
}

// ---------- Inicio: noticias y comentarios ----------
export interface HomePost {
  id: number;
  title: string;
  body: string;
  author_name: string;
  author_username?: string;
  comment_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface HomePostInput {
  title: string;
  body?: string;
}

export interface HomeComment {
  id: number;
  post_id: number;
  author_name: string;
  author_username?: string;
  body: string;
  created_at: string | null;
  can_delete: boolean;
}

// ---------- Analizador IA ----------
export interface AnalizadorIndicador {
  nombre: string;
  valor: string;
  detalle: string;
  punto: boolean;
  // "contenido" (indicadores de texto, los únicos que puntúan) o
  // "estructura" (revisiones de la página, solo contexto).
  categoria: string;
  // Seriedad del hallazgo: "error" | "advertencia" | "aviso".
  severidad: string;
  // True si la revisión está bien (o es solo informativa).
  pasa: boolean;
}

export interface AnalizadorDesglose {
  nombre: string;
  puntos: number;
  maximo: number;
  detalle: string;
}

export interface AnalizarResponse {
  url: string;
  final_url: string;
  titulo: string;
  palabras: number;
  indicadores: AnalizadorIndicador[];
  puntaje: number;
  puntaje_maximo: number;
  desglose: AnalizadorDesglose[];
  siguientes_pasos: string[];
  banda: "bajo" | "medio" | "alto";
  etiqueta_banda: string;
  regla: string;
  descargo: string;
}

// ---------- Inventario ----------
export type InventoryUnit = "pieza" | "kg" | "litro" | "metro" | "caja" | "otro";

export interface InventoryItem {
  id: number;
  name: string;
  description: string;
  sku: string;
  quantity: number;
  unit: InventoryUnit;
  unit_price: number;
  min_stock: number;
  low_stock: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface InventoryItemInput {
  name: string;
  description?: string;
  sku?: string;
  quantity?: number;
  unit?: InventoryUnit;
  unit_price?: number;
  min_stock?: number;
  // Motivo del cambio de cantidad (Fase 5b, tarea 3): solo alimenta el
  // historial de movimientos; no se guarda en el producto.
  motivo?: string;
}

// Movimiento de stock (Fase 5b mejoras-v1, tarea 3): una fila por cambio
// real de cantidad, con delta con signo y stock resultante.
export interface InventoryMovement {
  id: number;
  item_id: number;
  tipo: "entrada" | "venta" | "ajuste";
  cantidad_delta: number;
  cantidad_final: number;
  motivo: string;
  created_at: string | null;
}

// ---------- Privacidad y cumplimiento ----------

export type ComplianceCategory =
  | "documentos"
  | "cookies"
  | "datos"
  | "transparencia"
  | "accesibilidad"
  | "negocio";

export type ComplianceStatus = "pendiente" | "en_proceso" | "completado";

export interface ComplianceItem {
  id: number;
  title: string;
  category: ComplianceCategory;
  description: string;
  status: ComplianceStatus;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ComplianceItemInput {
  title: string;
  category?: ComplianceCategory;
  description?: string;
  status?: ComplianceStatus;
  notes?: string;
}

// ---------- Desarrollo digital ----------

export type DigitalStage = "diagnostico" | "propuesta" | "desarrollo" | "entrega";

export interface DigitalProject {
  id: number;
  contact_id: number | null;
  contact_name: string | null;
  title: string;
  stage: DigitalStage;
  notes: string;
  tasks_count: number;
  done_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface DigitalProjectInput {
  title: string;
  contact_id?: number | null;
  stage?: DigitalStage;
  notes?: string;
}

export interface DigitalProjectUpdate {
  title?: string;
  contact_id?: number | null;
  clear_contact?: boolean;
  stage?: DigitalStage;
  notes?: string;
}

export interface DigitalTask {
  id: number;
  project_id: number;
  title: string;
  done: boolean;
  created_at: string | null;
}

// ---------- Tendencias ----------

export interface TrendResearch {
  keyword: string;
  es: string[];
  en: string[];
  warning: string | null;
  source_note: string;
}

export interface TrendSearch {
  id: number;
  keyword: string;
  created_at: string | null;
}

// ---------- Auditor web ----------

export interface AuditCheck {
  id: string;
  label: string;
  passed: boolean;
  value: string;
  ideal: string;
  // Opcionales: las auditorías viejas guardadas no los traen.
  category?: string;
  severity?: string;
}

export interface WebAudit {
  id: number;
  url: string;
  final_url: string;
  status: number;
  redirect_count: number;
  ttfb_ms: number;
  total_ms: number;
  size_kb: number;
  is_https: boolean;
  score: number | null;
  checks: AuditCheck[];
  note: string;
  owner_username: string | null;
  created_at: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  role: "admin" | "prueba" | "super_admin";
  is_admin: boolean;
  is_super_admin: boolean;
  status: "active" | "pending";
  requested_plan: string | null;
  created_at: string | null;
}

export interface RegisterChallenge {
  challenge_id: string;
  question: string;
}

export interface OrderOut {
  id: number;
  client_order_id: string;
  symbol: string;
  side: string;
  quantity: string;
  status: string;
  mode: string;
  created_utc: string;
}

export interface DashboardResponse {
  system: SystemStatus | null;
  balances: BalancesResponse | null;
  performance: PerformanceResponse | null;
  signals: SignalsResponse | null;
  strategies: StrategyOut[] | null;
  modes: SimulationModes | null;
  operations: OperationsResponse | null;
  risk: RiskLimits | null;
  logs: LogEntry[] | null;
}

// ---------- CRM (Grow Business Platform — Fase 1) ----------

export type CrmSource = "manual" | "academia" | "cohley" | "rivgoods" | "otro";
export type CrmStatus = "nuevo" | "contactado" | "interesado" | "cliente" | "inactivo";

// Etapa de venta (Fase 5b mejoras-v1, tarea 1): embudo propio, distinto
// del estado general. "ganado"/"perdido" cierran el embudo.
export type CrmStage = "nuevo" | "contactado" | "propuesta" | "negociacion" | "ganado" | "perdido";

export interface CrmContact {
  id: number;
  name: string;
  email: string;
  phone: string;
  source: CrmSource;
  tags: string[];
  status: CrmStatus;
  stage: CrmStage;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface CrmContactInput {
  name: string;
  email?: string;
  phone?: string;
  source?: CrmSource;
  tags?: string[];
  status?: CrmStatus;
  stage?: CrmStage;
  notes?: string;
}

export interface CrmStageHistory {
  id: number;
  contact_id: number;
  from_stage: CrmStage | null;
  to_stage: CrmStage;
  changed_at: string | null;
}

export interface CrmReminder {
  id: number;
  contact_id: number;
  remind_date: string;
  note: string;
  done: boolean;
  created_at: string | null;
}

export interface CrmImportResult {
  creados: number;
  errores: { fila: number; error: string }[];
}

// Resumen del CRM (Fase 3, rediseño estilo Vivero): solo datos reales
// (contactos, citas, facturas). Ver GET /api/crm/contacts/resumen.
export interface CrmResumenPaso {
  clave: string;
  numero: number;
  total: number;
  hoy: number;
  serie_7d: number[];
  sub: string;
  vacio: string;
}

export interface CrmResumenDinero {
  cantidad: number;
  total: number;
}

export interface CrmResumen {
  fecha: string;
  zona_horaria: string;
  pasos: CrmResumenPaso[];
  leyenda: { estado: string; total: number }[];
  metricas: {
    contactos_nuevos_hoy: number;
    citas_hoy: number;
    ventas_hoy: CrmResumenDinero;
    ventas_semana: CrmResumenDinero;
    por_cobrar: CrmResumenDinero;
    clientes: number;
  };
  ventas_semana_dias: { fecha: string; etiqueta: string; total: number; cantidad: number }[];
  nota_ventas: string;
}

// ---------- Academia (Grow Business Platform — Fase 2, módulo Estudiar) ----------

export type CourseKind = "ebook" | "pack" | "academia";

export interface AcademyDownload {
  course_id: number;
  title: string;
  filename: string;
}

export interface AcademyCourse {
  id: number;
  slug: string;
  title: string;
  description: string;
  price_usd: string;
  kind: CourseKind;
  buy_url: string;
  delivery_note: string;
  sort_order: number;
  students_count: number;
  downloads: AcademyDownload[];
  created_at: string | null;
  updated_at: string | null;
}

export interface AcademyEnrollment {
  id: number;
  contact_id: number;
  course_id: number;
  contact_name: string;
  contact_email: string;
  course_title: string;
  purchased: boolean;
  delivered: boolean;
  purchased_at: string | null;
  delivered_at: string | null;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

// ---------- Crear (Grow Business Platform — Fase 3) ----------

export type CopyPlatform = "instagram" | "threads" | "facebook";
export type CopyTone = "directo" | "educativo" | "divertido" | "profesional";

export interface CopyDraft {
  id: number;
  topic: string;
  platform: CopyPlatform;
  tone: string;
  text: string;
  demo: boolean;
  created_at: string | null;
}

export interface TrendNote {
  id: number;
  title: string;
  source: string;
  summary: string;
  published_on: string | null;
  created_at: string | null;
}

// ---------- Espacio (meditación y revelaciones) ----------

export interface Revelation {
  id: number;
  title: string;
  text: string;
  created_at: string | null;
}

export interface EmotionEntry {
  id: number;
  emotion: string;
  intensity: number;
  note: string;
  created_at: string | null;
}

// ---------- Clases (Estudiar) ----------

export type EduClassKind = "grabada" | "envivo";

export interface EduClass {
  id: number;
  kind: EduClassKind;
  title: string;
  description: string;
  url: string;
  scheduled_at: string | null;
  duration_min: number | null;
  created_at: string | null;
}

export interface EduProgressKind {
  total: number;
  completed: number;
  pct: number;
}

export interface EduProgress {
  completed_class_ids: number[];
  total: number;
  completed: number;
  pct: number;
  by_kind: Record<EduClassKind, EduProgressKind>;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
}

export interface QuizOut {
  class_id: number;
  has_quiz: boolean;
  questions: QuizQuestion[];
}

export interface QuizResultItem {
  question_id: number;
  correct: boolean;
  correct_index: number;
  explanation: string;
}

export interface QuizResult {
  score: number;
  total: number;
  results: QuizResultItem[];
}

export interface QuizQuestionAdmin {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  source: string;
}

export interface CertificateOut {
  kind: EduClassKind;
  completed: boolean;
  total: number;
  completed_count: number;
  pct: number;
  user_name: string;
  completed_at: string | null;
}

// ---------- Correos ----------

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  created_at: string | null;
}

export type EmailLogStatus = "preparado" | "enviado";

export interface EmailLog {
  id: number;
  contact_id: number | null;
  contact_name: string;
  contact_email: string;
  template_name: string;
  subject: string;
  body: string;
  status: EmailLogStatus;
  created_at: string | null;
}

// ---------- Mensajes de contacto (formulario público /contacto, 2026-11-25) ----------

/** Servicio del formulario público (contrato POST /api/contacto/mensajes). */
export type ContactoServicio = "camisetas" | "publicitario" | "marketing" | "otro";

/** Estado en la bandeja admin (GET/PATCH /api/contacto/mensajes). */
export type ContactoMensajeEstado = "nuevo" | "leído" | "respondido";

export interface ContactoMensaje {
  id: number;
  nombre: string;
  email: string;
  servicio: ContactoServicio;
  mensaje: string;
  estado: ContactoMensajeEstado;
  created_at: string | null;
}

export interface ContactoMensajeCreated {
  id: number;
  created_at: string | null;
}

// ---------- Facturas ----------

export interface InvoiceItem {
  description: string;
  qty: number;
  unit_price: number;
}

export type InvoiceStatus = "borrador" | "enviada" | "pagada";

export interface Invoice {
  id: number;
  number: string;
  client_name: string;
  /** Contacto del CRM asociado, cuando el backend lo envía (v1 no lo hace:
   * las facturas solo traen client_name y se casan por nombre). */
  contact_id?: number | null;
  client_email: string;
  client_phone: string;
  items: InvoiceItem[];
  tax_rate: number;
  status: InvoiceStatus;
  /** Estado de cobro DERIVADO del backend (Fase 5b, tarea 2): pagada,
   * vencida (enviada con fecha <= hoy) o pendiente. No es un estado
   * editable: se recalcula con la fecha de vencimiento. */
  estado_cobro: "pendiente" | "pagada" | "vencida";
  /** Fecha de vencimiento (Fase 4 mejoras-v1, tarea 7): AAAA-MM-DD o null. */
  due_date?: string | null;
  notes: string;
  created_at: string | null;
}

// ---------- Referidos (Grow Business Platform — módulo Referidos) ----------
// Las recompensas solo se REGISTRAN (pendiente/confirmada/recompensada):
// v1 no procesa pagos ni mueve dinero.

export type ReferralRewardType = "fixed" | "percentage";
export type ReferralCampaignStatus = "active" | "paused" | "ended";
export type ReferralStatus = "pending" | "confirmed" | "rewarded";

export interface ReferralCampaign {
  id: number;
  name: string;
  business_contact_id: number | null;
  business_name: string | null;
  share_code: string;
  reward_type: ReferralRewardType;
  reward_value: string;
  reward_note: string;
  status: ReferralCampaignStatus;
  referrals_count: number;
  confirmed_count: number;
  rewarded_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ReferralCampaignInput {
  name: string;
  business_contact_id?: number | null;
  reward_type?: ReferralRewardType;
  reward_value?: string;
  reward_note?: string;
  status?: ReferralCampaignStatus;
}

export interface Referral {
  id: number;
  campaign_id: number;
  referrer_name: string;
  referrer_contact: string;
  referred_name: string;
  referred_contact: string;
  code: string;
  status: ReferralStatus;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ReferralInput {
  referrer_name: string;
  referrer_contact?: string;
  referred_name: string;
  referred_contact?: string;
  code?: string;
  notes?: string;
}

// ---------- Business (Grow Business Platform — módulo Business) ----------
// Cada área (Marketing, Ventas, Legal, Administrativo) tiene sus PROPIAS
// notas y tareas: el backend las filtra por área y nunca las mezcla.

export type BusinessArea = "marketing" | "ventas" | "legal" | "administrativo";

export interface BusinessNote {
  id: number;
  area: BusinessArea;
  title: string;
  body: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface BusinessTask {
  id: number;
  area: BusinessArea;
  title: string;
  done: boolean;
  /** Fecha de vencimiento (Fase 4 mejoras-v1, tarea 7): AAAA-MM-DD o null. */
  due_date?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// Notificaciones en la app (Fase 5b mejoras-v1, tarea 5): tareas no
// hechas que vencen hoy o ya vencieron, en todas las áreas.
export interface BusinessNotificacionTarea {
  id: number;
  area: BusinessArea;
  title: string;
  due_date: string | null;
}

export interface BusinessNotificaciones {
  fecha: string;
  vencidas: BusinessNotificacionTarea[];
  de_hoy: BusinessNotificacionTarea[];
}

// ---------- Marketing + Citas (NEST, 2026-11-17) ----------
// Prefijo /api/business/marketing. Las horas son ISO UTC; el render usa
// America/Los_Angeles explícito (lib/dates.ts).

export type AppointmentStatus = "pendiente" | "confirmada" | "completada" | "cancelada";

export interface Appointment {
  id: number;
  contact_id: number | null;
  /** Nombre del cliente guardado al crear la cita (snapshot). */
  client_name: string;
  service_type: string;
  starts_at: string;
  duration_min: number;
  status: AppointmentStatus;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface AppointmentInput {
  contact_id?: number | null;
  client_name?: string;
  service_type: string;
  starts_at: string;
  duration_min?: number;
  notes?: string;
}

export interface AppointmentUpdate {
  service_type?: string;
  starts_at?: string;
  duration_min?: number;
  status?: AppointmentStatus;
  notes?: string;
}

export type MarketingChannel = "instagram" | "threads" | "facebook" | "google" | "otro";
export type MarketingCampaignStatus = "borrador" | "activa" | "pausada" | "finalizada";

export interface MarketingCampaign {
  id: number;
  name: string;
  channel: MarketingChannel;
  status: MarketingCampaignStatus;
  /** El backend devuelve números (float); el render usa formatMoney. */
  budget: string | number | null;
  spend: string | number;
  contact_id: number | null;
  /** El backend v1 no lo envía (no hay join con el CRM en la salida). */
  contact_name?: string | null;
  starts_on: string | null;
  ends_on: string | null;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface MarketingCampaignInput {
  name: string;
  channel?: MarketingChannel;
  status?: MarketingCampaignStatus;
  budget?: number | null;
  spend?: number;
  contact_id?: number | null;
  starts_on?: string | null;
  ends_on?: string | null;
  notes?: string;
}

// ---------- Nest Client Portal (NEST, 2026-11-17) ----------
// Solo endpoints /api/business/marketing/portal/*: el frontend del portal
// NUNCA importa crmApi/facturasApi/referidosApi.

export interface PortalContact {
  id: number;
  name: string;
  email: string;
  phone: string;
  status: string;
  tags: string[];
}

export interface PortalMeResponse {
  contact: PortalContact;
}

/** Campañas de referidos tal como las devuelve /portal/campanas
 * (forma reducida del backend: sin contadores ni fechas). */
export interface PortalReferralCampaign {
  id: number;
  name: string;
  share_code: string;
  status: string;
  reward_type: string;
  reward_value: string | number;
}

/** Campañas de marketing tal como las devuelve /portal/campanas. */
export interface PortalMarketingCampaign {
  id: number;
  name: string;
  channel: string;
  status: string;
  budget: string | number | null;
  spend: string | number;
  starts_on: string | null;
  ends_on: string | null;
}

export interface PortalCampaignsResponse {
  referidos: PortalReferralCampaign[];
  campanas: PortalMarketingCampaign[];
}

/** Factura tal como la devuelve /portal/facturas (forma reducida del
 * backend, con el total ya computado por el servidor). */
export interface PortalInvoice {
  id: number;
  number: string;
  contact_id: number | null;
  client_name: string;
  client_email: string;
  status: InvoiceStatus;
  total: string | number;
  created_at: string | null;
}

export interface PortalTaskItem {
  id: number;
  project_id: number | null;
  project_title: string | null;
  title: string;
  done: boolean;
  created_at: string | null;
}

export interface PortalTasksResponse {
  tasks: PortalTaskItem[];
  proximas_citas: Appointment[];
}

export interface PortalResumen {
  facturas: { por_estado: Record<string, number>; total_pagado: string | number };
  citas_proximas: number;
  campanas_activas: number;
  proyectos_activos: number;
}

/** Vínculo tal como lo devuelve GET /portal/vinculos: un contacto con su
 * user_id vinculado (o null). Sin username: el nombre de usuario se
 * resuelve en el cliente desde /api/users cuando hace falta. */
export interface PortalVinculo {
  id: number;
  name: string;
  email: string;
  user_id: number | null;
}

export interface PortalVinculoInput {
  user_id: number;
  contact_id: number;
}

/** Brief de marca tal como lo devuelven /portal/brief y
 * /contenido/briefs/{contact_id}: las 8 respuestas (vacías al inicio),
 * progreso X/8 y aviso de la Q2 (no son 3 palabras). */
export interface BrandBrief {
  contact_id: number;
  contact_name: string;
  answers: Record<string, string>;
  answered: number;
  missing: number[];
  q2_words: number;
  q2_warning: boolean;
  updated_at: string | null;
}

export type BrandBriefInput = Partial<
  Record<"q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7" | "q8", string>
>;

/** Progreso del brief por cliente (GET /contenido/briefs, solo admin). */
export interface BrandBriefSummary {
  contact_id: number;
  contact_name: string;
  answered: number;
  missing: number[];
  updated_at: string | null;
}

// ---------- Nest Content Engine (NEST, 2026-11-17) ----------

export type ContentIdeaSource = "manual" | "tendencia" | "cliente";
export type ContentIdeaStatus = "idea" | "en_produccion" | "descartada";

export interface ContentIdea {
  id: number;
  title: string;
  notes: string;
  source: ContentIdeaSource;
  status: ContentIdeaStatus;
  trend_note_id: number | null;
  contact_id: number | null;
  /** El backend v1 no lo envía (no hay join con el CRM en la salida). */
  contact_name?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ContentIdeaInput {
  title: string;
  notes?: string;
  source?: ContentIdeaSource;
  status?: ContentIdeaStatus;
  trend_note_id?: number | null;
  contact_id?: number | null;
}

export type ContentPlatform = "instagram" | "threads" | "facebook";

export interface ContentTemplate {
  id: number;
  name: string;
  platform: ContentPlatform;
  tone: string;
  /** Variables cerradas: {{tema}} {{negocio}} {{llamada}}. */
  body: string;
  max_chars: number;
  /** Etiqueta del backend: "Plantilla (reglas), no IA". */
  etiqueta?: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ContentTemplateInput {
  name: string;
  platform: ContentPlatform;
  tone?: string;
  body: string;
  max_chars?: number;
}

/** Generación por reglas desde plantilla: nunca llama al modelo de IA,
 * no persiste y no usa `demo`. Etiqueta obligatoria: "Plantilla (reglas),
 * no IA". */
export interface TemplateGeneration {
  text: string;
  source: "plantilla";
  template_id: number;
  platform: string;
  tone: string;
  truncated: boolean;
}

export type ContentItemStatus = "borrador" | "programado" | "publicado";

export interface ContentItem {
  id: number;
  title: string;
  text: string;
  scheduled_at: string;
  platform: ContentPlatform;
  status: ContentItemStatus;
  idea_id: number | null;
  copy_draft_id: number | null;
  template_id: number | null;
  contact_id: number | null;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ContentItemInput {
  title: string;
  text?: string;
  scheduled_at: string;
  platform?: ContentPlatform;
  status?: ContentItemStatus;
  idea_id?: number | null;
  copy_draft_id?: number | null;
  template_id?: number | null;
  contact_id?: number | null;
  notes?: string;
}

export interface ContentItemUpdate {
  title?: string;
  text?: string;
  scheduled_at?: string;
  platform?: ContentPlatform;
  status?: ContentItemStatus;
  notes?: string;
}

// ---------- Nest Business Intelligence (NEST, 2026-11-17) ----------
// Todo require_admin en el backend. Ventas = facturas PAGADAS; sin costos
// registrados, rentabilidad es null + costos_sin_datos: true.

export interface BiResumen {
  ventas: { total_pagado: string | number; total_enviado: string | number; n_facturas: number; por_estado: Record<string, number> };
  costos: { total: string | number; por_categoria: Record<string, string | number> };
  rentabilidad: string | number | null;
  costos_sin_datos: boolean;
  clientes: { total: number; nuevos_en_periodo: number; por_status: Record<string, number> };
  publicidad: { campanas_activas: number; gasto_total: string | number; referidos_activos: number };
}

export interface BiVentasPoint {
  mes: string;
  total_pagado: string | number;
  n_facturas: number;
}

export interface BiClientes {
  por_status: Record<string, number>;
  top_por_total_pagado: { contact_id: number; name: string; total_pagado: string | number }[];
}

export type BusinessCostCategory = "publicidad" | "herramientas" | "servicios" | "otro";

export interface BusinessCost {
  id: number;
  date: string;
  category: BusinessCostCategory;
  concept: string;
  /** El backend devuelve float; el render usa formatMoney. */
  amount: string | number;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface BusinessCostInput {
  date: string;
  category?: BusinessCostCategory;
  concept: string;
  amount: number;
  notes?: string;
}

export interface BusinessCostUpdate {
  date?: string;
  category?: BusinessCostCategory;
  concept?: string;
  amount?: number;
  notes?: string;
}

// ---------- Panel "Hoy" (Fase 4 mejoras-v1, tarea 7) ----------
// GET /api/dashboard/hoy. Una sección es [] cuando el perfil no tiene
// ese módulo (sin acceso) y null solo si esa sección falló.
export interface HoyTarea {
  id: number;
  area: string;
  title: string;
  due_date: string | null;
  href: string;
}

export interface HoyFactura {
  id: number;
  number: string;
  client_name: string;
  due_date: string | null;
  total: number;
  href: string;
}

export interface HoyStock {
  id: number;
  name: string;
  quantity: number;
  min_stock: number;
  href: string;
}

export interface HoyCita {
  id: number;
  client_name: string;
  service_type: string;
  starts_at: string;
  href: string;
}

// Recordatorio del CRM (Fase 5b mejoras-v1, tarea 1): no hecho, con
// fecha <= hoy. El detalle es la nota del recordatorio.
export interface HoyRecordatorio {
  id: number;
  contact_name: string;
  note: string;
  remind_date: string | null;
  href: string;
}

export interface HoyResponse {
  fecha: string;
  tareas: HoyTarea[] | null;
  facturas_vencidas: HoyFactura[] | null;
  facturas_por_vencer: HoyFactura[] | null;
  facturas_por_cobrar: HoyFactura[] | null;
  stock_bajo: HoyStock[] | null;
  citas: HoyCita[] | null;
  recordatorios: HoyRecordatorio[] | null;
}
