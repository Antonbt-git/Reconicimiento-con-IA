// Puertos (arquitectura hexagonal ligera). Los casos de uso dependen de estas
// interfaces, nunca de un adaptador concreto.
import type { AnalysisMode, Detection, EngineMode, SegmentationResult, Severity } from "../domain/types";

export type VisionSource = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap;

export interface AnalysisInput {
  source: VisionSource;
  width: number;
  height: number;
  mode: AnalysisMode;
  scenarioId?: string;
  /** Tiempo del fotograma (ms) — usado por el simulador en vivo. */
  frameTime?: number;
  live?: boolean;
}

export interface VisionResult {
  mode: EngineMode;
  engine: string;
  detections: Detection[];
  masks: SegmentationResult[];
  durationMs: number;
  /** Latencias por etapa (preprocesamiento, inferencia, postprocesamiento). */
  stages?: Record<string, number>;
}

export interface VisionEngine {
  readonly id: string;
  readonly name: string;
  readonly mode: EngineMode;
  readonly description: string;
  /** Carga perezosa del modelo; idempotente. */
  load(onProgress?: (stage: string) => void): Promise<void>;
  isReady(): boolean;
  analyze(input: AnalysisInput, onProgress?: (stage: string) => void): Promise<VisionResult>;
}

export interface NotificationMessage {
  title: string;
  message: string;
  severity: Severity;
  tags: string[];
  /** Imagen JPEG de evidencia (opcional). */
  image?: Blob;
  clickUrl?: string;
}

export interface NotificationPort {
  readonly channel: string;
  send(msg: NotificationMessage): Promise<{ ok: boolean; detail: string }>;
}
