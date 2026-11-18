// Casos de uso de streaming (§6.1–6.8): StartSession, PauseSession,
// ResumeSession, StopSession y RunSimulation/RunInference. Vive fuera de React
// para que la sesión continúe al navegar entre módulos; el visor solo se
// "engancha" para dibujar.
import { associatePpe } from "../../core/domain/epp";
import { Deduplicator, evaluateRules } from "../../core/domain/rules";
import { assertTransition } from "../../core/domain/sessionMachine";
import { PersonTracker, type TrackedPerson } from "../../core/domain/tracker";
import { isValidBox, type Detection, type EngineMode, type SessionStatus, type VideoSession, type VideoSource } from "../../core/domain/types";
import type { VisionEngine } from "../../core/ports";
import { audit, currentUser, personRecordFrom, raiseRuleHit, registerEvent, savePersons } from "../../core/application/services";
import { repo } from "../../infrastructure/persistence/LocalRepository";
import { LiveSimulator } from "../scenarios/data/liveSimulator";
import { demoEngine } from "../../app/engines";
import { annotatedFrame, canvasToBlob, cropToDataUrl } from "../../shared/utils/image";
import { uid } from "../../shared/utils/id";
import { toast } from "../../shared/utils/bus";

export interface LiveSnapshot {
  status: SessionStatus;
  session?: VideoSession;
  source?: VideoSource;
  engine?: VisionEngine;
  tracks: TrackedPerson[];
  detections: Detection[];
  lastInferenceMs: number;
  fps: number;
  error?: string;
  modelLoading?: string;
}

export const SIMULATOR_SOURCE: VideoSource = { id: "src-simulator", name: "Simulador de obra (video sintético)", type: "simulator", enabled: true };

/** Traduce errores de MediaDevices a mensajes accionables (§6.1 paso 5). */
export function cameraErrorMessage(e: unknown): string {
  const name = (e as DOMException)?.name;
  switch (name) {
    case "NotAllowedError":
      return "Permiso de cámara denegado. Habilítelo desde el ícono de candado de la barra de direcciones y vuelva a intentar, o use el simulador.";
    case "NotFoundError":
      return "No se encontró ninguna cámara conectada.";
    case "NotReadableError":
      return "La cámara está siendo usada por otra aplicación. Ciérrela y reintente.";
    case "OverconstrainedError":
      return "La cámara no soporta la resolución solicitada.";
    case "SecurityError":
      return "El navegador bloqueó la cámara: se requiere HTTPS o localhost.";
    default:
      return `No se pudo acceder a la cámara: ${(e as Error)?.message ?? e}`;
  }
}

export async function listVideoSources(): Promise<VideoSource[]> {
  const out: VideoSource[] = [];
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices();
    devices
      ?.filter((d) => d.kind === "videoinput")
      .forEach((d, i) => out.push({ id: `cam-${i}`, name: d.label || `Cámara ${i + 1}`, type: "camera", deviceRef: d.deviceId, enabled: true }));
  } catch {
    /* sin MediaDevices */
  }
  if (!out.length && typeof navigator.mediaDevices?.getUserMedia === "function") out.push({ id: "cam-default", name: "Cámara predeterminada", type: "camera", enabled: true });
  out.push(SIMULATOR_SOURCE);
  return out;
}

class LiveSessionController {
  readonly video: HTMLVideoElement;
  private stream?: MediaStream;
  private simulator?: LiveSimulator;
  private tracker?: PersonTracker;
  private dedup = new Deduplicator();
  private timer?: number;
  private running = false;
  private pausedAt?: number;
  private lastPersist = 0;
  private inferTimes: number[] = [];
  private registered = new Map<string, string>(); // trackId → personRecordId
  private thumbs = new Map<string, string>();
  private listeners = new Set<() => void>();
  private snap: LiveSnapshot = { status: "IDLE", tracks: [], detections: [], lastInferenceMs: 0, fps: 0 };

