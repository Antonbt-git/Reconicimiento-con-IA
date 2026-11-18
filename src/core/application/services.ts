// Capa de aplicación: casos de uso. Orquesta motor de visión, reglas, alertas,
// notificaciones y repositorio. No depende de React ni de componentes.
import { associatePpe, complianceLabel, PPE_LABEL } from "../domain/epp";
import { evaluateRules, type RuleHit } from "../domain/rules";
import { canTransitionAlert } from "../domain/sessionMachine";
import { intersection, area, footPoint, pointInBox } from "../domain/geometry";
import {
  isValidBox, SEVERITY_ORDER,
  type Alert, type AlertStatus, type Analysis, type AnalysisMode, type EngineMode, type PatternResult,
  type PersonPpe, type PersonRecord, type VisionEvent, type Zone,
} from "../domain/types";
import type { NotificationMessage, VisionEngine, VisionSource } from "../ports";
import { repo } from "../../infrastructure/persistence/LocalRepository";
import { browserNotify, dataUrlToBlob, makeNotifier } from "../../infrastructure/notify/notifiers";
import { annotatedFrame, canvasToBlob, cropToDataUrl, sanitize } from "../../shared/utils/image";
import { uid, uuid } from "../../shared/utils/id";
import { toast } from "../../shared/utils/bus";

// ------------------------------------------------------------ auditoría ---
export function currentUser() {
  const s = repo.getState();
  return s.users.find((u) => u.id === s.currentUserId);
}

export function audit(action: string, entityType: string, entityId: string, detail?: string, correlationId = uuid()) {
  repo.update((s) => ({
    audit: [
      { id: uid("aud"), actorId: s.currentUserId ?? "system", action, entityType, entityId, occurredAt: new Date().toISOString(), correlationId, detail },
      ...s.audit,
    ],
  }));
}

export function login(userId: string) {
  repo.update(() => ({ currentUserId: userId }));
  audit("LOGIN", "User", userId);
}

export function logout() {
  const id = repo.getState().currentUserId;
  if (id) audit("LOGOUT", "User", id);
  repo.update(() => ({ currentUserId: undefined }));
}

// ------------------------------------------------------- notificaciones ---
const sentTimes: number[] = [];

/** Envía la alerta al celular según la configuración (severidad mínima, límite por minuto). */
export async function notifyAlert(alert: Alert, image?: Blob): Promise<void> {
  const { settings, rules } = repo.getState();
  const ns = settings.notifications;
  const rule = rules.find((r) => r.id === alert.ruleId);
  const msg: NotificationMessage = {
    title: `AURORA IX · ${alert.ruleName}`,
    message: `${alert.message}\nSeveridad: ${alert.severity.toUpperCase()} · ${new Date(alert.createdAt).toLocaleString()}\nModo: ${alert.mode === "REAL" ? "Modelo real (requiere verificación humana)" : "SIMULACIÓN"}`,
    severity: alert.severity,
    tags: [alert.mode === "REAL" ? "rotating_light" : "test_tube", rule?.code ?? "alerta"],
    image: ns.attachEvidence ? image : undefined,
  };
  if (ns.browserNotifications) void browserNotify(msg);

  const setNotified = (notified: Alert["notified"], notifyDetail: string) =>
    repo.update((s) => ({ alerts: s.alerts.map((a) => (a.id === alert.id ? { ...a, notified, notifyDetail } : a)) }));

  const port = makeNotifier(ns);
  if (!port) return setNotified("skipped", "Canal de celular no configurado");
  if (rule && !rule.notify) return setNotified("skipped", "La regla no envía al celular");
  if (SEVERITY_ORDER[alert.severity] < SEVERITY_ORDER[ns.minSeverity]) return setNotified("skipped", "Severidad inferior al mínimo configurado");
  const now = Date.now();
  while (sentTimes.length && now - sentTimes[0] > 60000) sentTimes.shift();
  if (sentTimes.length >= ns.maxPerMinute) return setNotified("skipped", "Límite de envíos por minuto alcanzado");
  sentTimes.push(now);
  try {
    const r = await port.send(msg);
    setNotified(r.ok ? "sent" : "failed", r.detail);
    audit(r.ok ? "NOTIFY_SENT" : "NOTIFY_FAILED", "Alert", alert.id, `${port.channel}: ${r.detail}`);
    if (!r.ok) toast("warning", "No se pudo notificar al celular", r.detail);
  } catch (e) {
    const detail = `${port.channel}: ${(e as Error).message} (¿sin conexión o CORS?)`;
    setNotified("failed", detail);
    audit("NOTIFY_FAILED", "Alert", alert.id, detail);
    toast("warning", "No se pudo notificar al celular", detail);
  }
}

