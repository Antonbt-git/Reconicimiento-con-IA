// Visor de resultados: imagen + overlay SVG con coordenadas normalizadas.
// El contenedor conserva la relación de aspecto de la imagen, por lo que cajas y
// máscaras permanecen alineadas al cambiar el tamaño del panel (§14).
import { useMemo } from "react";
import type { Detection, PersonPpe, SegmentationResult, VisionClass, Zone } from "../../../core/domain/types";
import { rleDecode } from "../../../infrastructure/vision/yolo";

export interface ViewerLayers {
  boxes: boolean;
  masks: boolean;
  persons: boolean;
  zones: boolean;
  labels: boolean;
}

const maskCache = new Map<string, string>();
function maskDataUrl(m: SegmentationResult, color: string) {
  const key = `${m.id}-${color}`;
  if (maskCache.has(key)) return maskCache.get(key)!;
  const { w, h, rle } = m.bitmap!;
  const bits = rleDecode(rle, w * h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < bits.length; i++) {
    if (!bits[i]) continue;
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  maskCache.set(key, url);
  return url;
}

const COMPLIANCE_COLOR = { compliant: "#16a34a", non_compliant: "#dc2626", review: "#d97706" };

export function ResultViewer({
  src,
  width,
  height,
  detections,
  masks,
  persons,
  zones,
  classes,
  threshold,
  layers,
  hiddenClasses,
  highlightId,
  processing,
}: {
  src: string;
  width: number;
  height: number;
  detections: Detection[];
  masks: SegmentationResult[];
  persons: PersonPpe[];
  zones: Zone[];
  classes: VisionClass[];
  threshold: number;
  layers: ViewerLayers;
  hiddenClasses: Set<string>;
  highlightId?: string;
  processing?: boolean;
}) {
  const colorOf = useMemo(() => {
    const m = new Map(classes.map((c) => [c.id, c.color]));
    return (id: string) => m.get(id) ?? "#64748b";
  }, [classes]);
  const W = width || 1280;
  const H = height || 800;
  const stroke = Math.max(2, W / 400);
  const font = Math.max(12, W / 70);
  const enabledClass = new Set(classes.filter((c) => c.enabled).map((c) => c.id));
  const visible = detections.filter((d) => !hiddenClasses.has(d.classId) && (enabledClass.has(d.classId) || !classes.some((c) => c.id === d.classId)));

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-lg bg-slate-900" style={{ aspectRatio: `${W} / ${H}`, maxHeight: "70vh" }}>
      <img src={src} alt="Imagen de entrada del análisis" className="absolute inset-0 h-full w-full object-fill" />
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={`${visible.length} detecciones superpuestas`}>
        {layers.zones &&
          zones
            .filter((z) => z.enabled)
            .map((z) => (
              <g key={z.id}>
                <rect x={z.geometry.x * W} y={z.geometry.y * H} width={z.geometry.width * W} height={z.geometry.height * H} fill={z.color} fillOpacity={0.1} stroke={z.color} strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />
                <text x={z.geometry.x * W + stroke * 3} y={z.geometry.y * H + font * 1.2} fill={z.color} fontSize={font * 0.85} fontWeight={700}>
                  {z.name}
                </text>
              </g>
            ))}
        {layers.masks &&
          masks
            .filter((m) => !hiddenClasses.has(m.classId))
            .map((m, i) =>
              m.polygon ? (
                <polygon
                  key={m.id}
                  points={m.polygon.map(([x, y]) => `${x * W},${y * H}`).join(" ")}
                  fill={colorOf(m.classId)}
                  fillOpacity={0.38}
                  stroke={colorOf(m.classId)}
                  strokeWidth={stroke * 0.6}
                  className="anim-rise"
                  style={{ animationDelay: `${i * 60}ms` }}
                />
              ) : m.bitmap ? (
                <image key={m.id} href={maskDataUrl(m, colorOf(m.classId))} x={m.box.x * W} y={m.box.y * H} width={m.box.width * W} height={m.box.height * H} preserveAspectRatio="none" opacity={0.45} style={{ imageRendering: "auto" }} />
              ) : null,
            )}
        {layers.boxes &&
          visible.map((d, i) => {
            const low = d.confidence < threshold;
            if (low) return null;
            const c = colorOf(d.classId);
            const x = d.box.x * W;
            const y = d.box.y * H;
            const label = `${d.label} ${Math.round(d.confidence * 100)}%`;
            const hl = highlightId === d.id;
            return (
              <g key={d.id} className="anim-pop" style={{ animationDelay: `${i * 40}ms` }}>
                <rect x={x} y={y} width={d.box.width * W} height={d.box.height * H} fill={hl ? c : "none"} fillOpacity={0.15} stroke={c} strokeWidth={hl ? stroke * 2 : stroke} rx={stroke} />
                {layers.labels && (
                  <>
                    <rect x={x} y={Math.max(0, y - font * 1.35)} width={label.length * font * 0.58 + font * 0.6} height={font * 1.35} fill={c} rx={stroke} />
                    <text x={x + font * 0.3} y={Math.max(font, y - font * 0.35)} fill="#fff" fontSize={font} fontWeight={600}>
                      {label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        {layers.persons &&
          persons.map((p) => {
            const c = COMPLIANCE_COLOR[p.compliance];
            const x = p.box.x * W;
            const y = (p.box.y + p.box.height) * H;
            const txt = `${p.personId} · ${p.compliance === "compliant" ? "CUMPLE" : p.compliance === "non_compliant" ? "EPP INCOMPLETO" : "REVISAR"}`;
            return (
              <g key={p.personId}>
                <rect x={x} y={p.box.y * H} width={p.box.width * W} height={p.box.height * H} fill="none" stroke={c} strokeWidth={stroke * 1.4} strokeDasharray={p.inferred ? `${stroke * 3} ${stroke * 2}` : undefined} />
                <rect x={x} y={Math.min(H - font * 1.5, y)} width={txt.length * font * 0.6 + font * 0.6} height={font * 1.5} fill={c} />
                <text x={x + font * 0.3} y={Math.min(H - font * 0.4, y + font * 1.1)} fill="#fff" fontSize={font} fontWeight={700}>
                  {txt}
                </text>
              </g>
            );
          })}
      </svg>
      {processing && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="anim-scan h-1/3 w-full bg-gradient-to-b from-transparent via-cyan-400/25 to-transparent" />
        </div>
      )}
    </div>
  );
}