  constructor() {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;
  private emit(patch: Partial<LiveSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  get mode(): EngineMode | undefined {
    return this.snap.engine?.mode;
  }

  private setStatus(to: SessionStatus, extra: Partial<VideoSession> = {}) {
    assertTransition(this.snap.status, to);
    const session = this.snap.session ? { ...this.snap.session, status: to, ...extra } : undefined;
    if (session) repo.update((s) => ({ sessions: s.sessions.map((x) => (x.id === session.id ? session : x)) }));
    this.emit({ status: to, session });
  }

  // ------------------------------------------------------------- inicio ---
  async start(source: VideoSource, engine: VisionEngine) {
    // RN-04: una sesión activa por operador.
    if (["PREPARING", "ACTIVE", "PAUSED", "STOPPING"].includes(this.snap.status)) {
      throw new Error("Ya existe una sesión activa. Finalícela antes de iniciar otra (RN-04/RN-05).");
    }
    const user = currentUser();
    if (!user || user.role === "auditor") throw new Error("Su rol no permite operar sesiones de video.");
    if (source.type === "camera" && engine.mode === "SIMULATED") {
      throw new Error("El motor de demostración solo funciona con la fuente simulada. Para la cámara use el modelo EPP real.");
    }
    const { settings } = repo.getState();
    const session: VideoSession = {
      id: uid("ses"),
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      operatorId: user.id,
      engineMode: engine.mode,
      engineName: engine.name,
      status: "PREPARING",
      startedAt: new Date().toISOString(),
      pausedMs: 0,
      durationMs: 0,
      counters: { detections: 0, tracks: 0, events: 0, alerts: 0, frames: 0 },
      compliance: { compliant: 0, non_compliant: 0, review: 0 },
    };
    if (this.snap.status !== "IDLE") this.snap = { ...this.snap, status: "IDLE" };
    repo.update((s) => ({ sessions: [session, ...s.sessions] }));
    this.registered.clear();
    this.thumbs.clear();
    this.dedup = new Deduplicator();
    this.emit({ status: "PREPARING", session, source, engine, tracks: [], detections: [], error: undefined });

    try {
      // Modelo primero (si falla no se abre la cámara).
      if (!engine.isReady()) {
        this.emit({ modelLoading: "Cargando modelo…" });
        await engine.load((s) => this.emit({ modelLoading: s }));
        this.emit({ modelLoading: undefined });
      }
      if (source.type === "camera") {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("API de cámara no disponible"), { name: "SecurityError" });
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: source.deviceRef ? { deviceId: { exact: source.deviceRef }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" },
          audio: false,
        });
      } else {
        this.simulator = new LiveSimulator();
        this.stream = this.simulator.startStream();
        demoEngine.simulator = this.simulator;
      }
      const track = this.stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") throw new Error("La fuente no entregó video.");
      track.addEventListener("ended", this.onTrackEnded);
      this.video.srcObject = this.stream;
      await new Promise<void>((res, rej) => {
        const t = setTimeout(() => rej(new Error("La fuente no respondió (tiempo agotado).")), 8000);
        this.video.onloadedmetadata = () => {
          clearTimeout(t);
          res();
        };
      });
      await this.video.play();
      this.tracker = new PersonTracker({
        sessionId: session.id,
        iouThreshold: 0.25,
        maxMisses: Math.max(4, settings.liveInferenceFps * 2),
        window: settings.liveSmoothingWindow,
        requiredPpe: settings.requiredPpe,
      });
      this.setStatus("ACTIVE");
      registerEvent({ type: "SESSION_STARTED", sessionId: session.id, description: `Fuente: ${source.name}`, mode: engine.mode });
      audit("SESSION_STARTED", "VideoSession", session.id, `${source.type} · ${engine.mode}`);
      this.running = true;
      this.loop();
    } catch (e) {
      const msg = source.type === "camera" ? cameraErrorMessage(e) : (e as Error).message;
      this.cleanup();
      this.emit({ modelLoading: undefined, error: msg });
      // TC-03: con permiso denegado no queda sesión activa.
      this.setStatus("FAILED", { error: msg, endedAt: new Date().toISOString() });
      audit("SESSION_FAILED", "VideoSession", session.id, msg);
      throw new Error(msg);
    }
  }

  private onTrackEnded = () => {
    if (this.snap.status === "ACTIVE" || this.snap.status === "PAUSED") {
      void this.fail("La cámara se desconectó durante la sesión (TC-11).");
    }
  };

  // -------------------------------------------------- bucle de inferencia ---
  private loop = async () => {
    if (!this.running) return;
    const { settings } = repo.getState();
    const interval = 1000 / Math.max(0.5, settings.liveInferenceFps);
    const t0 = performance.now();
    if (this.snap.status === "ACTIVE" && this.video.readyState >= 2 && this.snap.engine) {
      try {
        await this.step(this.snap.engine);
      } catch (e) {
        console.warn("[AURORA IX] fallo de inferencia", e);
      }
    }
    if (!this.running) return;
    const elapsed = performance.now() - t0;
    this.timer = window.setTimeout(this.loop, Math.max(10, interval - elapsed));
  };

