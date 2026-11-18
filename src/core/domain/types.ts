// ============================================================================
// AURORA IX · Dominio
// Entidades y contratos independientes de React, MediaDevices o del backend.
// Todas las coordenadas son relativas normalizadas (0..1) — RN-08.
// Las confianzas se guardan 0..1 y se muestran como porcentaje.
// ============================================================================

/** Modo del motor. Debe ser visible siempre (RN-06). */
export type EngineMode = "SIMULATED" | "REAL";

export type AnalysisMode = "detection" | "segmentation" | "patterns" | "combined";
export type AnalysisStatus = "queued" | "processing" | "completed" | "failed";

export type Role = "admin" | "operator" | "supervisor" | "auditor";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "inactive";
}

export interface BoundingBox {
  x: number; // esquina superior izquierda, 0..1
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  label: string;
  classId: string;
  confidence: number; // 0..1
  box: BoundingBox;
  trackId?: string;
}

export interface SegmentationResult {
  id: string;
  classId: string;
  label: string;
  confidence: number;
  box: BoundingBox;
  areaRatio: number; // fracción de la imagen cubierta por la máscara
  /** Polígono normalizado (escenarios demo). */
  polygon?: [number, number][];
  /** Mapa de bits recortado a la caja, codificado RLE (modelo real). */
  bitmap?: { w: number; h: number; rle: string };
}

export interface PatternResult {
  id: string;
  type: string; // EPP_COMPLETE, EPP_INCOMPLETE, ZONE_INTRUSION, CONGESTION, DEFECT...
  label: string;
  confidence: number;
  evidence: string;
  status: "detected" | "review" | "confirmed" | "dismissed";
  personId?: string;
}

// ---------------------------------------------------------------- EPP ---
export type PpeItem = "helmet" | "vest" | "mask";
/** present = se observa el EPP · absent = el modelo indica explícitamente que falta
 *  · uncertain = observación con confianza baja · unknown = no hay evidencia */
export type PpeState = "present" | "absent" | "uncertain" | "unknown";
/** CUMPLE · INCOMPLETO · REVISAR (no se afirma incumplimiento sin evidencia, §7.2) */
export type Compliance = "compliant" | "non_compliant" | "review";

export interface PpeObservation {
  state: PpeState;
  confidence: number; // confianza de la evidencia usada (0 si unknown)
  evidenceId?: string; // id de la detección usada como evidencia
}

export interface PersonPpe {
  personId: string; // P-001 (imagen) o TRK-001 (en vivo)
  box: BoundingBox;
  confidence: number;
  inferred: boolean; // persona deducida desde un EPP sin caja de persona
  ppe: Record<PpeItem, PpeObservation>;
  compliance: Compliance;
  missing: PpeItem[];
}

/** Registro persistente de una persona observada (no es identidad biométrica). */
export interface PersonRecord {
  id: string;
  code: string; // P-001 / TRK-001
  origin: "image" | "live";
  analysisId?: string;
  sessionId?: string;
  mode: EngineMode;
  observedAt: string;
  ppe: Record<PpeItem, PpeState>;
  ppeConfidence: Record<PpeItem, number>;
  compliance: Compliance;
  missing: PpeItem[];
  /** Datos ingresados manualmente por el operador (opcional). */
  workerName?: string;
  area?: string;
  reviewStatus: "pending" | "confirmed" | "corrected";
  reviewedBy?: string;
  thumbnail?: string; // dataURL JPEG pequeño — solo si "guardar evidencia" está activo
  observations?: number; // n.º de fotogramas observados (en vivo)
}

// ---------------------------------------------------------- Análisis ---
export interface Analysis {
  id: string;
  createdAt: string;
  createdBy: string;
  sourceName: string;
  scenarioId?: string;
  mode: AnalysisMode;
  engineMode: EngineMode;
  engineName: string;
  status: AnalysisStatus;
  durationMs: number;
  averageConfidence: number;
  threshold: number;
  detections: Detection[]; // registro bruto completo (no se borran bajo umbral)
  masks: SegmentationResult[];
  patterns: PatternResult[];
  persons: PersonPpe[];
  alertIds: string[];
  error?: string;
  thumbnail?: string;
}

// ----------------------------------------------------------- Sesiones ---
export type SessionStatus =
  | "IDLE"
  | "PREPARING"
  | "ACTIVE"
  | "PAUSED"
  | "STOPPING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type SourceType = "camera" | "simulator";

export interface VideoSource {
  id: string;
  name: string;
  type: SourceType;
  deviceRef?: string;
  enabled: boolean;
}

