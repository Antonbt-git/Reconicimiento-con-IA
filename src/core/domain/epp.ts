// Reconocimiento de patrón EPP: asocia las detecciones de EPP a cada persona y
// evalúa el cumplimiento. Regla clave (§7.2): no se afirma que una persona
// incumple solo por una detección incierta → estado "review".
import { area, intersection } from "./geometry";
import type { BoundingBox, Compliance, Detection, PersonPpe, PpeItem, PpeObservation, PpeState } from "./types";

export const PPE_ITEMS: PpeItem[] = ["helmet", "vest", "mask"];

export const PPE_LABEL: Record<PpeItem, string> = { helmet: "Casco", vest: "Chaleco", mask: "Mascarilla" };

/** Clase positiva y negativa del modelo para cada EPP. */
const PPE_CLASSES: Record<PpeItem, { pos: string; neg: string }> = {
  helmet: { pos: "hardhat", neg: "no_hardhat" },
  vest: { pos: "vest", neg: "no_vest" },
  mask: { pos: "mask", neg: "no_mask" },
};

/** Región esperada del EPP dentro de la caja de la persona (fracción vertical). */
const PPE_REGION: Record<PpeItem, [number, number]> = {
  helmet: [-0.12, 0.38],
  vest: [0.12, 0.85],
  mask: [0.0, 0.42],
};

const PPE_CLASS_IDS = new Set(Object.values(PPE_CLASSES).flatMap((c) => [c.pos, c.neg]));
export const isPpeClass = (classId: string) => PPE_CLASS_IDS.has(classId);
export const ppeItemOf = (classId: string): PpeItem | undefined =>
  (Object.keys(PPE_CLASSES) as PpeItem[]).find((k) => PPE_CLASSES[k].pos === classId || PPE_CLASSES[k].neg === classId);

/** Puntuación de pertenencia del EPP a la persona (0 = no pertenece). */
function membership(item: PpeItem, ppe: BoundingBox, person: BoundingBox): number {
  const [top, bottom] = PPE_REGION[item];
  const padX = person.width * 0.15;
  const region: BoundingBox = {
    x: person.x - padX,
    y: person.y + person.height * top,
    width: person.width + padX * 2,
    height: person.height * (bottom - top),
  };
  const cx = ppe.x + ppe.width / 2;
  const cy = ppe.y + ppe.height / 2;
  if (cx < region.x || cx > region.x + region.width || cy < region.y || cy > region.y + region.height) return 0;
  const overlap = intersection(ppe, region) / Math.max(1e-6, area(ppe));
  if (overlap < 0.35) return 0;
  // Favorece al EPP más centrado horizontalmente respecto de la persona.
  const dx = Math.abs(cx - (person.x + person.width / 2)) / Math.max(1e-6, person.width);
  return overlap * (1 - Math.min(0.9, dx));
}

export interface EppOptions {
  /** Umbral mínimo para considerar una detección como evidencia. */
  minConfidence: number;
  /** Por debajo de este valor la evidencia se marca como incierta. */
  reviewThreshold: number;
  requiredPpe: PpeItem[];
  codePrefix?: string;
}

export function complianceOf(
  ppe: Record<PpeItem, PpeObservation | { state: PpeState }>,
  required: PpeItem[],
): { compliance: Compliance; missing: PpeItem[] } {
  const missing = required.filter((i) => ppe[i].state === "absent");
  if (missing.length) return { compliance: "non_compliant", missing };
  const allPresent = required.every((i) => ppe[i].state === "present");
  return { compliance: allPresent ? "compliant" : "review", missing: [] };
}

/**
 * Asocia detecciones EPP a personas. Si el modelo detecta un EPP (o su ausencia)
 * sin caja de persona —por ejemplo, un primer plano de la cabeza—, se crea una
 * persona "inferida" para no perder la evidencia.
 */
export function associatePpe(detections: Detection[], opts: EppOptions): PersonPpe[] {
  const usable = detections.filter((d) => d.confidence >= opts.minConfidence);
  const persons = usable.filter((d) => d.classId === "person");
  const ppeDets = usable.filter((d) => isPpeClass(d.classId));

  // Asignación: cada EPP va a la persona con mayor pertenencia.
  const assigned = new Map<string, Detection[]>();
  const orphans: Detection[] = [];
  for (const d of ppeDets) {
    const item = ppeItemOf(d.classId)!;
    let best: Detection | undefined;
    let bestScore = 0;
    for (const p of persons) {
      const s = membership(item, d.box, p.box);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    if (best) assigned.set(best.id, [...(assigned.get(best.id) ?? []), d]);
    else orphans.push(d);
  }

  const results: PersonPpe[] = [];
  const prefix = opts.codePrefix ?? "P-";
  let n = 0;
  const build = (box: BoundingBox, confidence: number, items: Detection[], inferred: boolean, trackId?: string) => {
    const ppe = {} as Record<PpeItem, PpeObservation>;
    for (const item of PPE_ITEMS) {
      const { pos, neg } = PPE_CLASSES[item];
      const bestPos = items.filter((d) => d.classId === pos).sort((a, b) => b.confidence - a.confidence)[0];
      const bestNeg = items.filter((d) => d.classId === neg).sort((a, b) => b.confidence - a.confidence)[0];
      const winner =
        bestPos && bestNeg ? (bestPos.confidence >= bestNeg.confidence ? bestPos : bestNeg) : bestPos ?? bestNeg;
      if (!winner) ppe[item] = { state: "unknown", confidence: 0 };
      else if (winner.confidence < opts.reviewThreshold) ppe[item] = { state: "uncertain", confidence: winner.confidence, evidenceId: winner.id };
      else ppe[item] = { state: winner.classId === pos ? "present" : "absent", confidence: winner.confidence, evidenceId: winner.id };
    }
    const { compliance, missing } = complianceOf(ppe, opts.requiredPpe);
    n += 1;
    results.push({
      personId: trackId ?? `${prefix}${String(n).padStart(3, "0")}`,
      box,
      confidence,
      inferred,
      ppe,
      compliance,
      missing,
    });
  };

  // Personas ordenadas de izquierda a derecha para códigos estables.
  for (const p of [...persons].sort((a, b) => a.box.x - b.box.x)) {
    build(p.box, p.confidence, assigned.get(p.id) ?? [], false, p.trackId);
  }

  // EPP huérfanos de cabeza → persona inferida (agrupa casco/mascarilla cercanos).
  const headOrphans = orphans.filter((d) => ["helmet", "mask"].includes(ppeItemOf(d.classId)!));
  const used = new Set<string>();
  for (const h of headOrphans.sort((a, b) => b.confidence - a.confidence)) {
    if (used.has(h.id)) continue;
    const w = h.box.width * 2.2;
    const box: BoundingBox = {
      x: Math.max(0, h.box.x + h.box.width / 2 - w / 2),
      y: h.box.y,
      width: Math.min(w, 1),
      height: Math.min(1 - h.box.y, h.box.height * 6),
    };
    const group = orphans.filter((o) => !used.has(o.id) && membership(ppeItemOf(o.classId)!, o.box, box) > 0);
    group.forEach((g) => used.add(g.id));
    used.add(h.id);
    if (!group.includes(h)) group.push(h);
    build(box, h.confidence, group, true);
  }
  return results;
}

export function complianceLabel(c: Compliance) {
  return c === "compliant" ? "Cumple" : c === "non_compliant" ? "EPP incompleto" : "Requiere revisión";
}

export function ppeStateLabel(s: PpeState) {
  return { present: "Detectado", absent: "No detectado", uncertain: "Incierto", unknown: "Sin evidencia" }[s];
}
