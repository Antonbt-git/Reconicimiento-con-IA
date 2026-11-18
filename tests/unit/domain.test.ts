// Pruebas de dominio sin navegador ni cámara (§17.1). Mapeadas a los casos TC del documento.
import { describe, expect, it } from "vitest";
import { associatePpe, complianceOf } from "../../src/core/domain/epp";
import { iou, normalizeBox } from "../../src/core/domain/geometry";
import { PersonTracker } from "../../src/core/domain/tracker";
import { Deduplicator, evaluateRules } from "../../src/core/domain/rules";
import { assertTransition, canTransition, canTransitionAlert } from "../../src/core/domain/sessionMachine";
import { isValidBox, type Detection, type Rule, type Zone } from "../../src/core/domain/types";
import { decode, nms, rleDecode, rleEncode } from "../../src/infrastructure/vision/yolo";
import { toCsv } from "../../src/infrastructure/export/csv";

const det = (id: string, classId: string, confidence: number, x: number, y: number, w: number, h: number): Detection => ({ id, classId, label: classId, confidence, box: { x, y, width: w, height: h } });
const opts = { minConfidence: 0.3, reviewThreshold: 0.5, requiredPpe: ["helmet", "vest"] as ("helmet" | "vest")[] };

describe("Geometría", () => {
  it("IoU de cajas idénticas es 1 y disjuntas 0", () => {
    const a = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    expect(iou(a, a)).toBeCloseTo(1);
    expect(iou(a, { x: 0.6, y: 0.6, width: 0.1, height: 0.1 })).toBe(0);
  });
  it("TC-13: rechaza coordenadas fuera de rango", () => {
    expect(isValidBox({ x: 0.2, y: 0.2, width: 0.3, height: 0.3 })).toBe(true);
    expect(isValidBox({ x: -0.1, y: 0.2, width: 0.3, height: 0.3 })).toBe(false);
    expect(isValidBox({ x: 0.9, y: 0.2, width: 0.3, height: 0.3 })).toBe(false);
    expect(isValidBox({ x: 0.2, y: 0.2, width: 0, height: 0.3 })).toBe(false);
    expect(isValidBox({ x: NaN, y: 0.2, width: 0.1, height: 0.3 })).toBe(false);
    expect(normalizeBox({ x: 0.9, y: 0.9, width: 0.3, height: 0.3 })).toEqual({ x: 0.9, y: 0.9, width: 0.09999999999999998, height: 0.09999999999999998 });
  });
});

describe("Patrón EPP", () => {
  it("persona con casco y chaleco cumple", () => {
    const r = associatePpe([det("p", "person", 0.9, 0.3, 0.2, 0.2, 0.7), det("h", "hardhat", 0.9, 0.35, 0.18, 0.1, 0.1), det("v", "vest", 0.85, 0.32, 0.35, 0.16, 0.25)], opts);
    expect(r).toHaveLength(1);
    expect(r[0].compliance).toBe("compliant");
    expect(r[0].ppe.helmet.state).toBe("present");
  });
  it("persona sin casco → EPP incompleto con faltante casco", () => {
    const r = associatePpe([det("p", "person", 0.9, 0.3, 0.2, 0.2, 0.7), det("h", "no_hardhat", 0.88, 0.35, 0.18, 0.1, 0.1), det("v", "vest", 0.85, 0.32, 0.35, 0.16, 0.25)], opts);
    expect(r[0].compliance).toBe("non_compliant");
    expect(r[0].missing).toEqual(["helmet"]);
  });
  it("§7.2: evidencia incierta no se convierte en incumplimiento", () => {
    const r = associatePpe([det("p", "person", 0.9, 0.3, 0.2, 0.2, 0.7), det("h", "no_hardhat", 0.4, 0.35, 0.18, 0.1, 0.1), det("v", "vest", 0.85, 0.32, 0.35, 0.16, 0.25)], opts);
    expect(r[0].ppe.helmet.state).toBe("uncertain");
    expect(r[0].compliance).toBe("review");
  });
  it("cada EPP se asigna a la persona correcta (dos personas)", () => {
    const r = associatePpe([
      det("p1", "person", 0.9, 0.1, 0.2, 0.2, 0.7), det("p2", "person", 0.9, 0.6, 0.2, 0.2, 0.7),
      det("h1", "hardhat", 0.9, 0.15, 0.18, 0.1, 0.1), det("h2", "no_hardhat", 0.9, 0.65, 0.18, 0.1, 0.1),
      det("v1", "vest", 0.9, 0.12, 0.35, 0.16, 0.25), det("v2", "vest", 0.9, 0.62, 0.35, 0.16, 0.25),
    ], opts);
    expect(r.map((x) => x.compliance)).toEqual(["compliant", "non_compliant"]);
  });
  it("EPP sin caja de persona genera persona inferida", () => {
    const r = associatePpe([det("h", "no_hardhat", 0.9, 0.4, 0.1, 0.15, 0.15)], opts);
    expect(r).toHaveLength(1);
    expect(r[0].inferred).toBe(true);
  });
  it("mascarilla no obligatoria no afecta el cumplimiento", () => {
    const c = complianceOf({ helmet: { state: "present" }, vest: { state: "present" }, mask: { state: "absent" } }, ["helmet", "vest"]);
    expect(c.compliance).toBe("compliant");
  });
});

