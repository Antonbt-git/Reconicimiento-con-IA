// Visión IA: Detecciones · Segmentación · Patrones (vistas agregadas de los análisis almacenados).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Shapes, Sparkles } from "lucide-react";
import { useDb } from "../../../shared/hooks/useDb";
import { Badge, Card, EmptyState, Field, Input, ModeBadge, PageHeader, Select, fmtDate, pct } from "../../../shared/ui";

export function DetectionsPage() {
  const analyses = useDb((s) => s.analyses);
  const classes = useDb((s) => s.classes);
  const [cls, setCls] = useState("");
  const [min, setMin] = useState(0.4);
  const [mode, setMode] = useState("");
  const [from, setFrom] = useState("");
  const rows = useMemo(
    () =>
      analyses
        .filter((a) => a.status === "completed" && (!mode || a.engineMode === mode) && (!from || a.createdAt >= from))
        .flatMap((a) => a.detections.map((d) => ({ ...d, a })))
        .filter((d) => (!cls || d.classId === cls) && d.confidence >= min),
    [analyses, cls, min, mode, from],
  );
  return (
    <div>
      <PageHeader title="Detecciones" description="Cada detección contiene clase, confianza y una caja delimitadora (x, y, ancho, alto) en coordenadas normalizadas 0–1." />
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Clase"><Select value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Todas</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label={`Confianza mínima: ${pct(min)}`}><input type="range" min={0} max={0.95} step={0.05} value={min} onChange={(e) => setMin(Number(e.target.value))} className="mt-2 w-full accent-cyan-700" /></Field>
          <Field label="Modo"><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Todos</option><option value="REAL">Modelo real</option><option value="SIMULATED">Simulación</option></Select></Field>
          <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        </div>
      </Card>
      <Card>
        {!rows.length ? <EmptyState icon={<Boxes size={30} />} title="Sin detecciones">Ejecute un <Link className="text-cyan-700 underline" to="/analysis">análisis</Link>.</EmptyState> : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Clase</th><th className="px-3 py-2">Confianza</th><th className="px-3 py-2">Caja (x, y, w, h)</th><th className="px-3 py-2">Análisis</th><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Modo</th></tr></thead>
              <tbody>
                {rows.slice(0, 600).map((d) => (
                  <tr key={`${d.a.id}-${d.id}`} className="border-t border-slate-100">
                    <td className="px-3 py-1.5"><span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: classes.find((c) => c.id === d.classId)?.color }} />{d.label}</td>
                    <td className="tabular px-3 py-1.5">{pct(d.confidence)}{d.confidence < d.a.threshold && <span className="ml-1 text-slate-400">(baja)</span>}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{[d.box.x, d.box.y, d.box.width, d.box.height].map((n) => n.toFixed(3)).join(", ")}</td>
                    <td className="px-3 py-1.5 font-mono">{d.a.id}</td>
                    <td className="px-3 py-1.5">{fmtDate(d.a.createdAt)}</td>
                    <td className="px-3 py-1.5"><ModeBadge mode={d.a.engineMode} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function SegmentationPage() {
  const analyses = useDb((s) => s.analyses);
  const classes = useDb((s) => s.classes);
  const rows = analyses.filter((a) => a.masks.length);
  return (
    <div>
      <PageHeader title="Segmentación" description="La segmentación de instancias asigna píxeles a cada objeto. El modelo real segmenta personas (YOLOv8n-seg, COCO); los escenarios demo incluyen máscaras de personas, productos y defectos." />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {[
          ["Semántica", "Una máscara por clase; todos los píxeles de la clase comparten etiqueta."],
          ["Instancia", "Una máscara por objeto — usada aquí para contar personas sin fusionarlas."],
          ["Panóptica", "Combina regiones semánticas e instancias (evolución futura)."],
        ].map(([t, d]) => <Card key={t}><div className="p-4"><p className="text-sm font-semibold">{t}</p><p className="mt-1 text-xs text-slate-500">{d}</p></div></Card>)}
      </div>
      <Card>
        {!rows.length ? <EmptyState icon={<Shapes size={30} />} title="Sin máscaras">Use el perfil «Combinado» o «Solo segmentación» en el <Link className="text-cyan-700 underline" to="/analysis">centro de análisis</Link>.</EmptyState> : (
          <ul className="divide-y divide-slate-100">
            {rows.slice(0, 200).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{a.sourceName}</p><p className="text-[11px] text-slate-400">{a.id} · {fmtDate(a.createdAt)}</p></div>
                <div className="flex flex-wrap gap-1">
                  {a.masks.map((m) => <Badge key={m.id}><span className="h-2 w-2 rounded-sm" style={{ background: classes.find((c) => c.id === m.classId)?.color }} />{m.label} · {(m.areaRatio * 100).toFixed(1)}%</Badge>)}
                </div>
                <ModeBadge mode={a.engineMode} compact />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function PatternsPage() {
  const analyses = useDb((s) => s.analyses);
  const [type, setType] = useState("");
  const all = analyses.flatMap((a) => a.patterns.map((p) => ({ ...p, a })));
  const types = Array.from(new Set(all.map((p) => p.type)));
  const rows = all.filter((p) => !type || p.type === type);
  const LABEL: Record<string, string> = { EPP_COMPLETE: "EPP completo", EPP_INCOMPLETE: "EPP incompleto", EPP_REVIEW: "EPP por revisar", DEFECT: "Producto defectuoso", QUALITY_OK: "Producto conforme", LOW_CONFIDENCE: "Baja confianza", ZONE_INTRUSION: "Persona en zona", INVALID_PAYLOAD: "Datos inválidos" };
  return (
    <div>
      <PageHeader title="Reconocimiento de patrones" description="Patrones derivados de las detecciones: uso de casco/chaleco, producto defectuoso, baja confianza. La confianza es una estimación; las decisiones requieren validación humana." />
      <Card className="mb-4"><div className="p-4 sm:w-72"><Field label="Tipo de patrón"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos</option>{types.map((t) => <option key={t} value={t}>{LABEL[t] ?? t}</option>)}</Select></Field></div></Card>
      <Card>
        {!rows.length ? <EmptyState icon={<Sparkles size={30} />} title="Sin patrones" /> : (
          <ul className="divide-y divide-slate-100">
            {rows.slice(0, 400).map((p) => (
              <li key={`${p.a.id}-${p.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Badge tone={p.type === "EPP_INCOMPLETE" || p.type === "DEFECT" ? "red" : p.status === "review" ? "amber" : "green"}>{LABEL[p.type] ?? p.type}</Badge>
                <div className="min-w-0 flex-1"><p className="text-xs font-medium">{p.label}</p><p className="text-[11px] text-slate-500">{p.evidence}</p></div>
                <span className="text-[11px] text-slate-400">{p.a.id} · {fmtDate(p.a.createdAt)}</span>
                <ModeBadge mode={p.a.engineMode} compact />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
