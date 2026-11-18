// Adaptador REAL: inferencia en el navegador con ONNX Runtime Web (WASM).
//  · ppe-yolov8n.onnx  → detector EPP (10 clases, dataset Construction Site Safety, CC BY 4.0)
//  · person-seg-yolov8n.onnx → segmentación de instancias de personas (COCO)
// El video/imagen nunca sale del navegador (privacidad por diseño, §11.2).
import type { Detection, SegmentationResult } from "../../core/domain/types";
import type { AnalysisInput, VisionEngine, VisionResult } from "../../core/ports";
import { iou } from "../../core/domain/geometry";
import { decode, letterbox, nms, rleEncode } from "./yolo";
import { uid } from "../../shared/utils/id";

const BASE = import.meta.env.BASE_URL;

export const PPE_MODEL_CLASSES = [
  { id: "hardhat", label: "Casco" },
  { id: "mask", label: "Mascarilla" },
  { id: "no_hardhat", label: "Sin casco" },
  { id: "no_mask", label: "Sin mascarilla" },
  { id: "no_vest", label: "Sin chaleco" },
  { id: "person", label: "Persona" },
  { id: "cone", label: "Cono de seguridad" },
  { id: "vest", label: "Chaleco" },
  { id: "machinery", label: "Maquinaria" },
  { id: "vehicle", label: "Vehículo" },
];

interface Output { name: string; data: Float32Array; dims: number[] }

/** Cliente del Web Worker de inferencia (ort.worker.ts). */
class OrtWorkerClient {
  private worker?: Worker;
  private seq = 0;
  private pending = new Map<number, { res: (v: { outputs?: Output[] }) => void; rej: (e: Error) => void }>();
  private init?: Promise<unknown>;

  private call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<{ outputs?: Output[] }> {
    if (!this.worker) {
      this.worker = new Worker(new URL("./ort.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (ev) => {
        const p = this.pending.get(ev.data.id);
        if (!p) return;
        this.pending.delete(ev.data.id);
        if (ev.data.ok) p.res(ev.data);
        else p.rej(new Error(ev.data.error));
      };
      this.worker.onerror = (ev) => {
        this.pending.forEach((p) => p.rej(new Error(ev.message || "Error en el worker de inferencia")));
        this.pending.clear();
      };
    }
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.worker!.postMessage({ ...msg, id }, transfer);
    });
  }

  ready() {
    // 1 hilo WASM dentro de un worker dedicado: estable en todos los navegadores y
    // sin requerir cabeceras COOP/COEP. El paralelismo lo da el propio worker.
    const threads = 1;
    this.init ??= this.call({ type: "init", threads });
    return this.init;
  }

  async load(model: string, file: string) {
    await this.ready();
    await this.call({ type: "load", model, url: abs(`models/${file}`) });
  }

  async run(model: string, tensor: Float32Array, dims: number[]) {
    const r = await this.call({ type: "run", model, tensor, dims }, [tensor.buffer]);
    return r.outputs!;
  }
}

const abs = (p: string) => new URL(`${BASE}${p}`, location.href).href;
const ortClient = new OrtWorkerClient();

export class OnnxVisionAdapter implements VisionEngine {
  readonly id = "onnx";
  readonly name = "Modelo EPP YOLOv8n (ONNX, navegador)";
  readonly mode = "REAL" as const;
  readonly description =
    "Inferencia real en el navegador. Detector EPP entrenado con el dataset público Construction Site Safety (mAP50 ≈ 0,80 en su validación). No validado con datos de su empresa.";

  private ppe = false;
  private seg = false;
  private loadingPpe?: Promise<void>;
  private loadingSeg?: Promise<void>;
  private busy = false;

  /** Umbral bruto mínimo; el umbral de visualización se aplica después (§7.2). */
  rawScore = 0.2;

  isReady() {
    return !!this.ppe;
  }

  async load(onProgress?: (s: string) => void) {
    if (this.ppe) return;
    this.loadingPpe ??= (async () => {
      onProgress?.("Cargando modelo EPP (≈12 MB)…");
      await ortClient.load("ppe", "ppe-yolov8n.onnx");
      this.ppe = true;
    })();
    try {
      await this.loadingPpe;
    } catch (e) {
      this.loadingPpe = undefined;
      throw new Error(`No se pudo cargar el modelo EPP: ${(e as Error).message}`);
    }
  }

  private async loadSeg(onProgress?: (s: string) => void) {
    if (this.seg) return;
    this.loadingSeg ??= (async () => {
      onProgress?.("Cargando modelo de segmentación (≈13 MB)…");
      await ortClient.load("seg", "person-seg-yolov8n.onnx");
      this.seg = true;
    })();
    try {
      await this.loadingSeg;
    } catch (e) {
      this.loadingSeg = undefined;
      throw new Error(`No se pudo cargar el modelo de segmentación: ${(e as Error).message}`);
    }
  }

  get isBusy() {
    return this.busy;
  }

