// Pre y postprocesamiento YOLOv8 (letterbox → tensor CHW → decodificación → NMS).
import type { BoundingBox } from "../../core/domain/types";
import type { VisionSource } from "../../core/ports";

export interface Letterbox {
  tensor: Float32Array;
  scale: number;
  padX: number;
  padY: number;
  srcW: number;
  srcH: number;
  size: number;
}

let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;

function getCtx(size: number) {
  if (!canvas) canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  return canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

export function letterbox(src: VisionSource, srcW: number, srcH: number, size = 640): Letterbox {
  const ctx = getCtx(size);
  const scale = Math.min(size / srcW, size / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const padX = Math.floor((size - w) / 2);
  const padY = Math.floor((size - h) / 2);
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(src as CanvasImageSource, padX, padY, w, h);
  const { data } = ctx.getImageData(0, 0, size, size);
  const n = size * size;
  const tensor = new Float32Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    tensor[i] = data[p] / 255;
    tensor[n + i] = data[p + 1] / 255;
    tensor[2 * n + i] = data[p + 2] / 255;
  }
  return { tensor, scale, padX, padY, srcW, srcH, size };
}

export interface RawBox {
  classIndex: number;
  score: number;
  box: BoundingBox; // normalizada respecto de la imagen original
  index: number; // índice de anclaje (para coeficientes de máscara)
  xyxy: [number, number, number, number]; // en píxeles del tensor de entrada
}

/** Decodifica la salida [1, 4+nc(+nm), N] de YOLOv8. */
export function decode(
  out: Float32Array,
  dims: readonly number[],
  numClasses: number,
  lb: Letterbox,
  minScore: number,
  classFilter?: (c: number) => boolean,
): RawBox[] {
  const n = dims[2];
  const res: RawBox[] = [];
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestScore = minScore;
    for (let c = 0; c < numClasses; c++) {
      if (classFilter && !classFilter(c)) continue;
      const s = out[(4 + c) * n + i];
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best < 0) continue;
    const cx = out[i];
    const cy = out[n + i];
    const w = out[2 * n + i];
    const h = out[3 * n + i];
    const x1 = cx - w / 2;
    const y1 = cy - h / 2;
    const x2 = cx + w / 2;
    const y2 = cy + h / 2;
    const ox1 = Math.max(0, (x1 - lb.padX) / lb.scale);
    const oy1 = Math.max(0, (y1 - lb.padY) / lb.scale);
    const ox2 = Math.min(lb.srcW, (x2 - lb.padX) / lb.scale);
    const oy2 = Math.min(lb.srcH, (y2 - lb.padY) / lb.scale);
    if (ox2 - ox1 < 2 || oy2 - oy1 < 2) continue;
    res.push({
      classIndex: best,
      score: bestScore,
      index: i,
      xyxy: [x1, y1, x2, y2],
      box: { x: ox1 / lb.srcW, y: oy1 / lb.srcH, width: (ox2 - ox1) / lb.srcW, height: (oy2 - oy1) / lb.srcH },
    });
  }
  return res;
}

function iouXYXY(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u <= 0 ? 0 : inter / u;
}

/** Supresión de no máximos por clase. */
export function nms(boxes: RawBox[], iouThreshold = 0.45, maxDet = 100): RawBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep: RawBox[] = [];
  for (const b of sorted) {
    if (keep.length >= maxDet) break;
    if (keep.some((k) => k.classIndex === b.classIndex && iouXYXY(k.xyxy, b.xyxy) > iouThreshold)) continue;
    keep.push(b);
  }
  return keep;
}

/** Codificación RLE simple de un mapa binario ("<ceros>,<unos>,…"). */
export function rleEncode(bits: Uint8Array): string {
  const out: number[] = [];
  let cur = 0;
  let run = 0;
  for (const b of bits) {
    if (b === cur) run++;
    else {
      out.push(run);
      run = 1;
      cur = b;
    }
  }
  out.push(run);
  return out.join(",");
}

export function rleDecode(rle: string, size: number): Uint8Array {
  const bits = new Uint8Array(size);
  let pos = 0;
  let cur = 0;
  for (const part of rle.split(",")) {
    const n = Number(part);
    if (cur) bits.fill(1, pos, pos + n);
    pos += n;
    cur = cur ? 0 : 1;
  }
  return bits;
}
