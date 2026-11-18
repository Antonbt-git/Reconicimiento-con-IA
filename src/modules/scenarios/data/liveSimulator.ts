// Fuente de video SIMULADA: anima trabajadores en una obra y entrega un
// MediaStream (canvas.captureStream) que recorre el mismo flujo que una cámara.
import { drawBackground, drawWorker, type Worker } from "./scenes";

interface Walker {
  helmet: boolean;
  vest: boolean;
  shirt: string;
  helmetColor: string;
  speed: number; // fracción de ancho por segundo
  phase: number;
  y: number;
  h: number;
}

const WALKERS: Walker[] = [
  { helmet: true, vest: true, shirt: "#1d4ed8", helmetColor: "#facc15", speed: 0.05, phase: 0.0, y: 0.32, h: 0.6 },
  { helmet: false, vest: true, shirt: "#1e3a8a", helmetColor: "#facc15", speed: 0.035, phase: 0.45, y: 0.3, h: 0.62 },
  { helmet: true, vest: false, shirt: "#475569", helmetColor: "#f8fafc", speed: 0.06, phase: 0.75, y: 0.35, h: 0.56 },
];

export class LiveSimulator {
  readonly width = 960;
  readonly height = 600;
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private start = performance.now();
  private pausedAt: number | undefined;
  private stream?: MediaStream;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  /** Tiempo de simulación (s), congelado durante la pausa. */
  now() {
    return ((this.pausedAt ?? performance.now()) - this.start) / 1000;
  }

  workersAt(t = this.now()): Worker[] {
    return WALKERS.map((w) => {
      const width = w.h * 0.25;
      // vaivén de izquierda a derecha
      const span = 1 - width;
      const u = (t * w.speed + w.phase) % 2;
      const x = (u < 1 ? u : 2 - u) * span;
      const bob = Math.sin(t * 6 + w.phase * 10) * 0.004;
      return {
        box: { x, y: w.y + bob, width, height: w.h },
        helmet: w.helmet,
        vest: w.vest,
        shirt: w.shirt,
        helmetColor: w.helmetColor,
      };
    });
  }

  private draw = () => {
    const ctx = this.canvas.getContext("2d")!;
    drawBackground(ctx, "industrial", this.width, this.height);
    this.workersAt().forEach((w) => drawWorker(ctx, w, this.width, this.height));
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    ctx.fillRect(10, this.height - 38, 250, 28);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 15px Inter, sans-serif";
    ctx.fillText("FUENTE SIMULADA · " + new Date().toLocaleTimeString(), 18, this.height - 19);
    this.raf = requestAnimationFrame(this.draw);
  };

  startStream(fps = 24): MediaStream {
    this.start = performance.now();
    this.draw();
    this.stream = this.canvas.captureStream(fps);
    return this.stream;
  }

  pause() {
    this.pausedAt ??= performance.now();
  }

  resume() {
    if (this.pausedAt !== undefined) {
      this.start += performance.now() - this.pausedAt;
      this.pausedAt = undefined;
    }
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }
}
