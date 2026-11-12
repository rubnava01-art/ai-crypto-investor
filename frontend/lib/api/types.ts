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
  // Perfil editable (paquete 2026-10-28): vacíos hasta que el usuario
  // los llene — nunca se inventan.
  display_name: string | null;
  email: string | null;
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
}

export interface UserProfileInput {
  display_name?: string;
  email?: string;
  address?: string;
  avatar_data_url?: string;
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

export interface CrmContact {
  id: number;
  name: string;
  email: string;
  phone: string;
  source: CrmSource;
  tags: string[];
  status: CrmStatus;
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
  notes?: string;
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
  created_at: string | null;
  updated_at: string | null;
}
