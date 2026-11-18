// Evaluación de reglas (§6.6): EPP_MISSING, ENTER_ZONE, DWELL_TIME, COUNT_THRESHOLD.
// Deduplicación por regla + ámbito (sesión/análisis) + sujeto + ventana temporal.
import { footPoint, pointInBox } from "./geometry";
import { PPE_LABEL } from "./epp";
import type { BoundingBox, Compliance, EventType, PpeItem, Rule, Zone } from "./types";

export interface RuleSubject {
  code: string; // P-001 / TRK-001
  box: BoundingBox;
  compliance: Compliance;
  missing: PpeItem[];
  nonCompliantSince?: number;
  zoneEnteredAt?: Record<string, number>;
}

export interface RuleHit {
  rule: Rule;
  type: EventType;
  subjectCode?: string;
  description: string;
  dedupKey: string;
  box?: BoundingBox;
}

export interface EvaluationContext {
  scopeId: string; // sessionId o analysisId
  rules: Rule[];
  zones: Zone[];
  subjects: RuleSubject[];
  now: number;
  /** true en vivo (se exige persistencia temporal); false para imágenes. */
  temporal: boolean;
}

export function evaluateRules(ctx: EvaluationContext): RuleHit[] {
  const hits: RuleHit[] = [];
  const zoneById = new Map(ctx.zones.filter((z) => z.enabled).map((z) => [z.id, z]));

  // Mantener tiempos de ingreso a zonas (en vivo).
  for (const s of ctx.subjects) {
    if (!s.zoneEnteredAt) continue;
    const { px, py } = footPoint(s.box);
    for (const z of zoneById.values()) {
      const inside = pointInBox(px, py, z.geometry);
      if (inside) s.zoneEnteredAt[z.id] ??= ctx.now;
      else delete s.zoneEnteredAt[z.id];
    }
  }

  for (const rule of ctx.rules) {
    if (!rule.enabled) continue;
    const scope = rule.scope ?? "both";
    if ((ctx.temporal && scope === "image") || (!ctx.temporal && scope === "live")) continue;
    const zone = rule.zoneId ? zoneById.get(rule.zoneId) : undefined;
    if ((rule.type === "ENTER_ZONE" || rule.type === "DWELL_TIME") && !zone) continue;

    if (rule.type === "EPP_MISSING") {
      const items = rule.ppeItems?.length ? rule.ppeItems : (["helmet", "vest"] as PpeItem[]);
      for (const s of ctx.subjects) {
        const miss = s.missing.filter((m) => items.includes(m));
        if (s.compliance !== "non_compliant" || !miss.length) continue;
        if (ctx.temporal && (s.nonCompliantSince === undefined || ctx.now - s.nonCompliantSince < rule.threshold)) continue;
        hits.push({
          rule,
          type: "EPP_MISSING",
          subjectCode: s.code,
          box: s.box,
          description: `${s.code}: falta ${miss.map((m) => PPE_LABEL[m].toLowerCase()).join(" y ")}`,
          dedupKey: `${rule.id}|${ctx.scopeId}|${s.code}`,
        });
      }
    }

    if (rule.type === "ENTER_ZONE" && zone) {
      for (const s of ctx.subjects) {
        const { px, py } = footPoint(s.box);
        if (!pointInBox(px, py, zone.geometry)) continue;
        hits.push({
          rule,
          type: "ZONE_ENTERED",
          subjectCode: s.code,
          box: s.box,
          description: `${s.code} ingresó a la zona «${zone.name}»`,
          dedupKey: `${rule.id}|${ctx.scopeId}|${s.code}`,
        });
      }
    }

    if (rule.type === "DWELL_TIME" && zone && ctx.temporal) {
      for (const s of ctx.subjects) {
        const since = s.zoneEnteredAt?.[zone.id];
        if (since === undefined || ctx.now - since < rule.threshold) continue;
        hits.push({
          rule,
          type: "DWELL_THRESHOLD_REACHED",
          subjectCode: s.code,
          box: s.box,
          description: `${s.code} permanece más de ${Math.round(rule.threshold / 1000)} s en «${zone.name}»`,
          dedupKey: `${rule.id}|${ctx.scopeId}|${s.code}`,
        });
      }
    }

    if (rule.type === "COUNT_THRESHOLD") {
      const count = zone
        ? ctx.subjects.filter((s) => {
            const { px, py } = footPoint(s.box);
            return pointInBox(px, py, zone.geometry);
          }).length
        : ctx.subjects.length;
      if (count >= rule.threshold) {
        hits.push({
          rule,
          type: "COUNT_THRESHOLD_REACHED",
          description: `${count} personas ${zone ? `en «${zone.name}»` : "en escena"} (umbral ${rule.threshold})`,
          dedupKey: `${rule.id}|${ctx.scopeId}`,
        });
      }
    }
  }
  return hits;
}

/** Evita eventos duplicados equivalentes dentro de la ventana de la regla (TC-14). */
export class Deduplicator {
  private last = new Map<string, number>();
  shouldEmit(hit: RuleHit, now: number): boolean {
    const prev = this.last.get(hit.dedupKey);
    if (prev !== undefined && now - prev < hit.rule.dedupWindowMs) return false;
    this.last.set(hit.dedupKey, now);
    return true;
  }
}