  async analyze(input: AnalysisInput, onProgress?: (s: string) => void): Promise<VisionResult> {
    await this.load(onProgress);
    this.busy = true;
    const t0 = performance.now();
    const stages: Record<string, number> = {};
    try {
      // 1) Preprocesamiento
      const lb = letterbox(input.source, input.width, input.height, 640);
      const t1 = performance.now();
      stages.preprocesamiento = t1 - t0;

      // 2) Inferencia detector EPP
      onProgress?.("Inferencia del detector EPP…");
      // El segmentador reutiliza el mismo tensor: se envía una copia al worker.
      const wantSeg = !input.live && (input.mode === "segmentation" || input.mode === "combined");
      const segTensor = wantSeg ? lb.tensor.slice() : undefined;
      const [o] = await ortClient.run("ppe", lb.tensor, [1, 3, 640, 640]);
      const t2 = performance.now();
      stages.inferencia = t2 - t1;

      // 3) Postprocesamiento: decodificación + NMS
      const raw = nms(decode(o.data as Float32Array, o.dims, PPE_MODEL_CLASSES.length, lb, this.rawScore), 0.45, 150);
      const detections: Detection[] = raw.map((r) => ({
        id: uid("det"),
        classId: PPE_MODEL_CLASSES[r.classIndex].id,
        label: PPE_MODEL_CLASSES[r.classIndex].label,
        confidence: round(r.score),
        box: roundBox(r.box),
      }));
      stages.postprocesamiento = performance.now() - t2;

      // 4) Segmentación de personas (opcional)
      const masks: SegmentationResult[] = [];
      if (wantSeg && segTensor) {
        const t3 = performance.now();
        await this.loadSeg(onProgress);
        onProgress?.("Segmentación de instancias…");
        const sout = await ortClient.run("seg", segTensor, [1, 3, 640, 640]);
        const pred = sout.find((x) => x.dims.length === 3)!;
        const protos = sout.find((x) => x.dims.length === 4)!;
        const nc = pred.dims[1] - 4 - 32;
        const people = nms(decode(pred.data as Float32Array, pred.dims, nc, lb, 0.3, (c) => c === 0), 0.5, 50);
        const pd = pred.data as Float32Array;
        const P = protos.data as Float32Array;
        const [, nm, ph, pw] = protos.dims;
        const N = pred.dims[2];
        for (const person of people) {
          const coeff = new Float32Array(nm);
          for (let k = 0; k < nm; k++) coeff[k] = pd[(4 + nc + k) * N + person.index];
          // región de la caja (recortada a la imagen) en coordenadas del prototipo
          const ix1 = (person.box.x * lb.srcW * lb.scale + lb.padX) / (640 / pw);
          const iy1 = (person.box.y * lb.srcH * lb.scale + lb.padY) / (640 / ph);
          const ix2 = ((person.box.x + person.box.width) * lb.srcW * lb.scale + lb.padX) / (640 / pw);
          const iy2 = ((person.box.y + person.box.height) * lb.srcH * lb.scale + lb.padY) / (640 / ph);
          const x0 = Math.max(0, Math.floor(ix1));
          const y0 = Math.max(0, Math.floor(iy1));
          const w = Math.max(1, Math.min(pw, Math.ceil(ix2)) - x0);
          const h = Math.max(1, Math.min(ph, Math.ceil(iy2)) - y0);
          const bits = new Uint8Array(w * h);
          let on = 0;
          for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
              const pi = (y0 + yy) * pw + (x0 + xx);
              let v = 0;
              for (let k = 0; k < nm; k++) v += coeff[k] * P[k * ph * pw + pi];
              if (v > 0) {
                bits[yy * w + xx] = 1; // sigmoid(v) > 0.5 ⇔ v > 0
                on++;
              }
            }
          }
          const boxArea = person.box.width * person.box.height;
          masks.push({
            id: uid("msk"),
            classId: "person",
            label: "Persona",
            confidence: round(person.score),
            box: roundBox(person.box),
            areaRatio: round((on / (w * h)) * boxArea, 4),
            bitmap: { w, h, rle: rleEncode(bits) },
          });
          // Refuerzo: si el detector EPP no vio a esta persona, se añade desde el segmentador.
          const known = detections.some((d) => d.classId === "person" && iou(d.box, person.box) > 0.45);
          if (!known && person.score >= 0.4) {
            detections.push({
              id: uid("det"),
              classId: "person",
              label: "Persona",
              confidence: round(person.score),
              box: roundBox(person.box),
            });
          }
        }
        stages.segmentacion = performance.now() - t3;
      }

      return {
        mode: "REAL",
        engine: this.name,
        detections,
        masks,
        durationMs: Math.round(performance.now() - t0),
        stages,
      };
    } finally {
      this.busy = false;
    }
  }
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const roundBox = (b: { x: number; y: number; width: number; height: number }) => ({
  x: round(b.x, 4),
  y: round(b.y, 4),
  width: round(b.width, 4),
  height: round(b.height, 4),
});
