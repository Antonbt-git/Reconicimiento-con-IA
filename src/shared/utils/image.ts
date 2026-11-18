import type { BoundingBox } from "../../core/domain/types";
import type { VisionSource } from "../../core/ports";

/** Recorte JPEG pequeño de una región (miniatura de evidencia). */
export function cropToDataUrl(src: VisionSource, box: BoundingBox, w: number, h: number, maxSide = 160, quality = 0.72): string {
  const pad = 0.06;
  const x = Math.max(0, (box.x - box.width * pad) * w);
  const y = Math.max(0, (box.y - box.height * pad) * h);
  const cw = Math.min(w - x, box.width * (1 + pad * 2) * w);
  const ch = Math.min(h - y, box.height * (1 + pad * 2) * h);
  const s = Math.min(1, maxSide / Math.max(cw, ch));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(cw * s));
  c.height = Math.max(1, Math.round(ch * s));
  c.getContext("2d")!.drawImage(src as CanvasImageSource, x, y, cw, ch, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

export interface Highlight {
  box: BoundingBox;
  color: string;
  label: string;
}

/** Fotograma completo con las cajas resaltadas (evidencia para el celular). */
export function annotatedFrame(src: VisionSource, w: number, h: number, highlights: Highlight[], maxSide = 720): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src as CanvasImageSource, 0, 0, c.width, c.height);
  ctx.lineWidth = Math.max(2, c.width / 260);
  ctx.font = `600 ${Math.max(12, c.width / 45)}px Inter, sans-serif`;
  for (const hl of highlights) {
    const [x, y, bw, bh] = [hl.box.x * c.width, hl.box.y * c.height, hl.box.width * c.width, hl.box.height * c.height];
    ctx.strokeStyle = hl.color;
    ctx.strokeRect(x, y, bw, bh);
    const tw = ctx.measureText(hl.label).width + 10;
    const th = Math.max(16, c.width / 34);
    ctx.fillStyle = hl.color;
    ctx.fillRect(x, Math.max(0, y - th), tw, th);
    ctx.fillStyle = "#fff";
    ctx.fillText(hl.label, x + 5, Math.max(th - 4, y - 4));
  }
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, quality = 0.8): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob falló"))), "image/jpeg", quality));
}

/** Validación de archivo de imagen por MIME y firma binaria (§12: no confiar en el nombre). */
export async function validateImageFile(file: File, maxMb = 15): Promise<string | undefined> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Formato no compatible. Use JPG, PNG o WEBP.";
  if (file.size > maxMb * 1024 * 1024) return `La imagen supera ${maxMb} MB.`;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isWebp = head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  if (!isJpg && !isPng && !isWebp) return "El contenido del archivo no corresponde a una imagen válida.";
  return undefined;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("No se pudo leer la imagen."));
    img.src = src;
  });
}

export function sanitize(s: string, max = 120) {
  return s.replace(/[<>"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