describe("Seguimiento (TC-07, RN-09)", () => {
  it("mantiene el Track ID estable y no reutiliza IDs", () => {
    const t = new PersonTracker({ sessionId: "s", iouThreshold: 0.25, maxMisses: 2, window: 6, requiredPpe: ["helmet", "vest"] });
    const mk = (x: number) => associatePpe([det("p", "person", 0.9, x, 0.2, 0.2, 0.7), det("h", "no_hardhat", 0.9, x + 0.05, 0.18, 0.1, 0.1), det("v", "vest", 0.9, x + 0.02, 0.35, 0.16, 0.25)], opts);
    let ids: string[] = [];
    for (let i = 0; i < 6; i++) ids = t.update(mk(0.1 + i * 0.01), i * 250).map((x) => x.track.id);
    expect(ids).toEqual(["TRK-001"]);
    const tr = t.active()[0];
    expect(tr.ppe.helmet).toBe("absent");
    expect(tr.compliance).toBe("non_compliant");
    for (let i = 0; i < 4; i++) t.update([], 2000 + i * 250); // desaparece
    expect(t.active()).toHaveLength(0);
    const again = t.update(mk(0.1), 4000);
    expect(again[0].track.id).toBe("TRK-002");
  });
  it("suavizado: una observación aislada no cambia el estado", () => {
    const t = new PersonTracker({ sessionId: "s", iouThreshold: 0.25, maxMisses: 2, window: 8, requiredPpe: ["helmet", "vest"] });
    const mk = (cls: string) => associatePpe([det("p", "person", 0.9, 0.1, 0.2, 0.2, 0.7), det("h", cls, 0.9, 0.15, 0.18, 0.1, 0.1), det("v", "vest", 0.9, 0.12, 0.35, 0.16, 0.25)], opts);
    for (let i = 0; i < 6; i++) t.update(mk("hardhat"), i);
    t.update(mk("no_hardhat"), 7);
    expect(t.active()[0].ppe.helmet).toBe("present");
  });
});

