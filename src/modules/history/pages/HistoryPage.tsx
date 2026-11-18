import { useMemo, useState } from "react";
import { Download, History as HistoryIcon } from "lucide-react";
import { useDb } from "../../../shared/hooks/useDb";
import { recordExport } from "../../../core/application/services";
import { SESSION_LABEL } from "../../../core/domain/sessionMachine";
import type { Analysis, VideoSession } from "../../../core/domain/types";
import { downloadCsv, toCsv } from "../../../infrastructure/export/csv";
import { SCENES } from "../../scenarios/data/scenes";
import { PPE_LABEL } from "../../../core/domain/epp";
import { Badge, Button, Card, ComplianceBadge, EmptyState, Field, Input, Modal, ModeBadge, PageHeader, PpeChip, Select, Tabs, fmtDate, fmtMs, pct } from "../../../shared/ui";

type Tab = "analyses" | "sessions" | "events";

export default function HistoryPage() {
  const analyses = useDb((s) => s.analyses);
  const sessions = useDb((s) => s.sessions);
  const events = useDb((s) => s.events);
  const requiredPpe = useDb((s) => s.settings.requiredPpe);
  const [tab, setTab] = useState<Tab>("analyses");
  const [q, setQ] = useState("");
  const [scenario, setScenario] = useState("");
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState<Analysis>();
  const [sDetail, setSDetail] = useState<VideoSession>();

  const inDate = (iso: string) => (!from || iso >= from) && (!to || iso.slice(0, 10) <= to);
  const an = useMemo(
    () => analyses.filter((a) => inDate(a.createdAt) && (!scenario || (scenario === "_own" ? !a.scenarioId : a.scenarioId === scenario)) && (!status || a.status === status) && (!mode || a.engineMode === mode) && (!q || `${a.id} ${a.sourceName} ${a.createdBy}`.toLowerCase().includes(q.toLowerCase()))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analyses, q, scenario, status, mode, from, to],
  );
  const se = useMemo(
    () => sessions.filter((s) => inDate(s.startedAt) && (!status || s.status === status) && (!mode || s.engineMode === mode) && (!q || `${s.id} ${s.sourceName}`.toLowerCase().includes(q.toLowerCase()))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, q, status, mode, from, to],
  );
  const ev = useMemo(
    () => events.filter((e) => inDate(e.occurredAt) && (!mode || e.mode === mode) && (!status || e.type === status) && (!q || `${e.id} ${e.description} ${e.sessionId ?? ""} ${e.analysisId ?? ""}`.toLowerCase().includes(q.toLowerCase()))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, q, status, mode, from, to],
  );

  function exportCsv() {
    const filters = JSON.stringify({ q, scenario, status, mode, from, to });
    if (tab === "analyses") {
      // Una fila por detección: identificador, fecha, escenario, clase, confianza y estado.
      const rows = an.flatMap((a) => {
        const base = { analisis_id: a.id, fecha: a.createdAt, escenario: SCENES.find((s) => s.id === a.scenarioId)?.name ?? "Imagen propia", fuente: a.sourceName, modo: a.engineMode, motor: a.engineName, estado: a.status, duracion_ms: a.durationMs, usuario: a.createdBy };
        return a.detections.length ? a.detections.map((d) => ({ ...base, deteccion_id: d.id, clase: d.label, confianza: d.confidence, sobre_umbral: d.confidence >= a.threshold ? "si" : "no", x: d.box.x, y: d.box.y, w: d.box.width, h: d.box.height })) : [{ ...base }];
      });
      downloadCsv(`historial-analisis-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
      recordExport("Analysis", filters, rows.length);
    } else if (tab === "sessions") {
      const rows = se.map((s) => ({ sesion_id: s.id, inicio: s.startedAt, fin: s.endedAt ?? "", fuente: s.sourceName, tipo: s.sourceType, modo: s.engineMode, estado: s.status, duracion_ms: s.durationMs, fotogramas: s.counters.frames, detecciones: s.counters.detections, tracks: s.counters.tracks, alertas: s.counters.alerts, cumplen: s.compliance.compliant, incompletos: s.compliance.non_compliant, revisar: s.compliance.review, error: s.error ?? "" }));
      downloadCsv(`historial-sesiones-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
      recordExport("VideoSession", filters, rows.length);
    } else {
      const rows = ev.map((e) => ({ evento_id: e.id, fecha: e.occurredAt, tipo: e.type, descripcion: e.description, sesion: e.sessionId ?? "", analisis: e.analysisId ?? "", regla: e.ruleId ?? "", track: e.trackId ?? "", modo: e.mode }));
      downloadCsv(`historial-eventos-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
      recordExport("Event", filters, rows.length);
    }
  }

  const statusOptions =
    tab === "analyses" ? [["completed", "Completado"], ["failed", "Fallido"], ["processing", "En proceso"]] :
    tab === "sessions" ? (["COMPLETED", "FAILED", "ACTIVE", "PAUSED"] as const).map((s) => [s, SESSION_LABEL[s]]) :
    Array.from(new Set(events.map((e) => e.type))).map((t) => [t, t]);

  return (
    <div>
      <PageHeader title="Historial" description="Metadatos de análisis, sesiones y eventos. No se almacenan videos ni imágenes salvo las miniaturas de evidencia que usted habilite." actions={<Button onClick={exportCsv}><Download size={16} /> Exportar CSV</Button>} />
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Buscar"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID, fuente, usuario…" /></Field>
          <Field label="Escenario">
            <Select value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={tab !== "analyses"}>
              <option value="">Todos</option><option value="_own">Imágenes propias</option>
              {SCENES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label={tab === "events" ? "Tipo" : "Estado"}><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{statusOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Modo"><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Todos</option><option value="REAL">Modelo real</option><option value="SIMULATED">Simulación</option></Select></Field>
          <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </Card>
      <Card>
        <Tabs<Tab> value={tab} onChange={(t) => { setTab(t); setStatus(""); }} tabs={[{ id: "analyses", label: `Análisis (${an.length})` }, { id: "sessions", label: `Sesiones en vivo (${se.length})` }, { id: "events", label: `Eventos (${ev.length})` }]} />
        <div className="scrollbar-thin overflow-x-auto">
          {tab === "analyses" && (an.length ? (
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">ID / fecha</th><th className="px-3 py-2">Fuente</th><th className="px-3 py-2">Modo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Detecciones</th><th className="px-3 py-2">Personas</th><th className="px-3 py-2">Alertas</th><th className="px-3 py-2">Duración</th></tr></thead>
              <tbody>
                {an.slice(0, 300).map((a) => (
                  <tr key={a.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setDetail(a)}>
                    <td className="px-3 py-2"><p className="font-mono font-semibold">{a.id}</p><p className="text-slate-400">{fmtDate(a.createdAt)}</p></td>
                    <td className="px-3 py-2"><p className="max-w-[220px] truncate">{a.sourceName}</p><p className="text-slate-400">{a.createdBy}</p></td>
                    <td className="px-3 py-2"><ModeBadge mode={a.engineMode} compact /></td>
                    <td className="px-3 py-2"><Badge tone={a.status === "completed" ? "green" : a.status === "failed" ? "red" : "amber"}>{a.status}</Badge></td>
                    <td className="tabular px-3 py-2">{a.detections.filter((d) => d.confidence >= a.threshold).length}</td>
                    <td className="tabular px-3 py-2">{a.persons.length} <span className="text-red-600">{a.persons.filter((p) => p.compliance === "non_compliant").length ? `(${a.persons.filter((p) => p.compliance === "non_compliant").length} incompl.)` : ""}</span></td>
                    <td className="tabular px-3 py-2">{a.alertIds.length}</td>
                    <td className="tabular px-3 py-2">{fmtMs(a.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={<HistoryIcon size={30} />} title="Sin análisis para los filtros" />)}
          {tab === "sessions" && (se.length ? (
            <table className="w-full min-w-[820px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Sesión</th><th className="px-3 py-2">Fuente</th><th className="px-3 py-2">Modo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Duración</th><th className="px-3 py-2">Personas</th><th className="px-3 py-2">Alertas</th></tr></thead>
              <tbody>
                {se.slice(0, 300).map((s) => (
                  <tr key={s.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setSDetail(s)}>
                    <td className="px-3 py-2"><p className="font-mono font-semibold">{s.id}</p><p className="text-slate-400">{fmtDate(s.startedAt)}</p></td>
                    <td className="px-3 py-2">{s.sourceName}</td>
                    <td className="px-3 py-2"><ModeBadge mode={s.engineMode} compact /></td>
                    <td className="px-3 py-2"><Badge tone={s.status === "COMPLETED" ? "green" : s.status === "FAILED" ? "red" : "amber"}>{SESSION_LABEL[s.status]}</Badge></td>
                    <td className="tabular px-3 py-2">{s.durationMs ? fmtMs(s.durationMs) : "—"}</td>
                    <td className="tabular px-3 py-2">{s.counters.tracks} <span className="text-slate-400">({s.compliance.compliant}✓ {s.compliance.non_compliant}✗ {s.compliance.review}?)</span></td>
                    <td className="tabular px-3 py-2">{s.counters.alerts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={<HistoryIcon size={30} />} title="Sin sesiones para los filtros" />)}
          {tab === "events" && (ev.length ? (
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2">Origen</th><th className="px-3 py-2">Modo</th></tr></thead>
              <tbody>
                {ev.slice(0, 500).map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">{fmtDate(e.occurredAt)}</td>
                    <td className="px-3 py-2 font-mono">{e.type}</td>
                    <td className="px-3 py-2">{e.description}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{e.sessionId ?? e.analysisId}</td>
                    <td className="px-3 py-2"><ModeBadge mode={e.mode} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={<HistoryIcon size={30} />} title="Sin eventos para los filtros" />)}
        </div>
      </Card>

      {detail && (
        <Modal open onClose={() => setDetail(undefined)} title={`Análisis ${detail.id}`} wide>
          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            <div className="space-y-2 text-xs">
              {detail.thumbnail && <img src={detail.thumbnail} alt="" className="w-full rounded" />}
              <ModeBadge mode={detail.engineMode} />
              <p><b>Fuente:</b> {detail.sourceName}</p>
              <p><b>Motor:</b> {detail.engineName}</p>
              <p><b>Perfil:</b> {detail.mode} · <b>Umbral:</b> {pct(detail.threshold)}</p>
              <p><b>Duración:</b> {fmtMs(detail.durationMs)} · <b>Confianza media:</b> {pct(detail.averageConfidence)}</p>
              {detail.error && <p className="text-red-600">{detail.error}</p>}
            </div>
            <div className="space-y-2">
              {detail.persons.map((p) => (
                <div key={p.personId} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                  <span className="font-mono text-xs font-semibold">{p.personId}</span>
                  <ComplianceBadge c={p.compliance} />
                  {(["helmet", "vest", "mask"] as const).map((k) => <PpeChip key={k} optional={!requiredPpe.includes(k)} label={PPE_LABEL[k]} state={p.ppe[k].state} confidence={p.ppe[k].confidence} />)}
                </div>
              ))}
              <p className="pt-2 text-xs font-semibold text-slate-600">Detecciones ({detail.detections.length} brutas)</p>
              <div className="flex flex-wrap gap-1">
                {detail.detections.map((d) => <Badge key={d.id} tone={d.confidence >= detail.threshold ? "cyan" : "slate"}>{d.label} {pct(d.confidence)}</Badge>)}
              </div>
              {detail.patterns.length > 0 && <p className="pt-2 text-xs font-semibold text-slate-600">Patrones</p>}
              {detail.patterns.map((p) => <p key={p.id} className="text-xs">• {p.label} — <span className="text-slate-500">{p.evidence}</span></p>)}
            </div>
          </div>
        </Modal>
      )}
      {sDetail && (
        <Modal open onClose={() => setSDetail(undefined)} title={`Sesión ${sDetail.id}`}>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5 text-xs">
            <dt className="text-slate-500">Fuente</dt><dd>{sDetail.sourceName} ({sDetail.sourceType})</dd>
            <dt className="text-slate-500">Motor</dt><dd>{sDetail.engineName}</dd>
            <dt className="text-slate-500">Estado</dt><dd>{SESSION_LABEL[sDetail.status]}</dd>
            <dt className="text-slate-500">Inicio / fin</dt><dd>{fmtDate(sDetail.startedAt)} → {sDetail.endedAt ? fmtDate(sDetail.endedAt) : "—"}</dd>
            <dt className="text-slate-500">Duración efectiva</dt><dd>{fmtMs(sDetail.durationMs)} (pausa {fmtMs(sDetail.pausedMs)})</dd>
            <dt className="text-slate-500">Fotogramas</dt><dd>{sDetail.counters.frames}</dd>
            <dt className="text-slate-500">Detecciones</dt><dd>{sDetail.counters.detections}</dd>
            <dt className="text-slate-500">Personas (tracks)</dt><dd>{sDetail.counters.tracks}</dd>
            <dt className="text-slate-500">Cumplimiento</dt><dd>{sDetail.compliance.compliant} cumplen · {sDetail.compliance.non_compliant} incompletos · {sDetail.compliance.review} revisar</dd>
            <dt className="text-slate-500">Alertas</dt><dd>{sDetail.counters.alerts}</dd>
            {sDetail.error && (<><dt className="text-slate-500">Error</dt><dd className="text-red-600">{sDetail.error}</dd></>)}
          </dl>
        </Modal>
      )}
    </div>
  );
}
