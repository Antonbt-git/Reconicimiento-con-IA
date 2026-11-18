// Escenarios demostrativos (§10). Cada escena se dibuja por código a partir de
// la misma definición que produce sus resultados semilla → coordenadas siempre
// calibradas y resultados deterministas (misma entrada = mismo resultado).
import type { BoundingBox, Detection, Scenario, SegmentationResult } from "../../../core/domain/types";
import { seeded } from "../../../shared/utils/id";

export interface Worker {
  box: BoundingBox;
  helmet: boolean;
  vest: boolean;
  helmetColor?: string;
  shirt?: string;
  /** Confianza deliberadamente baja para demostrar "requiere revisión". */
  lowConfidence?: "helmet" | "vest";
}

type Prop = { kind: "box" | "pallet" | "forklift" | "product" | "defect" | "label" | "shelf" | "cone" | "machinery"; box: BoundingBox; color?: string };

export interface SceneDef {
  id: string;
  name: string;
  description: string;
  tags: string[];
  background: "industrial" | "warehouse" | "quality" | "retail";
  workers: Worker[];
  props: Prop[];
}

export const SCENES: SceneDef[] = [
  {
    id: "sc-industrial",
    name: "Seguridad industrial",
    description: "Obra con tres trabajadores. Se espera persona, casco, chaleco y el patrón EPP incompleto.",
    tags: ["EPP", "casco", "chaleco", "SST"],
    background: "industrial",
    workers: [
      { box: { x: 0.1, y: 0.28, width: 0.15, height: 0.62 }, helmet: true, vest: true, helmetColor: "#facc15" },
      { box: { x: 0.4, y: 0.3, width: 0.14, height: 0.6 }, helmet: false, vest: true, shirt: "#1e3a8a" },
      { box: { x: 0.72, y: 0.32, width: 0.14, height: 0.58 }, helmet: true, vest: false, helmetColor: "#f8fafc", shirt: "#475569", lowConfidence: "vest" },
    ],
    props: [
      { kind: "cone", box: { x: 0.3, y: 0.78, width: 0.05, height: 0.12 } },
      { kind: "cone", box: { x: 0.6, y: 0.8, width: 0.045, height: 0.1 } },
    ],
  },
  {
    id: "sc-warehouse",
    name: "Almacén inteligente",
    description: "Cajas, pallets y montacargas; un operario dentro de la zona restringida.",
    tags: ["conteo", "zona", "logística"],
    background: "warehouse",
    workers: [{ box: { x: 0.76, y: 0.38, width: 0.11, height: 0.5 }, helmet: true, vest: true, helmetColor: "#facc15" }],
    props: [
      { kind: "pallet", box: { x: 0.06, y: 0.8, width: 0.24, height: 0.07 } },
      { kind: "box", box: { x: 0.07, y: 0.62, width: 0.1, height: 0.18 } },
      { kind: "box", box: { x: 0.18, y: 0.64, width: 0.1, height: 0.16 } },
      { kind: "box", box: { x: 0.12, y: 0.47, width: 0.1, height: 0.15 } },
      { kind: "forklift", box: { x: 0.38, y: 0.46, width: 0.26, height: 0.42 } },
    ],
  },
  {
    id: "sc-quality",
    name: "Control de calidad",
    description: "Productos en línea con etiqueta; uno con defecto superficial simulado.",
    tags: ["defectos", "manufactura"],
    background: "quality",
    workers: [],
    props: [
      { kind: "product", box: { x: 0.08, y: 0.4, width: 0.2, height: 0.3 } },
      { kind: "label", box: { x: 0.13, y: 0.5, width: 0.1, height: 0.08 } },
      { kind: "product", box: { x: 0.4, y: 0.4, width: 0.2, height: 0.3 } },
      { kind: "label", box: { x: 0.45, y: 0.5, width: 0.1, height: 0.08 } },
      { kind: "defect", box: { x: 0.47, y: 0.6, width: 0.07, height: 0.06 } },
      { kind: "product", box: { x: 0.72, y: 0.4, width: 0.2, height: 0.3 } },
      { kind: "label", box: { x: 0.77, y: 0.5, width: 0.1, height: 0.08 } },
    ],
  },
  {
    id: "sc-retail",
    name: "Retail",
    description: "Tienda con estantes y siete personas: ocupación alta (patrón de congestión).",
    tags: ["afluencia", "conteo"],
    background: "retail",
    workers: [0.05, 0.17, 0.3, 0.44, 0.58, 0.7, 0.83].map((x, i) => ({
      box: { x, y: 0.4 + (i % 2) * 0.04, width: 0.1, height: 0.48 - (i % 2) * 0.04 },
      helmet: false,
      vest: false,
      shirt: ["#be185d", "#0f766e", "#7c3aed", "#b45309", "#1d4ed8", "#15803d", "#9f1239"][i],
    })),
    props: [
      { kind: "shelf", box: { x: 0.02, y: 0.1, width: 0.45, height: 0.3 } },
      { kind: "shelf", box: { x: 0.53, y: 0.1, width: 0.45, height: 0.3 } },
    ],
  },
];

