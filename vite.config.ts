import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTPS=1 → certificado local autofirmado para abrir la app desde el celular en la red
// (la cámara solo funciona en HTTPS o localhost).
const https = process.env.HTTPS === "1";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), ...(https ? [basicSsl()] : [])],
  server: { host: true },
  preview: { host: true },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: "jsdom", include: ["tests/unit/**/*.test.ts"] },
} as never);