export async function sendTestNotification() {
  const ns = repo.getState().settings.notifications;
  const port = makeNotifier(ns);
  const msg: NotificationMessage = {
    title: "AURORA IX · Prueba de notificación",
    message: "Si ves este mensaje en tu celular, las alertas de EPP llegarán aquí.",
    severity: "medium",
    tags: ["white_check_mark"],
  };
  if (ns.browserNotifications) await browserNotify(msg);
  if (!port) return { ok: false, detail: "Seleccione un canal (ntfy, Telegram o webhook)." };
  try {
    const r = await port.send(msg);
    audit("NOTIFY_TEST", "Settings", "notifications", `${port.channel}: ${r.detail}`);
    return r;
  } catch (e) {
    return { ok: false, detail: `${(e as Error).message}. Verifique conexión, URL y CORS.` };
  }
}

// ---------------------------------------------------- eventos y alertas ---
export function raiseRuleHit(
  hit: RuleHit,
  scope: { sessionId?: string; analysisId?: string },
  mode: EngineMode,
  evidence?: { thumbnail?: string; image?: Blob },
): Alert {
  const now = new Date().toISOString();
  const event: VisionEvent = {
    id: uid("evt"),
    sessionId: scope.sessionId,
    analysisId: scope.analysisId,
    ruleId: hit.rule.id,
    type: hit.type,
    occurredAt: now,
    description: hit.description,
    dedupKey: hit.dedupKey,
    trackId: hit.subjectCode,
    mode,
  };
  const alert: Alert = {
    id: uid("alt"),
    eventId: event.id,
    analysisId: scope.analysisId,
    sessionId: scope.sessionId,
    ruleId: hit.rule.id,
    ruleName: hit.rule.name,
    severity: hit.rule.severity,
    message: hit.description,
    status: "NEW",
    createdAt: now,
    updatedAt: now,
    mode,
    personCode: hit.subjectCode,
    thumbnail: evidence?.thumbnail,
  };
  // Evento + alerta en la misma mutación (equivalente transaccional).
  repo.update((s) => ({ events: [event, ...s.events], alerts: [alert, ...s.alerts] }));
  toast(hit.rule.severity === "low" ? "info" : "warning", hit.rule.name, hit.description);
  void notifyAlert(alert, evidence?.image);
  return alert;
}

export function registerEvent(e: Omit<VisionEvent, "id" | "occurredAt" | "dedupKey"> & { dedupKey?: string }) {
  const ev: VisionEvent = { id: uid("evt"), occurredAt: new Date().toISOString(), dedupKey: e.dedupKey ?? uuid(), ...e };
  repo.update((s) => ({ events: [ev, ...s.events] }));
  return ev;
}

export function updateAlertStatus(id: string, to: AlertStatus, note?: string) {
  const s = repo.getState();
  const alert = s.alerts.find((a) => a.id === id);
  if (!alert) throw new Error("Alerta inexistente");
  if (alert.status === to) return alert; // idempotente
  if (!canTransitionAlert(alert.status, to)) throw new Error(`Transición no permitida: ${alert.status} → ${to}`);
  const user = currentUser();
  const updated: Alert = {
    ...alert,
    status: to,
    note: note ? sanitize(note, 500) : alert.note,
    updatedAt: new Date().toISOString(),
    reviewedBy: user?.name,
    assignedTo: alert.assignedTo ?? user?.name,
  };
  repo.update((st) => ({ alerts: st.alerts.map((a) => (a.id === id ? updated : a)) }));
  audit("ALERT_STATUS", "Alert", id, `${alert.status} → ${to}${note ? ` · ${sanitize(note, 80)}` : ""}`);
  return updated;
}