// ------------------------------------------------------------- dibujo ---
type Ctx = CanvasRenderingContext2D;

function rect(_ctx: Ctx, b: BoundingBox, W: number, H: number) {
  return [b.x * W, b.y * H, b.width * W, b.height * H] as const;
}

export function drawBackground(ctx: Ctx, bg: SceneDef["background"], W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (bg === "industrial") {
    g.addColorStop(0, "#bfdbfe");
    g.addColorStop(0.55, "#e0f2fe");
    g.addColorStop(0.56, "#a8a29e");
    g.addColorStop(1, "#78716c");
  } else if (bg === "warehouse") {
    g.addColorStop(0, "#334155");
    g.addColorStop(0.5, "#475569");
    g.addColorStop(0.51, "#94a3b8");
    g.addColorStop(1, "#64748b");
  } else if (bg === "quality") {
    g.addColorStop(0, "#e2e8f0");
    g.addColorStop(1, "#cbd5e1");
  } else {
    g.addColorStop(0, "#fef3c7");
    g.addColorStop(0.5, "#fde68a");
    g.addColorStop(0.51, "#e7e5e4");
    g.addColorStop(1, "#d6d3d1");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (bg === "industrial") {
    // estructura de andamio
    ctx.strokeStyle = "#57534e";
    ctx.lineWidth = W * 0.006;
    for (let i = 0; i < 6; i++) {
      const x = W * (0.02 + i * 0.19);
      ctx.beginPath();
      ctx.moveTo(x, H * 0.08);
      ctx.lineTo(x, H * 0.56);
      ctx.stroke();
    }
    for (let j = 0; j < 3; j++) {
      ctx.beginPath();
      ctx.moveTo(0, H * (0.12 + j * 0.15));
      ctx.lineTo(W, H * (0.12 + j * 0.15));
      ctx.stroke();
    }
  }
  if (bg === "warehouse") {
    ctx.fillStyle = "#1e293b";
    for (let i = 0; i < 5; i++) ctx.fillRect(W * (0.02 + i * 0.2), H * 0.08, W * 0.16, H * 0.38);
    ctx.fillStyle = "#f59e0b";
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) ctx.fillRect(W * (0.03 + i * 0.2), H * (0.1 + j * 0.12), W * 0.14, H * 0.08);
    // zona restringida pintada en el piso
    ctx.strokeStyle = "#facc15";
    ctx.setLineDash([W * 0.015, W * 0.01]);
    ctx.lineWidth = W * 0.004;
    ctx.strokeRect(W * 0.68, H * 0.52, W * 0.3, H * 0.46);
    ctx.setLineDash([]);
  }
  if (bg === "quality") {
    ctx.fillStyle = "#334155";
    ctx.fillRect(0, H * 0.7, W, H * 0.08);
    ctx.fillStyle = "#64748b";
    for (let i = 0; i < 24; i++) ctx.fillRect(W * (i / 24), H * 0.71, W * 0.02, H * 0.06);
  }
}