  private async step(engine: VisionEngine) {
    const { settings, rules, zones } = repo.getState();
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return;
    const res = await engine.analyze({ source: this.video, width: w, height: h, mode: "detection", live: true });
    if (!this.running || this.snap.status !== "ACTIVE") return;
    // Validar esquema/coordenadas de cada actualización (RN-08).
    const detections = res.detections.filter((d) => isValidBox(d.box) && d.confidence >= 0 && d.confidence <= 1);
    const persons = associatePpe(detections, { minConfidence: settings.confidenceThreshold, reviewThreshold: settings.reviewThreshold, requiredPpe: settings.requiredPpe, codePrefix: "tmp-" });
    const now = Date.now();
    const active = this.tracker!.update(persons, now);

    // Miniaturas para el registro (solo si la política lo permite — RN-13).
    if (settings.storeEvidence) {
      for (const t of active) if (!this.thumbs.has(t.track.id) || t.track.hits % 10 === 0) this.thumbs.set(t.track.id, cropToDataUrl(this.video, t.track.box, w, h, 140, 0.7));
    }

    // Reglas temporales + deduplicación (TC-08, TC-14)
    const hits = evaluateRules({
      scopeId: this.snap.session!.id,
      rules,
      zones,
      subjects: active.map((t) => ({ code: t.track.id, box: t.track.box, compliance: t.compliance, missing: t.missing, nonCompliantSince: t.nonCompliantSince, zoneEnteredAt: t.zoneEnteredAt })),
      now,
      temporal: true,
    });
    let newAlerts = 0;
    for (const hit of hits) {
      if (!this.dedup.shouldEmit(hit, now)) continue;
      const frame = annotatedFrame(this.video, w, h, hit.box ? [{ box: hit.box, color: "#ef4444", label: hit.subjectCode ?? hit.rule.name }] : []);
      const image = await canvasToBlob(frame, 0.8).catch(() => undefined);
      raiseRuleHit(hit, { sessionId: this.snap.session!.id }, engine.mode, {
        image,
        thumbnail: settings.storeEvidence ? frame.toDataURL("image/jpeg", 0.55) : undefined,
      });
      newAlerts++;
    }

    this.inferTimes.push(performance.now());
    while (this.inferTimes.length > 10) this.inferTimes.shift();
    const span = (this.inferTimes[this.inferTimes.length - 1] - this.inferTimes[0]) / 1000;
    const fps = span > 0 ? (this.inferTimes.length - 1) / span : 0;

    const s = this.snap.session!;
    const all = this.tracker!.all().filter((t) => t.track.hits >= 2);
    const session: VideoSession = {
      ...s,
      counters: {
        detections: s.counters.detections + detections.length,
        frames: s.counters.frames + 1,
        tracks: all.length,
        events: s.counters.events + newAlerts,
        alerts: s.counters.alerts + newAlerts,
      },
      compliance: {
        compliant: all.filter((t) => t.compliance === "compliant").length,
        non_compliant: all.filter((t) => t.compliance === "non_compliant").length,
        review: all.filter((t) => t.compliance === "review").length,
      },
    };
    this.emit({ session, tracks: active.map((t) => ({ ...t, track: { ...t.track } })), detections, lastInferenceMs: res.durationMs, fps });
    if (now - this.lastPersist > 2000) {
      this.lastPersist = now;
      repo.update((st) => ({ sessions: st.sessions.map((x) => (x.id === session.id ? session : x)) }));
    }
  }

  // ------------------------------------------------- registro de personas ---
  /** Registra (o actualiza) en el padrón EPP a las personas visibles ahora. */
  registerNow(onlyTrackId?: string) {
    const s = this.snap.session;
    if (!s || !this.tracker) return 0;
    const targets = this.tracker.active().filter((t) => !onlyTrackId || t.track.id === onlyTrackId);
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    return this.upsertRecords(targets, s, true, w, h);
  }

  private upsertRecords(targets: TrackedPerson[], s: VideoSession, captureThumb: boolean, w: number, h: number) {
    const { settings } = repo.getState();
    const fresh = [];
    for (const t of targets) {
      const p = {
        personId: t.track.id,
        box: t.track.box,
        confidence: t.track.confidence,
        inferred: false,
        ppe: {
          helmet: { state: t.ppe.helmet, confidence: t.ppeConfidence.helmet },
          vest: { state: t.ppe.vest, confidence: t.ppeConfidence.vest },
          mask: { state: t.ppe.mask, confidence: t.ppeConfidence.mask },
        },
        compliance: t.compliance,
        missing: t.missing,
      };
      const thumb =
        settings.storeEvidence ? (captureThumb && w && t.track.status === "ACTIVE" ? cropToDataUrl(this.video, t.track.box, w, h, 140, 0.7) : this.thumbs.get(t.track.id)) : undefined;
      const rec = personRecordFrom(p, { origin: "live", sessionId: s.id, mode: s.engineMode, thumbnail: thumb, observations: t.track.hits });
      const existing = this.registered.get(t.track.id);
      if (existing) {
        repo.update((st) => ({
          persons: st.persons.map((x) =>
            x.id === existing ? { ...x, ppe: rec.ppe, ppeConfidence: rec.ppeConfidence, compliance: rec.compliance, missing: rec.missing, observations: rec.observations, thumbnail: rec.thumbnail ?? x.thumbnail, observedAt: rec.observedAt } : x,
          ),
        }));
      } else {
        this.registered.set(t.track.id, rec.id);
        fresh.push(rec);
      }
    }
    savePersons(fresh);
    return targets.length;
  }

