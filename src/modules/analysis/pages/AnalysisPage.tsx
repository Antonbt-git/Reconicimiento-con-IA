import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ImagePlus, Layers, Loader2, Play, RotateCcw, ScanSearch, Trash2, UserCheck } from "lucide-react";
import { analyzeImage, registerAnalysisPersons } from "../../../core/application/services";
import type { Analysis, AnalysisMode } from "../../../core/domain/types";
import { PPE_LABEL } from "../../../core/domain/epp";
import { ENGINES, type EngineId } from "../../../app/engines";
import { useCurrentUser, useDb } from "../../../shared/hooks/useDb";
import { repo } from "../../../infrastructure/persistence/LocalRepository";
import { SCENES, sceneAsset } from "../../scenarios/data/scenes";
import { loadImage, validateImageFile } from "../../../shared/utils/image";
import { toast } from "../../../shared/utils/bus";
import { setScreenEngineMode } from "../../../shared/utils/uiMode";
import {
  Badge, Button, Card, ComplianceBadge, EmptyState, Field, ModeBadge, PageHeader, PpeChip, Progress, Select, SeverityBadge, Tabs, Toggle, cx, fmtMs, pct,
} from "../../../shared/ui";
import { ResultViewer, type ViewerLayers } from "../components/ResultViewer";

interface QueueItem {
  id: string;
  name: string;
  url: string;
  scenarioId?: string;
  analysisId?: string;
  error?: string;
}

const MODES: { id: AnalysisMode; label: string }[] = [
  { id: "combined", label: "Combinado (detección + segmentación + patrones)" },
  { id: "detection", label: "Solo detección" },
  { id: "segmentation", label: "Solo segmentación" },
  { id: "patterns", label: "Detección + patrones EPP" },
];

type Tab = "result" | "detections" | "masks" | "patterns";