export function drawWorker(ctx: Ctx, w: Worker, W: number, H: number) {
  const [x, y, bw, bh] = rect(ctx, w.box, W, H);
  const cx = x + bw / 2;
  const headR = bh * 0.075;
  const headY = y + bh * 0.11;
  const skin = "#d6a77a";
  // piernas
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(cx - bw * 0.22, y + bh * 0.6, bw * 0.18, bh * 0.38);
  ctx.fillRect(cx + bw * 0.04, y + bh * 0.6, bw * 0.18, bh * 0.38);
  ctx.fillStyle = "#111827";
  ctx.fillRect(cx - bw * 0.26, y + bh * 0.96, bw * 0.24, bh * 0.04);
  ctx.fillRect(cx + bw * 0.02, y + bh * 0.96, bw * 0.24, bh * 0.04);
  // torso
  ctx.fillStyle = w.shirt ?? "#2563eb";
  ctx.beginPath();
  ctx.roundRect(cx - bw * 0.32, y + bh * 0.2, bw * 0.64, bh * 0.42, bw * 0.12);
  ctx.fill();
  // brazos
  ctx.fillRect(cx - bw * 0.46, y + bh * 0.23, bw * 0.14, bh * 0.32);
  ctx.fillRect(cx + bw * 0.32, y + bh * 0.23, bw * 0.14, bh * 0.32);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(cx - bw * 0.39, y + bh * 0.57, bw * 0.07, 0, Math.PI * 2);
  ctx.arc(cx + bw * 0.39, y + bh * 0.57, bw * 0.07, 0, Math.PI * 2);
  ctx.fill();
  if (w.vest) {
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.roundRect(cx - bw * 0.3, y + bh * 0.22, bw * 0.6, bh * 0.36, bw * 0.08);
    ctx.fill();
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(cx - bw * 0.3, y + bh * 0.36, bw * 0.6, bh * 0.03);
    ctx.fillRect(cx - bw * 0.3, y + bh * 0.47, bw * 0.6, bh * 0.03);
    ctx.fillStyle = w.shirt ?? "#2563eb";
    ctx.fillRect(cx - bw * 0.05, y + bh * 0.22, bw * 0.1, bh * 0.36);
  }
  // cuello y cabeza
  ctx.fillStyle = skin;
  ctx.fillRect(cx - bw * 0.07, y + bh * 0.16, bw * 0.14, bh * 0.06);
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3f2a1d";
  if (!w.helmet) {
    ctx.beginPath();
    ctx.arc(cx, headY - headR * 0.2, headR * 1.02, Math.PI, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = w.helmetColor ?? "#facc15";
    ctx.beginPath();
    ctx.arc(cx, headY - headR * 0.25, headR * 1.15, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - headR * 1.45, headY - headR * 0.3, headR * 2.9, headR * 0.28);
  }
}

function drawProp(ctx: Ctx, p: Prop, W: number, H: number) {
  const [x, y, w, h] = rect(ctx, p.box, W, H);
  switch (p.kind) {
    case "cone":
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w * 0.9, y + h * 0.9);
      ctx.lineTo(x + w * 0.1, y + h * 0.9);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(x + w * 0.3, y + h * 0.45, w * 0.4, h * 0.12);
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(x, y + h * 0.9, w, h * 0.1);
      break;
    case "box":
      ctx.fillStyle = "#b45309";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#fde68a";
      ctx.fillRect(x + w * 0.4, y, w * 0.2, h);
      break;
    case "pallet":
      ctx.fillStyle = "#92400e";
      ctx.fillRect(x, y, w, h * 0.35);
      for (let i = 0; i < 3; i++) ctx.fillRect(x + i * (w * 0.45), y + h * 0.35, w * 0.1, h * 0.65);
      break;
    case "forklift":
      ctx.fillStyle = "#eab308";
      ctx.fillRect(x + w * 0.3, y + h * 0.35, w * 0.6, h * 0.45);
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(x + w * 0.4, y, w * 0.05, h * 0.4);
      ctx.fillRect(x + w * 0.8, y, w * 0.05, h * 0.4);
      ctx.fillRect(x + w * 0.4, y, w * 0.45, h * 0.04);
      ctx.fillRect(x + w * 0.2, y + h * 0.1, w * 0.06, h * 0.72);
      ctx.fillRect(x, y + h * 0.78, w * 0.26, h * 0.04);
      ctx.beginPath();
      ctx.arc(x + w * 0.42, y + h * 0.86, h * 0.13, 0, Math.PI * 2);
      ctx.arc(x + w * 0.8, y + h * 0.86, h * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "product":
      ctx.fillStyle = "#dbeafe";
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, w * 0.08);
      ctx.fill();
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 4;
      ctx.stroke();
      break;
    case "label":
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#0f172a";
      for (let i = 0; i < 8; i++) ctx.fillRect(x + w * (0.08 + i * 0.11), y + h * 0.2, w * (i % 2 ? 0.03 : 0.06), h * 0.6);
      break;
    case "defect":
      ctx.fillStyle = "rgba(68, 40, 20, 0.85)";
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2.4, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#451a03";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.2);
      ctx.lineTo(x + w, y + h * 0.9);
      ctx.stroke();
      break;
    case "shelf":
      ctx.fillStyle = "#78716c";
      ctx.fillRect(x, y, w, h);
      for (let j = 0; j < 3; j++) {
        ctx.fillStyle = "#a8a29e";
        ctx.fillRect(x, y + h * (0.3 + j * 0.33), w, h * 0.04);
        for (let i = 0; i < 9; i++) {
          ctx.fillStyle = ["#ef4444", "#3b82f6", "#22c55e", "#eab308"][(i + j) % 4];
          ctx.fillRect(x + w * (0.02 + i * 0.11), y + h * (0.08 + j * 0.33), w * 0.08, h * 0.2);
        }
      }
      break;
    default:
      break;
  }
}