export function assignAlert(id: string, assignee: string) {
  repo.update((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, assignedTo: assignee, updatedAt: new Date().toISOString() } : a)) }));
  audit("ALERT_ASSIGN", "Alert", id, assignee);
}

// ------------------------------------------------------------- personas ---
export function personRecordFrom(p: PersonPpe, ctx: { origin: "image" | "live"; analysisId?: string; sessionId?: string; mode: EngineMode; thumbnail?: string; observations?: number }): PersonRecord {
  return {
    id: uid("per"),
    code: p.personId,
    origin: ctx.origin,
    analysisId: ctx.analysisId,
    sessionId: ctx.sessionId,
    mode: ctx.mode,
    observedAt: new Date().toISOString(),
    ppe: { helmet: p.ppe.helmet.state, vest: p.ppe.vest.state, mask: p.ppe.mask.state },
    ppeConfidence: { helmet: p.ppe.helmet.confidence, vest: p.ppe.vest.confidence, mask: p.ppe.mask.confidence },
    compliance: p.compliance,
    missing: p.missing,
    reviewStatus: "pending",
    thumbnail: ctx.thumbnail,
    observations: ctx.observations,
  };
}

export function savePersons(records: PersonRecord[]) {
  if (!records.length) return;
  repo.update((s) => ({ persons: [...records, ...s.persons] }));
  audit("PERSONS_REGISTERED", "PersonRecord", records.map((r) => r.code).join(","), `${records.length} registro(s)`);
}

export function updatePerson(id: string, patch: Partial<Pick<PersonRecord, "workerName" | "area" | "reviewStatus" | "compliance" | "ppe" | "missing">>) {
  const user = currentUser();
  const clean = { ...patch };
  if (clean.workerName !== undefined) clean.workerName = sanitize(clean.workerName, 80);
  if (clean.area !== undefined) clean.area = sanitize(clean.area, 60);
  repo.update((s) => ({ persons: s.persons.map((p) => (p.id === id ? { ...p, ...clean, reviewedBy: user?.name } : p)) }));
  audit("PERSON_UPDATED", "PersonRecord", id, Object.keys(patch).join(","));
}

