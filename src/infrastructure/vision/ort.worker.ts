// Web Worker de inferencia: ejecuta ONNX Runtime fuera del hilo de la interfaz
// para que el video y la UI permanezcan fluidos.
import * as ort from "onnxruntime-web/wasm";

type Req =
  | { id: number; type: "init"; threads: number }
  | { id: number; type: "load"; model: string; url: string }
  | { id: number; type: "run"; model: string; tensor: Float32Array; dims: number[] };

const sessions = new Map<string, ort.InferenceSession>();

self.onmessage = async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      // El binario WASM lo empaqueta Vite junto al worker (sin rutas manuales).
      ort.env.wasm.numThreads = msg.threads;
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === "load") {
      if (!sessions.has(msg.model)) {
        sessions.set(msg.model, await ort.InferenceSession.create(msg.url, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }));
      }
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === "run") {
      const s = sessions.get(msg.model);
      if (!s) throw new Error(`Modelo ${msg.model} no cargado`);
      const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", msg.tensor, msg.dims) });
      const outputs = s.outputNames.map((n) => ({ name: n, data: out[n].data as Float32Array, dims: [...out[n].dims] }));
      self.postMessage({ id: msg.id, ok: true, outputs }, { transfer: outputs.map((o) => o.data.buffer as ArrayBuffer) });
    }
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: (e as Error).message ?? String(e) });
  }
};