  // ------------------------------------------------------ pausa / cierre ---
  pause() {
    this.setStatus("PAUSED");
    this.pausedAt = performance.now();
    this.video.pause();
    this.simulator?.pause();
    registerEvent({ type: "SESSION_PAUSED", sessionId: this.snap.session!.id, description: "Video y análisis en pausa", mode: this.mode! });
    audit("SESSION_PAUSED", "VideoSession", this.snap.session!.id);
  }

  async resume() {
    this.setStatus("ACTIVE", { pausedMs: (this.snap.session?.pausedMs ?? 0) + (this.pausedAt ? performance.now() - this.pausedAt : 0) });
    this.pausedAt = undefined;
    this.simulator?.resume();
    await this.video.play().catch(() => undefined);
    registerEvent({ type: "SESSION_RESUMED", sessionId: this.snap.session!.id, description: "Sesión reanudada", mode: this.mode! });
    audit("SESSION_RESUMED", "VideoSession", this.snap.session!.id);
  }

  /** §6.8: detener motor, pistas, srcObject, timers; consolidar y persistir. */
  async stop() {
    if (this.snap.status === "STOPPING" || this.snap.status === "COMPLETED" || this.snap.status === "IDLE") return; // idempotente
    const pausedExtra = this.snap.status === "PAUSED" && this.pausedAt ? performance.now() - this.pausedAt : 0;
    this.setStatus("STOPPING");
    const s = this.snap.session!;
    const tracks = this.tracker?.all().filter((t) => t.track.hits >= 3) ?? [];
    this.upsertRecords(tracks, s, false, 0, 0);
    this.cleanup();
    const ended = new Date();
    const pausedMs = s.pausedMs + pausedExtra;
    this.setStatus("COMPLETED", { endedAt: ended.toISOString(), pausedMs, durationMs: Math.max(0, ended.getTime() - new Date(s.startedAt).getTime() - pausedMs) });
    registerEvent({ type: "SESSION_COMPLETED", sessionId: s.id, description: `${tracks.length} personas registradas`, mode: s.engineMode });
    audit("SESSION_COMPLETED", "VideoSession", s.id, `${tracks.length} tracks consolidados`);
    toast("success", "Sesión finalizada", `${tracks.length} persona(s) consolidadas en el registro EPP.`);
    this.emit({ tracks: [], detections: [] });
  }

  private async fail(msg: string) {
    const s = this.snap.session;
    const tracks = this.tracker?.all().filter((t) => t.track.hits >= 3) ?? [];
    if (s) this.upsertRecords(tracks, s, false, 0, 0);
    this.cleanup();
    this.setStatus("FAILED", { error: msg, endedAt: new Date().toISOString() });
    if (s) {
      registerEvent({ type: "SESSION_FAILED", sessionId: s.id, description: msg, mode: s.engineMode });
      audit("SESSION_FAILED", "VideoSession", s.id, msg);
    }
    this.emit({ error: msg, tracks: [], detections: [] });
    toast("error", "Sesión interrumpida", msg);
  }

  /** Rutina centralizada de liberación de recursos (Anexo B). */
  private cleanup() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stream?.getTracks().forEach((t) => {
      t.removeEventListener("ended", this.onTrackEnded);
      t.stop();
    });
    this.stream = undefined;
    this.simulator?.stop();
    this.simulator = undefined;
    demoEngine.simulator = undefined;
    this.video.pause();
    this.video.srcObject = null;
    this.video.onloadedmetadata = null;
  }

  /** Vuelve a IDLE tras COMPLETED/FAILED para permitir una nueva sesión. */
  reset() {
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(this.snap.status)) this.emit({ status: "IDLE", session: undefined, error: undefined, tracks: [], detections: [] });
  }

  get isCameraActive() {
    return !!this.stream?.getVideoTracks().some((t) => t.readyState === "live");
  }
}

export const live = new LiveSessionController();
// Liberar la cámara si se cierra la pestaña (RN-12).
window.addEventListener("beforeunload", () => {
  if (live.isCameraActive) void live.stop();
});