describe("Reglas y deduplicación (TC-08, TC-14)", () => {
  const zone: Zone = { id: "z", name: "Z", geometry: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, enabled: true, color: "#f00" };
  const rule = (p: Partial<Rule>): Rule => ({ id: "r", code: "X", name: "R", type: "EPP_MISSING", threshold: 3000, ppeItems: ["helmet", "vest"], severity: "high", enabled: true, notify: true, dedupWindowMs: 60000, scope: "both", ...p });
  const subj = { code: "TRK-001", box: { x: 0.6, y: 0.3, width: 0.2, height: 0.6 }, compliance: "non_compliant" as const, missing: ["helmet" as const], nonCompliantSince: 0, zoneEnteredAt: {} };

  it("EPP_MISSING en vivo exige persistencia temporal", () => {
    const base = { scopeId: "s", rules: [rule({})], zones: [], subjects: [subj], temporal: true };
    expect(evaluateRules({ ...base, now: 1000 })).toHaveLength(0);
    expect(evaluateRules({ ...base, now: 3500 })).toHaveLength(1);
  });
  it("ENTER_ZONE usa el punto de apoyo y respeta el ámbito", () => {
    const r = rule({ type: "ENTER_ZONE", zoneId: "z", scope: "live" });
    expect(evaluateRules({ scopeId: "s", rules: [r], zones: [zone], subjects: [subj], now: 0, temporal: true })).toHaveLength(1);
    expect(evaluateRules({ scopeId: "s", rules: [r], zones: [zone], subjects: [subj], now: 0, temporal: false })).toHaveLength(0);
  });
  it("COUNT_THRESHOLD", () => {
    const r = rule({ type: "COUNT_THRESHOLD", threshold: 2 });
    expect(evaluateRules({ scopeId: "s", rules: [r], zones: [], subjects: [subj, { ...subj, code: "TRK-002" }], now: 0, temporal: false })).toHaveLength(1);
  });
  it("deduplica dentro de la ventana y vuelve a emitir después", () => {
    const d = new Deduplicator();
    const [hit] = evaluateRules({ scopeId: "s", rules: [rule({})], zones: [], subjects: [subj], now: 5000, temporal: true });
    expect(d.shouldEmit(hit, 5000)).toBe(true);
    expect(d.shouldEmit(hit, 30000)).toBe(false);
    expect(d.shouldEmit(hit, 66000)).toBe(true);
  });
  it("regla deshabilitada no dispara", () => {
    expect(evaluateRules({ scopeId: "s", rules: [rule({ enabled: false })], zones: [], subjects: [subj], now: 9000, temporal: true })).toHaveLength(0);
  });
});

describe("Máquinas de estado", () => {
  it("sesión: transiciones válidas e inválidas (TC-12)", () => {
    expect(canTransition("IDLE", "PREPARING")).toBe(true);
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(() => assertTransition("IDLE", "ACTIVE")).toThrow();
    expect(() => assertTransition("COMPLETED", "ACTIVE")).toThrow();
  });
  it("TC-15: una alerta cerrada no se reabre", () => {
    expect(canTransitionAlert("NEW", "IN_REVIEW")).toBe(true);
    expect(canTransitionAlert("CLOSED", "NEW")).toBe(false);
    expect(canTransitionAlert("CLOSED", "IN_REVIEW")).toBe(false);
  });
});

describe("Postprocesamiento YOLO", () => {
  it("decodifica y aplica NMS", () => {
    const n = 3;
    const nc = 2;
    const out = new Float32Array((4 + nc) * n);
    const put = (i: number, cx: number, cy: number, w: number, h: number, s0: number, s1: number) => {
      out[i] = cx; out[n + i] = cy; out[2 * n + i] = w; out[3 * n + i] = h; out[4 * n + i] = s0; out[5 * n + i] = s1;
    };
    put(0, 320, 320, 100, 100, 0.9, 0.1);
    put(1, 322, 321, 100, 100, 0.8, 0.1); // duplicado
    put(2, 100, 100, 50, 50, 0.1, 0.7);
    const lb = { tensor: new Float32Array(), scale: 1, padX: 0, padY: 0, srcW: 640, srcH: 640, size: 640 };
    const r = nms(decode(out, [1, 6, n], nc, lb, 0.25));
    expect(r).toHaveLength(2);
    expect(r[0].classIndex).toBe(0);
    expect(r[0].box.x).toBeCloseTo(270 / 640);
  });
  it("RLE ida y vuelta", () => {
    const bits = new Uint8Array([0, 0, 1, 1, 1, 0, 1, 0, 0]);
    expect(Array.from(rleDecode(rleEncode(bits), bits.length))).toEqual(Array.from(bits));
  });
});

describe("Exportación CSV", () => {
  it("escapa comas, comillas e inyección de fórmulas", () => {
    const csv = toCsv([{ a: 'x,"y"', b: "=1+1", c: 3 }]);
    expect(csv).toBe('a,b,c\r\n"x,""y""",\'=1+1,3');
  });
});
