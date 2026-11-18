// Composición: registro de motores que implementan el puerto VisionEngine.
import { OnnxVisionAdapter } from "../infrastructure/vision/OnnxVisionAdapter";
import { DemoVisionAdapter } from "../infrastructure/vision/DemoVisionAdapter";
import { ApiVisionAdapter } from "../infrastructure/vision/ApiVisionAdapter";
import { repo } from "../infrastructure/persistence/LocalRepository";
import type { VisionEngine } from "../core/ports";
import { accessToken } from "../infrastructure/persistence/cloud";
import { setNotifyTokenProvider } from "../infrastructure/notify/notifiers";

setNotifyTokenProvider(accessToken);

export const onnxEngine = new OnnxVisionAdapter();
export const demoEngine = new DemoVisionAdapter();
export const apiEngine = new ApiVisionAdapter(() => repo.getState().settings.apiBaseUrl, accessToken);

export const ENGINES: Record<"onnx" | "demo" | "api", VisionEngine> = { onnx: onnxEngine, demo: demoEngine, api: apiEngine };
export type EngineId = keyof typeof ENGINES;
