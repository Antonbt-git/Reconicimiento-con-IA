import type { BoundingBox } from "./types";

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function area(b: BoundingBox) {
  return Math.max(0, b.width) * Math.max(0, b.height);
}

export function intersection(a: BoundingBox, b: BoundingBox) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

/** Intersección sobre unión. */
export function iou(a: BoundingBox, b: BoundingBox) {
  const i = intersection(a, b);
  const u = area(a) + area(b) - i;
  return u <= 0 ? 0 : i / u;
}

export function center(b: BoundingBox) {
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

export function pointInBox(px: number, py: number, b: BoundingBox) {
  return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
}

/** Normaliza y recorta una caja al rango 0..1. */
export function normalizeBox(b: BoundingBox): BoundingBox {
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  return { x, y, width: clamp01(b.x + b.width) - x, height: clamp01(b.y + b.height) - y };
}

/** Punto de apoyo (pies) usado para zonas: centro inferior de la caja. */
export function footPoint(b: BoundingBox) {
  return { px: b.x + b.width / 2, py: b.y + b.height * 0.95 };
}

/** Interpolación lineal de cajas (suavizado del overlay en vivo). */
export function lerpBox(a: BoundingBox, b: BoundingBox, t: number): BoundingBox {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}
