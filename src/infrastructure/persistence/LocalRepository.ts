// Repositorio local DEMO (localStorage). En producción se sustituye por la API
// REST + PostgreSQL manteniendo esta misma interfaz de consultas/comandos.
import type {
  Alert, Analysis, AuditLog, ExportRecord, PersonRecord, Rule, Settings, User,
  VideoSession, VisionClass, VisionEvent, Zone,
} from "../../core/domain/types";
import { DEFAULT_CLASSES, DEFAULT_RULES, DEFAULT_SETTINGS, DEFAULT_USERS, DEFAULT_ZONES } from "./seed";

export interface DbState {
  version: number;
  users: User[];
  currentUserId?: string;
  analyses: Analysis[];
  sessions: VideoSession[];
  persons: PersonRecord[];
  events: VisionEvent[];
  alerts: Alert[];
  audit: AuditLog[];
  exports: ExportRecord[];
  classes: VisionClass[];
  rules: Rule[];
  zones: Zone[];
  settings: Settings;
}

const KEY = "aurora-ix:db:v1";
const LEGACY_KEY = "vision-ai:db:v1"; // nombre anterior del sistema: se migra al primer inicio
const LIMITS = { analyses: 300, sessions: 300, persons: 3000, events: 4000, alerts: 2000, audit: 4000, exports: 500 };

function initialState(): DbState {
  return {
    version: 1,
    users: DEFAULT_USERS,
    analyses: [],
    sessions: [],
    persons: [],
    events: [],
    alerts: [],
    audit: [],
    exports: [],
    classes: DEFAULT_CLASSES,
    rules: DEFAULT_RULES,
    zones: DEFAULT_ZONES,
    settings: DEFAULT_SETTINGS,
  };
}

function load(): DbState {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as DbState;
    const base = initialState();
    // Fusiona configuraciones nuevas sin perder datos existentes.
    return {
      ...base,
      ...parsed,
      rules: (parsed.rules ?? base.rules).map((r) => ({ ...r, scope: r.scope ?? (r.type === "ENTER_ZONE" || r.type === "DWELL_TIME" ? "live" : "both") })),
      settings: { ...base.settings, ...parsed.settings, notifications: { ...base.settings.notifications, ...parsed.settings?.notifications } },
    };
  } catch {
    return initialState();
  }
}

type Listener = () => void;

export class LocalRepository {
  private state: DbState = load();
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;
  public lastSaveError: string | undefined;

  getState = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Mutación inmutable + persistencia diferida. */
  update(mutator: (s: DbState) => Partial<DbState>) {
    const patch = mutator(this.state);
    this.state = { ...this.state, ...patch };
    this.enforceLimits();
    this.listeners.forEach((l) => l());
    this.scheduleSave();
  }

  private enforceLimits() {
    const s = this.state;
    for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      const arr = s[k] as unknown[];
      if (arr.length > LIMITS[k]) (s as unknown as Record<string, unknown[]>)[k] = arr.slice(0, LIMITS[k]);
    }
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 250);
  }

  flush() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
      this.lastSaveError = undefined;
    } catch (e) {
      // Cuota excedida: elimina miniaturas antiguas y reintenta una vez.
      this.state = {
        ...this.state,
        persons: this.state.persons.map((p, i) => (i > 200 ? { ...p, thumbnail: undefined } : p)),
        analyses: this.state.analyses.map((a, i) => (i > 30 ? { ...a, thumbnail: undefined } : a)),
        alerts: this.state.alerts.map((a, i) => (i > 100 ? { ...a, thumbnail: undefined } : a)),
      };
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
        this.lastSaveError = undefined;
      } catch {
        this.lastSaveError = `No se pudo guardar el historial local: ${(e as Error).message}`;
      }
    }
  }

  reset(keepConfig = true) {
    const base = initialState();
    this.state = keepConfig
      ? { ...base, users: this.state.users, currentUserId: this.state.currentUserId, rules: this.state.rules, zones: this.state.zones, classes: this.state.classes, settings: this.state.settings }
      : base;
    this.listeners.forEach((l) => l());
    this.flush();
  }
}

export const repo = new LocalRepository();
