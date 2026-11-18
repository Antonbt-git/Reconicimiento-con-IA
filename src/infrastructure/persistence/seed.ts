import type { Rule, Settings, User, VisionClass, Zone } from "../../core/domain/types";
import { API_URL } from "../../shared/env";

export const DEFAULT_USERS: User[] = [
  { id: "u-admin", name: "Administrador", email: "admin@auroraix.demo", role: "admin", status: "active" },
  { id: "u-oper", name: "Operador de análisis", email: "operador@auroraix.demo", role: "operator", status: "active" },
  { id: "u-sup", name: "Supervisor SST", email: "supervisor@auroraix.demo", role: "supervisor", status: "active" },
  { id: "u-aud", name: "Auditor", email: "auditor@auroraix.demo", role: "auditor", status: "active" },
];

export const DEFAULT_CLASSES: VisionClass[] = [
  { id: "person", name: "Persona", color: "#0ea5e9", description: "Persona en escena (sin identificación biométrica).", enabled: true },
  { id: "hardhat", name: "Casco", color: "#22c55e", description: "Casco de seguridad detectado.", enabled: true },
  { id: "no_hardhat", name: "Sin casco", color: "#ef4444", description: "Cabeza visible sin casco.", enabled: true },
  { id: "vest", name: "Chaleco", color: "#84cc16", description: "Chaleco reflectivo detectado.", enabled: true },
  { id: "no_vest", name: "Sin chaleco", color: "#f97316", description: "Torso visible sin chaleco reflectivo.", enabled: true },
  { id: "mask", name: "Mascarilla", color: "#14b8a6", description: "Mascarilla / respirador detectado.", enabled: true },
  { id: "no_mask", name: "Sin mascarilla", color: "#e11d48", description: "Rostro sin mascarilla.", enabled: true },
  { id: "cone", name: "Cono de seguridad", color: "#f59e0b", description: "Cono de señalización.", enabled: true },
  { id: "machinery", name: "Maquinaria", color: "#a855f7", description: "Maquinaria pesada.", enabled: true },
  { id: "vehicle", name: "Vehículo", color: "#6366f1", description: "Vehículo.", enabled: true },
  { id: "box", name: "Caja", color: "#d97706", description: "Caja de almacén (demo).", enabled: true },
  { id: "pallet", name: "Pallet", color: "#92400e", description: "Pallet (demo).", enabled: true },
  { id: "forklift", name: "Montacargas", color: "#eab308", description: "Montacargas (demo).", enabled: true },
  { id: "product", name: "Producto", color: "#3b82f6", description: "Producto en línea (demo).", enabled: true },
  { id: "label", name: "Etiqueta", color: "#06b6d4", description: "Etiqueta de producto (demo).", enabled: true },
  { id: "defect", name: "Defecto", color: "#dc2626", description: "Defecto superficial simulado (demo).", enabled: true },
  { id: "shelf", name: "Estante", color: "#64748b", description: "Estante (demo).", enabled: true },
];

export const DEFAULT_ZONES: Zone[] = [
  { id: "z-restricted", name: "Zona restringida", geometry: { x: 0.68, y: 0.45, width: 0.3, height: 0.53 }, enabled: true, color: "#ef4444" },
  { id: "z-loading", name: "Andén de carga", geometry: { x: 0.02, y: 0.55, width: 0.3, height: 0.43 }, enabled: false, color: "#f59e0b" },
];

export const DEFAULT_RULES: Rule[] = [
  {
    id: "r-epp-helmet-vest", code: "EPP_MISSING", name: "EPP incompleto (casco / chaleco)", type: "EPP_MISSING",
    threshold: 3000, ppeItems: ["helmet", "vest"], severity: "high", enabled: true, notify: true, dedupWindowMs: 120000, scope: "both",
  },
  {
    id: "r-zone-enter", code: "ZONE_ENTER", name: "Ingreso a zona restringida", type: "ENTER_ZONE", zoneId: "z-restricted",
    threshold: 0, severity: "medium", enabled: false, notify: true, dedupWindowMs: 60000, scope: "live",
  },
  {
    id: "r-dwell", code: "DWELL_TIME", name: "Permanencia prolongada en zona restringida", type: "DWELL_TIME", zoneId: "z-restricted",
    threshold: 20000, severity: "high", enabled: false, notify: true, dedupWindowMs: 120000, scope: "live",
  },
  {
    id: "r-count", code: "COUNT_THRESHOLD", name: "Aforo / congestión", type: "COUNT_THRESHOLD",
    threshold: 6, severity: "low", enabled: true, notify: false, dedupWindowMs: 120000, scope: "both",
  },
];

export const DEFAULT_SETTINGS: Settings = {
  confidenceThreshold: 0.4,
  reviewThreshold: 0.5,
  requiredPpe: ["helmet", "vest"],
  storeEvidence: false,
  liveInferenceFps: 4,
  liveSmoothingWindow: 8,
  defaultEngine: "onnx",
  apiBaseUrl: API_URL ?? "http://localhost:8000",
  notifications: {
    channel: API_URL ? "webhook" : "none",
    ntfyServer: "https://ntfy.sh",
    ntfyTopic: "",
    telegramToken: "",
    telegramChatId: "",
    webhookUrl: API_URL ? `${API_URL}/api/v1/notify` : "",
    minSeverity: "medium",
    attachEvidence: true,
    browserNotifications: true,
    maxPerMinute: 6,
  },
};
