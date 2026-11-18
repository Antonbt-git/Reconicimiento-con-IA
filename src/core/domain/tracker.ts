// Seguimiento temporal (§6.5). Asociación voraz por IoU + distancia de centros.
// Los Track ID son temporales, únicos dentro de la sesión y NO representan
// identidad personal (RN-09).
import { center, iou } from "./geometry";
import { complianceOf, PPE_ITEMS } from "./epp";
import type { BoundingBox, Compliance, PersonPpe, PpeItem, PpeState, Track } from "./types";

export interface TrackedPerson {
  track: Track;
  ppe: Record<PpeItem, PpeState>;
  ppeConfidence: Record<PpeItem, number>;
  compliance: Compliance;
  missing: PpeItem[];
  /** Instante desde el que la falta de EPP persiste (para la regla en vivo). */
  nonCompliantSince?: number;
  zoneEnteredAt: Record<string, number>;
  latest?: PersonPpe;
}

interface History {
  states: Record<PpeItem, { s: PpeState; c: number }[]>;
}

export interface TrackerOptions {
  sessionId: string;
  iouThreshold: number;
  maxMisses: number; // actualizaciones sin coincidencia antes de LOST/FINISHED
  window: number; // ventana de suavizado de EPP
  requiredPpe: PpeItem[];
}

export class PersonTracker {
  private seq = 0;
  private tracks = new Map<string, TrackedPerson>();
  private history = new Map<string, History>();
  private finished: TrackedPerson[] = [];
  constructor(private opts: TrackerOptions) {}

  private nextId() {
    this.seq += 1;
    return `TRK-${String(this.seq).padStart(3, "0")}`;
  }

  get totalCreated() {
    return this.seq;
  }

  active(): TrackedPerson[] {
    return [...this.tracks.values()].filter((t) => t.track.status === "ACTIVE");
  }

  /** Todos los tracks, incluidos los finalizados (para consolidar el cierre). */
  all(): TrackedPerson[] {
    return [...this.finished, ...this.tracks.values()];
  }

  update(persons: PersonPpe[], now: number): TrackedPerson[] {
    const candidates = [...this.tracks.values()];
    const pairs: { t: TrackedPerson; p: PersonPpe; score: number }[] = [];
    for (const t of candidates) {
      for (const p of persons) {
        const i = iou(t.track.box, p.box);
        const a = center(t.track.box);
        const b = center(p.box);
        const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        const near = dist < Math.max(t.track.box.width, p.box.width) * 0.6;
        const score = i >= this.opts.iouThreshold ? i + 1 : near ? 1 - dist : 0;
        if (score > 0) pairs.push({ t, p, score });
      }
    }
    pairs.sort((x, y) => y.score - x.score);
    const usedT = new Set<string>();
    const usedP = new Set<PersonPpe>();
    for (const { t, p } of pairs) {
      if (usedT.has(t.track.id) || usedP.has(p)) continue;
      usedT.add(t.track.id);
      usedP.add(p);
      this.observe(t, p, now);
    }
    // Nuevos tracks
    for (const p of persons) {
      if (usedP.has(p)) continue;
      const id = this.nextId();
      const t: TrackedPerson = {
        track: {
          id,
          sessionId: this.opts.sessionId,
          box: p.box,
          firstSeenAt: now,
          lastSeenAt: now,
          hits: 0,
          misses: 0,
          status: "ACTIVE",
          confidence: p.confidence,
        },
        ppe: { helmet: "unknown", vest: "unknown", mask: "unknown" },
        ppeConfidence: { helmet: 0, vest: 0, mask: 0 },
        compliance: "review",
        missing: [],
        zoneEnteredAt: {},
      };
      this.tracks.set(id, t);
      this.history.set(id, { states: { helmet: [], vest: [], mask: [] } });
      this.observe(t, p, now);
      usedT.add(id);
    }
    // Tracks no observados
    for (const t of candidates) {
      if (usedT.has(t.track.id)) continue;
      t.track.misses += 1;
      if (t.track.misses > this.opts.maxMisses) {
        t.track.status = "FINISHED";
        this.tracks.delete(t.track.id);
        this.finished.push(t);
      } else {
        t.track.status = t.track.misses > 1 ? "LOST" : "ACTIVE";
      }
    }
    return this.active();
  }

  private observe(t: TrackedPerson, p: PersonPpe, now: number) {
    // Suavizado exponencial de la caja para un overlay estable.
    const a = 0.6;
    const b: BoundingBox = t.track.hits === 0 ? p.box : {
      x: t.track.box.x * (1 - a) + p.box.x * a,
      y: t.track.box.y * (1 - a) + p.box.y * a,
      width: t.track.box.width * (1 - a) + p.box.width * a,
      height: t.track.box.height * (1 - a) + p.box.height * a,
    };
    t.track.box = b;
    t.track.lastSeenAt = now;
    t.track.hits += 1;
    t.track.misses = 0;
    t.track.status = "ACTIVE";
    t.track.confidence = p.confidence;
    t.latest = { ...p, personId: t.track.id };

    const h = this.history.get(t.track.id)!;
    for (const item of PPE_ITEMS) {
      const o = p.ppe[item];
      const arr = h.states[item];
      arr.push({ s: o.state, c: o.confidence });
      if (arr.length > this.opts.window) arr.shift();
      // Voto mayoritario entre observaciones con evidencia (present/absent).
      const votes = { present: 0, absent: 0 };
      const conf = { present: 0, absent: 0 };
      let uncertain = 0;
      for (const x of arr) {
        if (x.s === "present" || x.s === "absent") {
          votes[x.s] += 1;
          conf[x.s] = Math.max(conf[x.s], x.c);
        } else if (x.s === "uncertain") uncertain += 1;
      }
      const decided = votes.present + votes.absent;
      const minObs = Math.min(3, Math.ceil(this.opts.window / 3));
      if (decided >= minObs && votes.present !== votes.absent) {
        const s = votes.present > votes.absent ? "present" : "absent";
        t.ppe[item] = s;
        t.ppeConfidence[item] = conf[s];
      } else if (decided > 0 || uncertain > 0) {
        t.ppe[item] = "uncertain";
        t.ppeConfidence[item] = Math.max(conf.present, conf.absent);
      } else {
        t.ppe[item] = "unknown";
        t.ppeConfidence[item] = 0;
      }
    }
    const { compliance, missing } = complianceOf(
      { helmet: { state: t.ppe.helmet }, vest: { state: t.ppe.vest }, mask: { state: t.ppe.mask } },
      this.opts.requiredPpe,
    );
    t.compliance = compliance;
    t.missing = missing;
    if (compliance === "non_compliant") t.nonCompliantSince ??= now;
    else t.nonCompliantSince = undefined;
  }
}