export function drawScene(ctx: Ctx, s: SceneDef, W: number, H: number) {
  drawBackground(ctx, s.background, W, H);
  s.props.filter((p) => p.kind === "shelf").forEach((p) => drawProp(ctx, p, W, H));
  s.props.filter((p) => p.kind !== "shelf" && p.kind !== "label" && p.kind !== "defect").forEach((p) => drawProp(ctx, p, W, H));
  s.props.filter((p) => p.kind === "label" || p.kind === "defect").forEach((p) => drawProp(ctx, p, W, H));
  s.workers.forEach((w) => drawWorker(ctx, w, W, H));
}

const assetCache = new Map<string, string>();
/** Genera (una vez) la imagen PNG del escenario. */
export function sceneAsset(s: SceneDef, W = 1280, H = 800): string {
  const k = `${s.id}-${W}`;
  if (assetCache.has(k)) return assetCache.get(k)!;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  drawScene(c.getContext("2d")!, s, W, H);
  const url = c.toDataURL("image/png");
  assetCache.set(k, url);
  return url;
}

// ----------------------------------------------------- resultados semilla ---
const LABELS: Record<string, string> = {
  person: "Persona", hardhat: "Casco", no_hardhat: "Sin casco", vest: "Chaleco", no_vest: "Sin chaleco",
  cone: "Cono de seguridad", box: "Caja", pallet: "Pallet", forklift: "Montacargas", product: "Producto",
  label: "Etiqueta", defect: "Defecto", shelf: "Estante", machinery: "Maquinaria",
};

export function workerParts(w: Worker) {
  const b = w.box;
  const head: BoundingBox = { x: b.x + b.width * 0.3, y: b.y - b.height * 0.01, width: b.width * 0.4, height: b.height * 0.2 };
  const torso: BoundingBox = { x: b.x + b.width * 0.18, y: b.y + b.height * 0.2, width: b.width * 0.64, height: b.height * 0.4 };
  return { head: clampBox(head), torso };
}