// ------------------------------------------------------ patrones (imagen) ---
export function buildPatterns(analysis: Pick<Analysis, "detections" | "persons">, threshold: number, zones: Zone[] = []): PatternResult[] {
  const out: PatternResult[] = [];
  // Patrón informativo de zona (la alerta depende de la regla y su ámbito).
  for (const z of zones.filter((x) => x.enabled)) {
    const inside = analysis.persons.filter((p) => {
      const { px, py } = footPoint(p.box);
      return pointInBox(px, py, z.geometry);
    });
    if (inside.length)
      out.push({ id: uid("pat"), type: "ZONE_INTRUSION", label: `${inside.length} persona(s) en «${z.name}»`, confidence: Math.max(...inside.map((p) => p.confidence)), evidence: inside.map((p) => p.personId).join(", "), status: "review" });
  }
  for (const p of analysis.persons) {
    const evidence = (["helmet", "vest", "mask"] as const)
      .filter((k) => p.ppe[k].state !== "unknown")
      .map((k) => `${PPE_LABEL[k]}: ${p.ppe[k].state === "present" ? "sí" : p.ppe[k].state === "absent" ? "no" : "incierto"} (${Math.round(p.ppe[k].confidence * 100)}%)`)
      .join(" · ");
    out.push({
      id: uid("pat"),
      type: p.compliance === "compliant" ? "EPP_COMPLETE" : p.compliance === "non_compliant" ? "EPP_INCOMPLETE" : "EPP_REVIEW",
      label: `${p.personId}${p.inferred ? " (inferida)" : ""}: ${complianceLabel(p.compliance)}`,
      confidence: p.confidence,
      evidence: evidence || "Sin evidencia de EPP en la imagen",
      status: p.compliance === "compliant" ? "detected" : "review",
      personId: p.personId,
    });
  }
  const visible = analysis.detections.filter((d) => d.confidence >= threshold);
  const products = visible.filter((d) => d.classId === "product");
  const defects = visible.filter((d) => d.classId === "defect");
  products.forEach((pr, i) => {
    const bad = defects.find((df) => intersection(df.box, pr.box) / Math.max(1e-6, area(df.box)) > 0.5);
    out.push({
      id: uid("pat"),
      type: bad ? "DEFECT" : "QUALITY_OK",
      label: `Producto ${i + 1}: ${bad ? "No conforme" : "Conforme"}`,
      confidence: bad ? bad.confidence : pr.confidence,
      evidence: bad ? `Defecto superficial (${Math.round(bad.confidence * 100)}%) dentro del producto` : "Sin defectos detectados",
      status: bad ? "review" : "detected",
    });
  });
  const low = analysis.detections.filter((d) => d.confidence < threshold).length;
  if (low) out.push({ id: uid("pat"), type: "LOW_CONFIDENCE", label: `${low} detección(es) bajo el umbral`, confidence: threshold, evidence: "Ocultas en el visor; conservadas en el registro bruto.", status: "review" });
  return out;
}

// -------------------------------------------------- caso de uso: imagen ---
export interface AnalyzeImageInput {
  engine: VisionEngine;
  source: VisionSource;
  width: number;
  height: number;
  sourceName: string;
  scenarioId?: string;
  mode: AnalysisMode;
  onProgress?: (stage: string, pct: number) => void;
}

