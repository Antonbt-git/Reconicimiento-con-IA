// Adaptador SIMULADO (DemoVisionAdapter). Devuelve resultados semilla
// deterministas por escenario y, para la fuente simulada en vivo, detecciones
// derivadas de la posición conocida de cada trabajador animado.
// NO es un modelo entrenado ni realiza inferencia (§1, RN-06).
import type { AnalysisInput, VisionEngine, VisionResult } from "../../core/ports";
import { SCENES, sceneResults, workerDetections } from "../../modules/scenarios/data/scenes";
import type { LiveSimulator } from "../../modules/scenarios/data/liveSimulator";
import { seeded } from "../../shared/utils/id";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DemoVisionAdapter implements VisionEngine {
  readonly id = "demo";
  readonly name = "Motor de demostración (determinista)";
  readonly mode = "SIMULATED" as const;
  readonly description = "Resultados predefinidos por escenario. Sirve para enseñar el flujo; no realiza inferencia.";
  simulator?: LiveSimulator;

  async load() {}
  isReady() {
    return true;
  }

  async analyze(input: AnalysisInput, onProgress?: (s: string) => void): Promise<VisionResult> {
    const t0 = performance.now();
    if (input.live) {
      if (!this.simulator) throw new Error("El motor demo en vivo requiere la fuente simulada.");
      const t = this.simulator.now();
      const rnd = seeded(Math.floor(t * 10));
      const detections = this.simulator.workersAt(t).flatMap((w, i) => {
        // pequeña variación de cajas para que el tracking tenga trabajo real
        const j = (rnd() - 0.5) * 0.006;
        return workerDetections({ ...w, box: { ...w.box, x: Math.max(0, w.box.x + j) } }, rnd, `sim-${i}-${Math.floor(t * 10)}`);
      });
      return { mode: "SIMULATED", engine: this.name, detections, masks: [], durationMs: Math.round(performance.now() - t0) };
    }
    const scene = SCENES.find((s) => s.id === input.scenarioId);
    if (!scene) {
      throw new Error("El motor demo solo dispone de resultados para los escenarios de demostración. Use el modelo EPP real para imágenes propias.");
    }
    // Etapas simuladas de progreso (no se afirma inferencia en servidor).
    for (const s of ["Preprocesamiento (simulado)…", "Detección (simulada)…", "Segmentación (simulada)…", "Patrones…"]) {
      onProgress?.(s);
      await wait(220);
    }
    const { detections, masks } = sceneResults(scene);
    const wantMasks = input.mode === "segmentation" || input.mode === "combined";
    return {
      mode: "SIMULATED",
      engine: this.name,
      detections: input.mode === "segmentation" ? detections.filter((d) => masks.some((m) => m.box === d.box)) : detections,
      masks: wantMasks ? masks : [],
      durationMs: Math.round(performance.now() - t0),
    };
  }
}