function clampBox(b: BoundingBox): BoundingBox {
  const y = Math.max(0, b.y);
  return { ...b, y, height: b.height - (y - b.y) };
}

/** Detecciones de un trabajador (compartido con el simulador en vivo). */
export function workerDetections(w: Worker, rnd: () => number, idp: string, trackId?: string): Detection[] {
  const c = (base = 0.84) => Math.round((base + rnd() * 0.12) * 1000) / 1000;
  const { head, torso } = workerParts(w);
  const out: Detection[] = [
    { id: `${idp}-p`, classId: "person", label: LABELS.person, confidence: c(0.86), box: w.box, trackId },
    {
      id: `${idp}-h`,
      classId: w.helmet ? "hardhat" : "no_hardhat",
      label: w.helmet ? LABELS.hardhat : LABELS.no_hardhat,
      confidence: w.lowConfidence === "helmet" ? 0.46 : c(),
      box: head,
    },
    {
      id: `${idp}-v`,
      classId: w.vest ? "vest" : "no_vest",
      label: w.vest ? LABELS.vest : LABELS.no_vest,
      confidence: w.lowConfidence === "vest" ? 0.47 : c(0.8),
      box: torso,
    },
  ];
  return out;
}

function personPolygon(b: BoundingBox): [number, number][] {
  const p = (fx: number, fy: number): [number, number] => [b.x + b.width * fx, b.y + b.height * fy];
  return [
    p(0.42, 0.02), p(0.58, 0.02), p(0.62, 0.12), p(0.56, 0.18), p(0.82, 0.22), p(0.86, 0.6), p(0.72, 0.6),
    p(0.72, 1), p(0.52, 1), p(0.5, 0.62), p(0.48, 1), p(0.28, 1), p(0.28, 0.6), p(0.14, 0.6), p(0.18, 0.22),
    p(0.44, 0.18), p(0.38, 0.12),
  ];
}

function polygonArea(poly: [number, number][]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

export function sceneResults(s: SceneDef): { detections: Detection[]; masks: SegmentationResult[] } {
  const rnd = seeded(s.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0));
  const detections: Detection[] = [];
  const masks: SegmentationResult[] = [];
  s.workers.forEach((w, i) => {
    const dets = workerDetections(w, rnd, `${s.id}-w${i}`);
    // En retail no aplica EPP: solo persona.
    detections.push(...(s.background === "retail" ? dets.slice(0, 1) : dets));
    const poly = personPolygon(w.box);
    masks.push({ id: `${s.id}-m${i}`, classId: "person", label: "Persona", confidence: dets[0].confidence, box: w.box, polygon: poly, areaRatio: round(polygonArea(poly)) });
  });
  s.props.forEach((p, i) => {
    const kind = p.kind === "machinery" ? "machinery" : p.kind;
    const conf = Math.round((0.8 + rnd() * 0.17) * 1000) / 1000;
    detections.push({ id: `${s.id}-o${i}`, classId: kind, label: LABELS[kind] ?? kind, confidence: conf, box: p.box });
    if (kind === "defect" || kind === "forklift" || kind === "product") {
      const b = p.box;
      const poly: [number, number][] =
        kind === "defect"
          ? Array.from({ length: 14 }, (_, k) => {
              const t = (k / 14) * Math.PI * 2;
              const r = 0.85 + 0.15 * Math.sin(k * 2.3);
              return [b.x + b.width / 2 + Math.cos(t) * (b.width / 2) * r, b.y + b.height / 2 + Math.sin(t) * (b.height / 2.2) * r] as [number, number];
            })
          : [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]];
      masks.push({ id: `${s.id}-mo${i}`, classId: kind, label: LABELS[kind], confidence: conf, box: b, polygon: poly, areaRatio: round(polygonArea(poly)) });
    }
  });
  return { detections, masks };
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export const SCENARIOS: Scenario[] = SCENES.map((s) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  tags: s.tags,
  expected: sceneResults(s),
}));