export default function AnalysisPage() {
  const [params] = useSearchParams();
  const user = useCurrentUser();
  const settings = useDb((s) => s.settings);
  const requiredPpe = useDb((s) => s.settings.requiredPpe);
  const classes = useDb((s) => s.classes);
  const zones = useDb((s) => s.zones);
  const analyses = useDb((s) => s.analyses);
  const alerts = useDb((s) => s.alerts);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [engineId, setEngineId] = useState<EngineId>(settings.defaultEngine);
  const [mode, setMode] = useState<AnalysisMode>("combined");
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, stage: "" });
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("result");
  const [layers, setLayers] = useState<ViewerLayers>({ boxes: true, masks: true, persons: true, zones: false, labels: true });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [minConf, setMinConf] = useState(settings.confidenceThreshold);
  const [highlight, setHighlight] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const canRun = user && user.role !== "auditor";

  const active = queue.find((q) => q.id === activeId);
  const analysis: Analysis | undefined = useMemo(() => analyses.find((a) => a.id === active?.analysisId), [analyses, active]);
  const engine = ENGINES[engineId];
  useEffect(() => {
    setScreenEngineMode(engine.mode);
    return () => setScreenEngineMode(undefined);
  }, [engine]);

  // Escenario desde la galería (?scenario=)
  useEffect(() => {
    const sid = params.get("scenario");
    if (sid) pickScenario(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (!active) return;
    loadImage(active.url).then((img) => setDims({ w: img.naturalWidth, h: img.naturalHeight }));
  }, [active]);

  function pickScenario(id: string) {
    const s = SCENES.find((x) => x.id === id);
    if (!s) return;
    const item: QueueItem = { id: `q-${id}-${Date.now()}`, name: s.name, url: sceneAsset(s), scenarioId: s.id };
    setQueue((q) => [item, ...q.filter((x) => x.scenarioId !== id)]);
    setActiveId(item.id);
    setError(undefined);
    setEngineId("demo"); // los escenarios tienen resultados semilla; puede cambiar al modelo real
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const items: QueueItem[] = [];
    for (const f of Array.from(files).slice(0, 20)) {
      const err = await validateImageFile(f);
      if (err) {
        toast("error", `«${f.name}» rechazada`, err);
        continue;
      }
      items.push({ id: `q-${crypto.randomUUID().slice(0, 8)}`, name: f.name, url: URL.createObjectURL(f) });
    }
    if (!items.length) return;
    setQueue((q) => [...items, ...q]);
    setActiveId(items[0].id);
    setError(undefined);
    if (engineId === "demo") setEngineId("onnx");
  }

  async function runOne(item: QueueItem) {
    const img = await loadImage(item.url);
    const a = await analyzeImage({
      engine,
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      sourceName: item.name,
      scenarioId: item.scenarioId,
      mode,
      onProgress: (stage, p) => setProgress({ stage, pct: p }),
    });
    const n = registerAnalysisPersons(a, img, img.naturalWidth, img.naturalHeight, repo.getState().settings.storeEvidence);
    setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, analysisId: a.id, error: undefined } : x)));
    return { a, n };
  }

  async function run(all = false) {
    if (busy) return; // evita doble envío
    const targets = all ? queue.filter((q) => !q.analysisId) : active ? [active] : [];
    if (!targets.length) return;
    if (engine.mode === "SIMULATED" && targets.some((t) => !t.scenarioId)) {
      setError("El motor de demostración solo tiene resultados para los escenarios. Seleccione «Modelo EPP real» para analizar sus imágenes.");
      return;
    }
    setBusy(true);
    setError(undefined);
    let persons = 0;
    let alertsCount = 0;
    try {
      for (const t of targets) {
        setActiveId(t.id);
        setProgress({ stage: "Preparando…", pct: 3 });
        try {
          const { a, n } = await runOne(t);
          persons += n;
          alertsCount += a.alertIds.length;
        } catch (e) {
          const msg = (e as Error).message;
          setQueue((q) => q.map((x) => (x.id === t.id ? { ...x, error: msg } : x)));
          setError(msg);
          if (!all) throw e;
        }
      }
      toast(alertsCount ? "warning" : "success", "Análisis completado", `${persons} persona(s) registradas en el padrón EPP${alertsCount ? ` · ${alertsCount} alerta(s)` : ""}.`);
      setTab("result");
    } catch {
      /* el error queda visible con opción de reintento */
    } finally {
      setBusy(false);
      setProgress({ pct: 0, stage: "" });
    }
  }

  const visibleDets = (analysis?.detections ?? []).filter((d) => d.confidence >= minConf && !hidden.has(d.classId));
  const classesInResult = Array.from(new Set((analysis?.detections ?? []).map((d) => d.classId)));
  const analysisAlerts = alerts.filter((a) => a.analysisId === analysis?.id);
  const pending = queue.filter((q) => !q.analysisId).length;

  return (
    <div>
      <PageHeader
        title="Centro de análisis visual"
        description="Cargue fotografías (JPG/PNG/WEBP) o elija un escenario. El modelo EPP real detecta personas, casco, chaleco y mascarilla dentro del navegador; las imágenes no se envían a ningún servidor."
        actions={
          <>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              <ImagePlus size={16} /> Cargar imágenes
            </Button>
            <Link to="/scenarios"><Button variant="ghost">Galería de escenarios</Button></Link>
          </>
        }
      />

      {/* Barra superior: escenario, motor, modo, Analizar */}
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.3fr_auto] sm:items-end">
          <Field label="Escenario de demostración">
            <Select value={active?.scenarioId ?? ""} onChange={(e) => e.target.value && pickScenario(e.target.value)} disabled={busy}>
              <option value="">— Imagen propia / seleccionar —</option>
              {SCENES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Motor de visión">
            <Select value={engineId} onChange={(e) => setEngineId(e.target.value as EngineId)} disabled={busy}>
              <option value="onnx">Modelo EPP real (navegador)</option>
              <option value="demo">Demostración determinista (simulado)</option>
              <option value="api">Servicio backend (API)</option>
            </Select>
          </Field>
          <Field label="Perfil de análisis">
            <Select value={mode} onChange={(e) => setMode(e.target.value as AnalysisMode)} disabled={busy}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button variant="accent" onClick={() => run(false)} disabled={!active || busy || !canRun} aria-busy={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {busy ? "Procesando…" : "Analizar"}
            </Button>
            {pending > 1 && (
              <Button onClick={() => run(true)} disabled={busy || !canRun}>Analizar {pending}</Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <ModeBadge mode={engine.mode} />
          <span className="min-w-0 flex-1">{engine.description}</span>
          <Toggle checked={settings.storeEvidence} onChange={(v) => repo.update((s) => ({ settings: { ...s.settings, storeEvidence: v } }))} label="Guardar miniaturas de evidencia" />
          {!canRun && <Badge tone="amber">Rol auditor: solo lectura</Badge>}
        </div>
      </Card>

      {queue.length > 1 && (
        <div className="scrollbar-thin mb-4 flex gap-2 overflow-x-auto pb-1">
          {queue.map((q) => (
            <button key={q.id} onClick={() => !busy && setActiveId(q.id)} className={cx("relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2", q.id === activeId ? "border-accent-strong" : "border-transparent")} title={q.name}>
              <img src={q.url} alt={q.name} className="h-full w-full object-cover" />
              <span className={cx("absolute bottom-0 left-0 right-0 px-1 text-[10px] font-semibold text-white", q.error ? "bg-red-600" : q.analysisId ? "bg-emerald-600" : "bg-slate-700/80")}>
                {q.error ? "Error" : q.analysisId ? "Analizada" : "Pendiente"}
              </span>
            </button>
          ))}
          <button onClick={() => { setQueue([]); setActiveId(undefined); }} disabled={busy} className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-red-500" aria-label="Vaciar cola">
            <Trash2 size={16} />
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <div className="p-3">
            {!active ? (
              <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 py-16 text-center hover:border-accent hover:bg-cyan-50/40">
                <ScanSearch size={40} className="text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">Cargue una o varias fotos de trabajadores, o elija un escenario</p>
                <p className="mt-1 text-xs text-slate-500">JPG, PNG o WEBP · máx. 15 MB · se validan tipo y contenido del archivo</p>
              </button>
            ) : (
              <ResultViewer
                src={active.url}
                width={dims.w}
                height={dims.h}
                detections={analysis?.detections ?? []}
                masks={analysis?.masks ?? []}
                persons={analysis?.persons ?? []}
                zones={zones}
                classes={classes}
                threshold={minConf}
                layers={layers}
                hiddenClasses={hidden}
                highlightId={highlight}
                processing={busy}
              />
            )}
            {busy && <div className="mt-3"><Progress value={progress.pct} label={progress.stage} /></div>}
            {error && !busy && (
              <div role="alert" className="mt-3 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <div className="flex-1">{error}</div>
                <Button size="sm" onClick={() => run(false)}><RotateCcw size={14} /> Reintentar</Button>
              </div>
            )}
          </div>
          {active && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2.5">
              <Layers size={14} className="text-slate-400" />
              {(["boxes", "masks", "persons", "labels", "zones"] as const).map((k) => (
                <Toggle key={k} checked={layers[k]} onChange={(v) => setLayers((l) => ({ ...l, [k]: v }))} label={{ boxes: "Cajas", masks: "Máscaras", persons: "Personas / EPP", labels: "Etiquetas", zones: "Zonas" }[k]} />
              ))}
            </div>
          )}
        </Card>

        <Card className="flex min-h-[420px] flex-col">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "result", label: `Resultado${analysis ? ` (${analysis.persons.length})` : ""}` },
              { id: "detections", label: `Detecciones${analysis ? ` (${visibleDets.length})` : ""}` },
              { id: "masks", label: `Máscaras${analysis ? ` (${analysis.masks.length})` : ""}` },
              { id: "patterns", label: `Patrones${analysis ? ` (${analysis.patterns.length})` : ""}` },
            ]}
          />
          <div className="scrollbar-thin flex-1 overflow-y-auto">
            {!analysis ? (
              <EmptyState icon={<ScanSearch size={32} />} title={active ? "Listo para analizar" : "Sin resultados"}>
                {active ? "Pulse «Analizar» para ejecutar el motor seleccionado." : "Seleccione una imagen o un escenario para comenzar."}
              </EmptyState>
            ) : analysis.status === "failed" ? (
              <EmptyState icon={<AlertTriangle size={32} />} title="El análisis falló">{analysis.error}</EmptyState>
            ) : (
              <>
                {tab === "result" && (
                  <div className="space-y-3 p-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Metric label="Personas" value={analysis.persons.length} />
                      <Metric label="Confianza media" value={pct(analysis.averageConfidence)} />
                      <Metric label="Duración" value={fmtMs(analysis.durationMs)} />
                    </div>
                    <div className="flex items-center justify-between">
                      <ModeBadge mode={analysis.engineMode} />
                      <span className="text-[11px] text-slate-400">{analysis.id}</span>
                    </div>
                    {analysis.persons.length === 0 && (
                      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No se detectaron personas sobre el umbral ({pct(settings.confidenceThreshold)}). Pruebe con una imagen más cercana o con mejor iluminación.</p>
                    )}
                    {analysis.persons.map((p) => (
                      <div key={p.personId} className={cx("rounded-lg border p-3", p.compliance === "non_compliant" ? "border-red-200 bg-red-50/40" : p.compliance === "review" ? "border-amber-200 bg-amber-50/40" : "border-emerald-200 bg-emerald-50/40")}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{p.personId}{p.inferred && <span className="ml-1 text-xs font-normal text-slate-500">(inferida por EPP)</span>}</p>
                          <ComplianceBadge c={p.compliance} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(["helmet", "vest", "mask"] as const).map((k) => <PpeChip key={k} optional={!requiredPpe.includes(k)} label={PPE_LABEL[k]} state={p.ppe[k].state} confidence={p.ppe[k].confidence} />)}
                        </div>
                        {p.missing.length > 0 && <p className="mt-2 text-xs text-red-700">Falta: {p.missing.map((m) => PPE_LABEL[m].toLowerCase()).join(", ")} — requiere verificación humana.</p>}
                      </div>
                    ))}
                    {analysis.persons.length > 0 && (
                      <Link to="/persons" className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 py-2 text-xs font-semibold text-navy-800 hover:bg-slate-100">
                        <UserCheck size={14} /> Ver en el registro EPP de personas
                      </Link>
                    )}
                    {analysisAlerts.length > 0 && (
                      <div className="space-y-2 border-t border-slate-100 pt-3">
                        <p className="text-xs font-semibold text-slate-600">Alertas generadas</p>
                        {analysisAlerts.map((a) => (
                          <Link key={a.id} to={`/alerts?id=${a.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-xs hover:bg-slate-50">
                            <span className="min-w-0 truncate">{a.message}</span>
                            <SeverityBadge s={a.severity} />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {tab === "detections" && (
                  <div>
                    <div className="space-y-2 border-b border-slate-100 p-3">
                      <Field label={`Confianza mínima: ${pct(minConf)}`}>
                        <input type="range" min={0.1} max={0.95} step={0.05} value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} className="w-full accent-cyan-700" />
                      </Field>
                      <div className="flex flex-wrap gap-1">
                        {classesInResult.map((c) => {
                          const cl = classes.find((x) => x.id === c);
                          const off = hidden.has(c);
                          return (
                            <button key={c} onClick={() => setHidden((h) => { const n = new Set(h); if (off) n.delete(c); else n.add(c); return n; })} className={cx("flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium", off ? "border-slate-200 text-slate-400 line-through" : "border-slate-300 text-slate-700")} aria-pressed={!off}>
                              <span className="h-2 w-2 rounded-sm" style={{ background: cl?.color }} /> {cl?.name ?? c}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                        <tr><th className="px-3 py-2">Clase</th><th className="px-2 py-2">Conf.</th><th className="px-2 py-2">x, y, w, h</th></tr>
                      </thead>
                      <tbody>
                        {analysis.detections.filter((d) => !hidden.has(d.classId)).sort((a, b) => b.confidence - a.confidence).map((d) => (
                          <tr key={d.id} onMouseEnter={() => setHighlight(d.id)} onMouseLeave={() => setHighlight(undefined)} className={cx("border-t border-slate-100", d.confidence < minConf && "text-slate-400")}>
                            <td className="px-3 py-1.5"><span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: classes.find((c) => c.id === d.classId)?.color }} />{d.label}{d.confidence < minConf && <span className="ml-1 text-[10px]">(baja)</span>}</td>
                            <td className="tabular px-2 py-1.5">{pct(d.confidence)}</td>
                            <td className="tabular px-2 py-1.5 font-mono text-[10px]">{[d.box.x, d.box.y, d.box.width, d.box.height].map((n) => n.toFixed(3)).join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {tab === "masks" && (
                  <div className="space-y-2 p-4">
                    <p className="text-xs text-slate-500">La <b>detección</b> delimita con un rectángulo; la <b>segmentación</b> marca los píxeles que pertenecen a cada instancia.</p>
                    {analysis.masks.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Sin máscaras. Use el perfil «Combinado» o «Solo segmentación».</p>}
                    {analysis.masks.map((m, i) => (
                      <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2 text-xs">
                        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: classes.find((c) => c.id === m.classId)?.color }} />{m.label} #{i + 1}</span>
                        <span className="tabular text-slate-500">área {(m.areaRatio * 100).toFixed(1)}% · conf. {pct(m.confidence)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {tab === "patterns" && (
                  <div className="space-y-2 p-4">
                    {analysis.patterns.length === 0 && <p className="text-xs text-slate-500">Sin patrones para este perfil.</p>}
                    {analysis.patterns.map((p) => (
                      <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold">{p.label}</p>
                          <Badge tone={p.status === "review" ? "amber" : "green"}>{p.status === "review" ? "Revisar" : "Detectado"}</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{p.evidence}</p>
                        <p className="mt-1 font-mono text-[10px] text-slate-400">{p.type} · conf. {pct(p.confidence)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <p className="tabular text-lg font-bold text-navy-900">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