export async function analyzeImage(input: AnalyzeImageInput): Promise<Analysis> {
  const st = repo.getState();
  const { settings } = st;
  const user = currentUser();
  const correlationId = uuid();
  const analysis: Analysis = {
    id: uid("anl"),
    createdAt: new Date().toISOString(),
    createdBy: user?.name ?? "anónimo",
    sourceName: sanitize(input.sourceName, 100),
    scenarioId: input.scenarioId,
    mode: input.mode,
    engineMode: input.engine.mode,
    engineName: input.engine.name,
    status: "processing",
    durationMs: 0,
    averageConfidence: 0,
    threshold: settings.confidenceThreshold,
    detections: [],
    masks: [],
    patterns: [],
    persons: [],
    alertIds: [],
  };
  repo.update((s) => ({ analyses: [analysis, ...s.analyses] }));
  audit("ANALYSIS_STARTED", "Analysis", analysis.id, `${input.engine.mode} · ${input.mode}`, correlationId);

  const save = (patch: Partial<Analysis>) => {
    Object.assign(analysis, patch);
    repo.update((s) => ({ analyses: s.analyses.map((a) => (a.id === analysis.id ? { ...analysis } : a)) }));
  };

  try {
    input.onProgress?.("Validando entrada…", 8);
    let pct = 15;
    const result = await input.engine.analyze(
      { source: input.source, width: input.width, height: input.height, mode: input.mode, scenarioId: input.scenarioId },
      (stage) => {
        pct = Math.min(85, pct + 15);
        input.onProgress?.(stage, pct);
      },
    );
    input.onProgress?.("Aplicando umbrales y reglas…", 90);
    // RN-08 / TC-13: descartar cajas inválidas antes de renderizar.
    const detections = result.detections.filter((d) => isValidBox(d.box));
    const rejected = result.detections.length - detections.length;
    const masks = result.masks.filter((m) => isValidBox(m.box));
    const persons =
      input.mode === "segmentation"
        ? []
        : associatePpe(detections, { minConfidence: settings.confidenceThreshold, reviewThreshold: settings.reviewThreshold, requiredPpe: settings.requiredPpe });
    const visible = detections.filter((d) => d.confidence >= settings.confidenceThreshold);
    const avg = visible.length ? visible.reduce((a, d) => a + d.confidence, 0) / visible.length : 0;
    const patterns = input.mode === "detection" ? [] : buildPatterns({ detections, persons }, settings.confidenceThreshold, st.zones);
    if (rejected) patterns.push({ id: uid("pat"), type: "INVALID_PAYLOAD", label: `${rejected} caja(s) inválida(s) descartada(s)`, confidence: 1, evidence: "Coordenadas fuera de 0..1", status: "review" });

    const thumb = input.width && input.height ? cropToDataUrl(input.source, { x: 0, y: 0, width: 1, height: 1 }, input.width, input.height, 220, 0.7) : undefined;
    save({
      detections,
      masks,
      persons,
      patterns,
      durationMs: result.durationMs,
      averageConfidence: Math.round(avg * 1000) / 1000,
      status: "completed",
      thumbnail: settings.storeEvidence ? thumb : undefined,
    });

    // Reglas (no temporales para imágenes) → eventos + alertas
    const hits = evaluateRules({
      scopeId: analysis.id,
      rules: st.rules,
      zones: st.zones,
      subjects: persons.map((p) => ({ code: p.personId, box: p.box, compliance: p.compliance, missing: p.missing })),
      now: Date.now(),
      temporal: false,
    });
    const alertIds: string[] = [];
    for (const hit of hits.filter((h) => h.rule.type !== "DWELL_TIME")) {
      const frame = annotatedFrame(
        input.source,
        input.width,
        input.height,
        hit.box ? [{ box: hit.box, color: "#ef4444", label: hit.subjectCode ?? hit.rule.name }] : [],
      );
      const image = await canvasToBlob(frame, 0.8).catch(() => undefined);
      const a = raiseRuleHit(hit, { analysisId: analysis.id }, result.mode, {
        image,
        thumbnail: settings.storeEvidence ? frame.toDataURL("image/jpeg", 0.6) : undefined,
      });
      alertIds.push(a.id);
    }
    save({ alertIds });
    registerEvent({ type: "ANALYSIS_COMPLETED", analysisId: analysis.id, description: `${visible.length} detecciones · ${persons.length} personas`, mode: result.mode });
    audit("ANALYSIS_COMPLETED", "Analysis", analysis.id, `${detections.length} detecciones brutas`, correlationId);
    input.onProgress?.("Completado", 100);
    return { ...analysis };
  } catch (e) {
    save({ status: "failed", error: (e as Error).message });
    audit("ANALYSIS_FAILED", "Analysis", analysis.id, (e as Error).message, correlationId);
    throw e;
  }
}

/** Registra en el padrón las personas de un análisis (con miniatura si está permitido). */
export function registerAnalysisPersons(analysis: Analysis, source?: VisionSource, w = 0, h = 0, withThumb = false) {
  const existing = new Set(repo.getState().persons.filter((p) => p.analysisId === analysis.id).map((p) => p.code));
  const recs = analysis.persons
    .filter((p) => !existing.has(p.personId))
    .map((p) =>
      personRecordFrom(p, {
        origin: "image",
        analysisId: analysis.id,
        mode: analysis.engineMode,
        thumbnail: withThumb && source && w ? cropToDataUrl(source, p.box, w, h) : undefined,
      }),
    );
  savePersons(recs);
  return recs.length;
}

export function thumbnailBlob(dataUrl?: string) {
  return dataUrl ? dataUrlToBlob(dataUrl) : undefined;
}

// --------------------------------------------------------- exportación ---
export function recordExport(entity: string, filters: string, rows: number) {
  const user = currentUser();
  const rec = { id: uid("exp"), requestedBy: user?.name ?? "anónimo", format: "csv" as const, entity, filters, createdAt: new Date().toISOString(), rows };
  repo.update((s) => ({ exports: [rec, ...s.exports] }));
  audit("EXPORT", entity, rec.id, `${rows} filas · ${filters}`);
}
