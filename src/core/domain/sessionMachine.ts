// Máquina de estados de la sesión de video (§5.2). Transiciones no permitidas
// lanzan un error de negocio (equivalente a HTTP 409).
import type { AlertStatus, SessionStatus } from "./types";

const TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  IDLE: ["PREPARING"],
  PREPARING: ["ACTIVE", "FAILED", "CANCELLED"],
  ACTIVE: ["PAUSED", "STOPPING", "FAILED"],
  PAUSED: ["ACTIVE", "STOPPING", "FAILED"],
  STOPPING: ["COMPLETED", "FAILED"],
  COMPLETED: ["PREPARING"],
  FAILED: ["PREPARING"],
  CANCELLED: ["PREPARING"],
};

export class TransitionError extends Error {
  constructor(public from: string, public to: string) {
    super(`Transición no permitida: ${from} → ${to}`);
  }
}

export function canTransition(from: SessionStatus, to: SessionStatus) {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionStatus, to: SessionStatus) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

export const SESSION_LABEL: Record<SessionStatus, string> = {
  IDLE: "Sin sesión",
  PREPARING: "Preparando",
  ACTIVE: "En vivo",
  PAUSED: "En pausa",
  STOPPING: "Finalizando",
  COMPLETED: "Finalizada",
  FAILED: "Error",
  CANCELLED: "Cancelada",
};

/** Alertas: NEW → IN_REVIEW → CLOSED; una alerta cerrada no se reabre (RN-11). */
const ALERT_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  NEW: ["IN_REVIEW", "CLOSED"],
  IN_REVIEW: ["CLOSED"],
  CLOSED: [],
};

export function canTransitionAlert(from: AlertStatus, to: AlertStatus) {
  return ALERT_TRANSITIONS[from].includes(to);
}

export const ALERT_LABEL: Record<AlertStatus, string> = { NEW: "Nueva", IN_REVIEW: "En revisión", CLOSED: "Cerrada" };
