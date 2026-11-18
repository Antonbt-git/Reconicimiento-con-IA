import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Camera, CameraOff, Loader2, Pause, Play, RefreshCw, Smartphone, Square, UserPlus, Video } from "lucide-react";
import { live, listVideoSources, SIMULATOR_SOURCE, type LiveSnapshot } from "../LiveSessionController";
import { ENGINES } from "../../../app/engines";
import { SESSION_LABEL } from "../../../core/domain/sessionMachine";
import { PPE_LABEL } from "../../../core/domain/epp";
import type { VideoSource, Zone } from "../../../core/domain/types";
import type { TrackedPerson } from "../../../core/domain/tracker";
import { useCurrentUser, useDb } from "../../../shared/hooks/useDb";
import { toast } from "../../../shared/utils/bus";
import { setScreenEngineMode } from "../../../shared/utils/uiMode";
import { Badge, Button, Card, ComplianceBadge, EmptyState, Field, ModeBadge, PageHeader, PpeChip, Select, Toggle, cx, fmtMs } from "../../../shared/ui";

const COLORS = { compliant: "#16a34a", non_compliant: "#dc2626", review: "#d97706" };

function useLive(): LiveSnapshot {
  return useSyncExternalStore(live.subscribe, live.getSnapshot);
}

export default function LivePage() {
  const snap = useLive();
  const user = useCurrentUser();
  const zones = useDb((s) => s.zones);
  const classes = useDb((s) => s.classes);
  const notif = useDb((s) => s.settings.notifications);
  const requiredPpe = useDb((s) => s.settings.requiredPpe);
  const [sources, setSources] = useState<VideoSource[]>([SIMULATOR_SOURCE]);
  const [sourceId, setSourceId] = useState<string>("");
  const [engineId, setEngineId] = useState<"onnx" | "demo">("onnx");
  const [showPpe, setShowPpe] = useState(true);
  const rulesUseZones = useDb((s) => s.rules.some((r) => r.enabled && !!r.zoneId));
  const [showZones, setShowZones] = useState(rulesUseZones);
  const [starting, setStarting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isLive = snap.status === "ACTIVE" || snap.status === "PAUSED";
  const busy = snap.status === "PREPARING" || snap.status === "STOPPING" || starting;
  const canOperate = user && user.role !== "auditor";

  const refreshSources = async () => {
    const list = await listVideoSources();
    setSources(list);
    setSourceId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id ?? ""));
  };
  useEffect(() => {
    void refreshSources();
  }, []);

  const source = sources.find((s) => s.id === sourceId);
  useEffect(() => {
    setScreenEngineMode(ENGINES[engineId].mode);
    return () => setScreenEngineMode(undefined);
  }, [engineId]);
  useEffect(() => {
    if (source?.type === "camera" && engineId === "demo") setEngineId("onnx");
  }, [source, engineId]);

  async function start() {
    if (!source) return;
    setStarting(true);
    try {
      await live.start(source, ENGINES[engineId]);
      toast("success", "Sesión en vivo iniciada", `${source.name} · ${ENGINES[engineId].mode === "REAL" ? "modelo real" : "simulación"}`);
      void refreshSources(); // tras el permiso aparecen los nombres reales de las cámaras
    } catch (e) {
      toast("error", "No se pudo iniciar", (e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  // Renderizado del video + overlay en canvas (rAF), con escala "contain".
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const optsRef = useRef({ showPpe, showZones, zones, classes });
  optsRef.current = { showPpe, showZones, zones, classes };
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      const wrap = wrapRef.current;
      if (!c || !wrap) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = wrap.clientWidth;
      const vw = live.video.videoWidth || 16;
      const vh = live.video.videoHeight || 9;
      const ch = Math.min(cw * (vh / vw), window.innerHeight * 0.68);
      if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
        c.width = Math.round(cw * dpr);
        c.height = Math.round(ch * dpr);
        c.style.height = `${ch}px`;
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, cw, ch);
      const s = snapRef.current;
      if (!(s.status === "ACTIVE" || s.status === "PAUSED") || live.video.readyState < 2) return;
      const scale = Math.min(cw / vw, ch / vh);
      const W = vw * scale;
      const H = vh * scale;
      const ox = (cw - W) / 2;
      const oy = (ch - H) / 2;
      ctx.drawImage(live.video, ox, oy, W, H);
      const o = optsRef.current;
      ctx.lineWidth = 2;
      ctx.font = "600 12px Inter, sans-serif";
      if (o.showZones) drawZones(ctx, o.zones, ox, oy, W, H);
      if (o.showPpe) {
        for (const d of s.detections) {
          if (d.classId === "person") continue;
          const col = o.classes.find((k) => k.id === d.classId)?.color ?? "#64748b";
          ctx.strokeStyle = col;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(ox + d.box.x * W, oy + d.box.y * H, d.box.width * W, d.box.height * H);
          ctx.setLineDash([]);
        }
      }
      for (const t of s.tracks) drawTrack(ctx, t, ox, oy, W, H);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const tracks = snap.tracks;
  const counts = {
    ok: tracks.filter((t) => t.compliance === "compliant").length,
    bad: tracks.filter((t) => t.compliance === "non_compliant").length,
    rev: tracks.filter((t) => t.compliance === "review").length,
  };

  return (
    <div>
      <PageHeader
        title="Supervisión EPP en vivo"
        description="Seleccione una cámara (o el simulador), autorice el acceso y el sistema registrará en tiempo real si cada persona lleva casco y chaleco. Las faltas sostenidas generan alertas que se envían a su celular."
        actions={
          notif.channel === "none" ? (
            <Link to="/admin/notifications"><Button variant="secondary"><Smartphone size={16} /> Configurar alertas al celular</Button></Link>
          ) : (
            <Badge tone="green"><Smartphone size={12} /> Alertas al celular: {notif.channel}</Badge>
          )
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card>
            <div className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-[1.4fr_1fr_auto] sm:items-end">
              <Field label="Fuente de video">
                <div className="flex gap-2">
                  <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={isLive || busy}>
                    {sources.map((s) => <option key={s.id} value={s.id}>{s.type === "camera" ? "📷 " : "🧪 "}{s.name}</option>)}
                  </Select>
                  <Button size="md" variant="ghost" onClick={refreshSources} disabled={isLive || busy} aria-label="Actualizar fuentes"><RefreshCw size={16} /></Button>
                </div>
              </Field>
              <Field label="Motor">
                <Select value={engineId} onChange={(e) => setEngineId(e.target.value as "onnx" | "demo")} disabled={isLive || busy}>
                  <option value="onnx">Modelo EPP real (navegador)</option>
                  <option value="demo" disabled={source?.type === "camera"}>Simulación (solo fuente simulada)</option>
                </Select>
              </Field>
              <div className="flex flex-wrap gap-2">
                {!isLive ? (
                  <Button variant="accent" onClick={start} disabled={!source || busy || !canOperate}>
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} {busy ? snap.modelLoading ?? "Preparando…" : "Iniciar"}
                  </Button>
                ) : (
                  <>
                    {snap.status === "ACTIVE" ? (
                      <Button onClick={() => live.pause()}><Pause size={16} /> Pausar</Button>
                    ) : (
                      <Button variant="accent" onClick={() => live.resume()}><Play size={16} /> Reanudar</Button>
                    )}
                    <Button variant="danger" onClick={() => live.stop()}><Square size={16} /> Finalizar</Button>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              <StatusPill status={snap.status} />
              {snap.engine && <ModeBadge mode={snap.engine.mode} />}
              {isLive && <span className="tabular">Inferencia: {fmtMs(snap.lastInferenceMs)} · {snap.fps.toFixed(1)} análisis/s</span>}
              <span className="flex-1" />
              <Toggle checked={showPpe} onChange={setShowPpe} label="Cajas EPP" />
              <Toggle checked={showZones} onChange={setShowZones} label="Zonas" />
            </div>
          </Card>

          <Card>
            <div ref={wrapRef} className="relative p-0">
              <canvas ref={canvasRef} className="block w-full rounded-xl" aria-label="Video en vivo con detecciones superpuestas" />
              {!isLive && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <EmptyState icon={snap.status === "FAILED" ? <CameraOff size={40} /> : <Video size={40} />} title={snap.status === "FAILED" ? "La sesión no pudo continuar" : busy ? snap.modelLoading ?? "Preparando fuente…" : "Sin transmisión"}>
                    <span className="text-slate-400">{snap.error ?? "La cámara solo se activa cuando usted pulsa «Iniciar» y concede el permiso del navegador."}</span>
                  </EmptyState>
                </div>
              )}
              {isLive && (
                <div className="pointer-events-none absolute left-3 top-3 flex gap-2">
                  <span className={cx("flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold text-white", snap.status === "ACTIVE" ? "bg-red-600" : "bg-slate-600")}>
                    <span className={cx("h-2 w-2 rounded-full bg-white", snap.status === "ACTIVE" && "animate-pulse")} /> {snap.status === "ACTIVE" ? "EN VIVO" : "EN PAUSA"}
                  </span>
                  {snap.engine?.mode === "SIMULATED" && <span className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-bold text-white">SIMULACIÓN</span>}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Personas en escena" subtitle="Track ID temporal de la sesión — no identifica a la persona." action={isLive && tracks.length > 0 && (
            <Button size="sm" variant="accent" onClick={() => { const n = live.registerNow(); toast("success", "Registro EPP actualizado", `${n} persona(s) registradas desde el video.`); }}>
              <UserPlus size={14} /> Registrar ahora
            </Button>
          )}>
            <div className="grid grid-cols-3 gap-2 border-b border-slate-100 p-3 text-center">
              <Count label="Cumplen" n={counts.ok} tone="text-emerald-600" />
              <Count label="EPP incompleto" n={counts.bad} tone="text-red-600" />
              <Count label="Revisar" n={counts.rev} tone="text-amber-600" />
            </div>
            <div className="scrollbar-thin max-h-[52vh] space-y-2 overflow-y-auto p-3">
              {tracks.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">{isLive ? "Buscando personas…" : "Inicie una sesión para ver el estado de EPP en tiempo real."}</p>
              ) : (
                tracks.map((t) => (
                  <div key={t.track.id} className={cx("anim-rise rounded-lg border p-2.5", t.compliance === "non_compliant" ? "anim-pulse border-red-300" : "border-slate-200")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{t.track.id}</span>
                      <ComplianceBadge c={t.compliance} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(["helmet", "vest", "mask"] as const).map((k) => <PpeChip key={k} optional={!requiredPpe.includes(k)} label={PPE_LABEL[k]} state={t.ppe[k]} confidence={t.ppeConfidence[k]} />)}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                      <span>{t.track.hits} observaciones · {Math.round((Date.now() - t.track.firstSeenAt) / 1000)} s en escena</span>
                      <button className="font-semibold text-cyan-700 hover:underline" onClick={() => { live.registerNow(t.track.id); toast("success", `${t.track.id} registrado`); }}>Registrar</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
          {snap.session && (
            <Card title="Sesión" subtitle={snap.session.id}>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-4 text-xs">
                <dt className="text-slate-500">Fuente</dt><dd className="truncate">{snap.session.sourceName}</dd>
                <dt className="text-slate-500">Fotogramas analizados</dt><dd className="tabular">{snap.session.counters.frames}</dd>
                <dt className="text-slate-500">Tracks</dt><dd className="tabular">{snap.session.counters.tracks}</dd>
                <dt className="text-slate-500">Alertas</dt><dd className="tabular">{snap.session.counters.alerts}</dd>
              </dl>
              {(snap.status === "COMPLETED" || snap.status === "FAILED") && (
                <div className="flex gap-2 border-t border-slate-100 p-3">
                  <Link to="/persons" className="flex-1"><Button size="sm" className="w-full">Ver registro EPP</Button></Link>
                  <Button size="sm" variant="ghost" onClick={() => live.reset()}>Nueva sesión</Button>
                </div>
              )}
            </Card>
          )}
          <p className="px-1 text-[11px] leading-relaxed text-slate-400">
            El estado de cada EPP se decide por mayoría en los últimos fotogramas para evitar parpadeos. Una falta debe persistir unos segundos antes de generar alerta. Las alertas son informativas y requieren revisión humana (RN-14).
          </p>
        </div>
      </div>
    </div>
  );
}

function drawZones(ctx: CanvasRenderingContext2D, zones: Zone[], ox: number, oy: number, W: number, H: number) {
  for (const z of zones.filter((x) => x.enabled)) {
    ctx.strokeStyle = z.color;
    ctx.fillStyle = z.color + "1f";
    ctx.setLineDash([8, 6]);
    const r = [ox + z.geometry.x * W, oy + z.geometry.y * H, z.geometry.width * W, z.geometry.height * H] as const;
    ctx.fillRect(...r);
    ctx.strokeRect(...r);
    ctx.setLineDash([]);
    ctx.fillStyle = z.color;
    ctx.fillText(z.name, r[0] + 6, r[1] + 16);
  }
}

function drawTrack(ctx: CanvasRenderingContext2D, t: TrackedPerson, ox: number, oy: number, W: number, H: number) {
  const c = COLORS[t.compliance];
  const x = ox + t.track.box.x * W;
  const y = oy + t.track.box.y * H;
  const w = t.track.box.width * W;
  const h = t.track.box.height * H;
  ctx.lineWidth = 3;
  ctx.strokeStyle = c;
  if (t.track.status === "LOST") ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  const mark = (s: string) => (s === "present" ? "✓" : s === "absent" ? "✗" : "?");
  const label = `${t.track.id}  Casco ${mark(t.ppe.helmet)}  Chaleco ${mark(t.ppe.vest)}`;
  ctx.font = "700 12px Inter, sans-serif";
  const tw = ctx.measureText(label).width + 12;
  const ly = y > 22 ? y - 22 : y + h;
  ctx.fillStyle = c;
  ctx.fillRect(x, ly, tw, 20);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x + 6, ly + 14);
}

function StatusPill({ status }: { status: LiveSnapshot["status"] }) {
  const tone = status === "ACTIVE" ? "red" : status === "FAILED" ? "red" : status === "PAUSED" ? "amber" : status === "COMPLETED" ? "green" : "slate";
  return <Badge tone={tone as "red"}>{SESSION_LABEL[status]}</Badge>;
}

function Count({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div>
      <p className={cx("tabular text-xl font-bold", tone)}>{n}</p>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