export interface VideoSession {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  operatorId: string;
  engineMode: EngineMode;
  engineName: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  pausedMs: number;
  durationMs: number;
  counters: { detections: number; tracks: number; events: number; alerts: number; frames: number };
  compliance: { compliant: number; non_compliant: number; review: number };
  error?: string;
}

export type TrackStatus = "ACTIVE" | "LOST" | "FINISHED";

export interface Track {
  id: string; // TRK-001
  sessionId: string;
  box: BoundingBox;
  firstSeenAt: number;
  lastSeenAt: number;
  hits: number;
  misses: number;
  status: TrackStatus;
  confidence: number;
}

// ------------------------------------------------- Zonas, reglas, eventos ---
export interface Zone {
  id: string;
  name: string;
  geometry: BoundingBox; // rectángulo normalizado (decisión v1)
  enabled: boolean;
  color: string;
}

export type RuleType = "EPP_MISSING" | "ENTER_ZONE" | "DWELL_TIME" | "COUNT_THRESHOLD";
export type Severity = "low" | "medium" | "high" | "critical";

export interface Rule {
  id: string;
  code: string;
  name: string;
  type: RuleType;
  zoneId?: string;
  /** EPP_MISSING: ms que debe persistir la falta en vivo · DWELL_TIME: ms · COUNT_THRESHOLD: n.º personas */
  threshold: number;
  ppeItems?: PpeItem[]; // EPP_MISSING
  severity: Severity;
  enabled: boolean;
  notify: boolean; // enviar al celular
  dedupWindowMs: number;
  /** Dónde se evalúa: las zonas dependen del encuadre de la cámara → por defecto solo en vivo. */
  scope: "live" | "image" | "both";
}

export type EventType =
  | "SESSION_STARTED"
  | "SESSION_PAUSED"
  | "SESSION_RESUMED"
  | "SESSION_COMPLETED"
  | "SESSION_FAILED"
  | "EPP_MISSING"
  | "ZONE_ENTERED"
  | "DWELL_THRESHOLD_REACHED"
  | "COUNT_THRESHOLD_REACHED"
  | "ANALYSIS_COMPLETED";

export interface VisionEvent {
  id: string;
  sessionId?: string;
  analysisId?: string;
  ruleId?: string;
  type: EventType;
  occurredAt: string;
  description: string;
  dedupKey: string;
  trackId?: string;
  mode: EngineMode;
}

export type AlertStatus = "NEW" | "IN_REVIEW" | "CLOSED";

export interface Alert {
  id: string;
  eventId: string;
  analysisId?: string;
  sessionId?: string;
  ruleId: string;
  ruleName: string;
  severity: Severity;
  message: string;
  status: AlertStatus;
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
  reviewedBy?: string;
  note?: string;
  mode: EngineMode;
  personCode?: string;
  thumbnail?: string;
  notified?: "sent" | "failed" | "skipped";
  notifyDetail?: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  correlationId: string;
  detail?: string;
}

export interface VisionClass {
  id: string;
  name: string;
  color: string;
  description: string;
  enabled: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Resultados semilla (deterministas) del escenario. */
  expected: { detections: Detection[]; masks: SegmentationResult[] };
}

export interface ExportRecord {
  id: string;
  requestedBy: string;
  format: "csv";
  entity: string;
  filters: string;
  createdAt: string;
  rows: number;
}

// ------------------------------------------------------- Configuración ---
export type NotifyChannel = "none" | "ntfy" | "telegram" | "webhook";

export interface NotificationSettings {
  channel: NotifyChannel;
  ntfyServer: string;
  ntfyTopic: string;
  telegramToken: string;
  telegramChatId: string;
  webhookUrl: string;
  minSeverity: Severity;
  attachEvidence: boolean;
  browserNotifications: boolean;
  maxPerMinute: number;
}

export interface Settings {
  confidenceThreshold: number; // umbral de visualización
  reviewThreshold: number; // por debajo: "requiere revisión"
  requiredPpe: PpeItem[];
  storeEvidence: boolean; // RN-13: desactivado por defecto
  liveInferenceFps: number;
  liveSmoothingWindow: number;
  defaultEngine: "onnx" | "demo" | "api";
  apiBaseUrl: string;
  notifications: NotificationSettings;
}

/** Validación RN-08 / TC-13. */
export function isValidBox(b: BoundingBox): boolean {
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  return ok(b.x) && ok(b.y) && b.width > 0 && b.height > 0 && b.x + b.width <= 1.0001 && b.y + b.height <= 1.0001;
}

export const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
