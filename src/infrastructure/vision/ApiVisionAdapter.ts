// Adaptador hacia el servicio backend (server/ · FastAPI + ONNX Runtime).
// Contrato: POST /api/v1/analyses (multipart: file, mode) → VisionResult.
import type { AnalysisInput, VisionEngine, VisionResult } from "../../core/ports";

export class ApiVisionAdapter implements VisionEngine {
  readonly id = "api";
  readonly name = "Servicio de visión (API FastAPI)";
  readonly mode = "REAL" as const;
  readonly description = "Envía la imagen al backend del proyecto (carpeta server/). Requiere que el servicio esté en ejecución.";
  constructor(private baseUrl: () => string, private token?: () => Promise<string | undefined>) {}

  private ready = false;
  isReady() {
    return this.ready;
  }

  async load() {
    // Render (plan gratuito) puede tardar ~1 min en despertar: se espera hasta 90 s.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 90_000);
    const r = await fetch(`${this.baseUrl()}/health`, { signal: ctl.signal }).catch(() => undefined);
    clearTimeout(t);
    if (!r?.ok) throw new Error(`El servicio de visión no responde en ${this.baseUrl()}. Si está en Render gratuito, espere un minuto y reintente.`);
    this.ready = true;
  }

  async analyze(input: AnalysisInput, onProgress?: (s: string) => void): Promise<VisionResult> {
    await this.load();
    onProgress?.("Enviando imagen al servicio…");
    const c = document.createElement("canvas");
    c.width = input.width;
    c.height = input.height;
    c.getContext("2d")!.drawImage(input.source as CanvasImageSource, 0, 0, input.width, input.height);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.9));
    const fd = new FormData();
    fd.append("file", blob, "frame.jpg");
    fd.append("mode", input.mode);
    const auth = await this.token?.();
    const r = await fetch(`${this.baseUrl()}/api/v1/analyses`, { method: "POST", body: fd, headers: auth ? { Authorization: `Bearer ${auth}` } : undefined });
    if (!r.ok) throw new Error(`Error del servicio (${r.status}): ${await r.text()}`);
    onProgress?.("Procesando respuesta…");
    return (await r.json()) as VisionResult;
  }
}
