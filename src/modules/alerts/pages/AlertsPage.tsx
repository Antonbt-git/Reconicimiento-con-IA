import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BellOff, Download, Send, Smartphone } from "lucide-react";
import { useCurrentUser, useDb } from "../../../shared/hooks/useDb";
import { assignAlert, notifyAlert, recordExport, thumbnailBlob, updateAlertStatus } from "../../../core/application/services";
import { ALERT_LABEL, canTransitionAlert } from "../../../core/domain/sessionMachine";
import type { Alert, AlertStatus, Severity } from "../../../core/domain/types";
import { downloadCsv, toCsv } from "../../../infrastructure/export/csv";
import { toast } from "../../../shared/utils/bus";
import { Badge, Button, Card, EmptyState, Field, Modal, ModeBadge, PageHeader, Select, SeverityBadge, cx, fmtDate } from "../../../shared/ui";

export default function AlertsPage() {
  const alerts = useDb((s) => s.alerts);
  const rules = useDb((s) => s.rules);
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<"" | AlertStatus>("");
  const [sev, setSev] = useState<"" | Severity>("");
  const [rule, setRule] = useState("");
  const [mode, setMode] = useState("");
  const openId = params.get("id") ?? undefined;
  const open = alerts.find((a) => a.id === openId);

  const rows = useMemo(
    () => alerts.filter((a) => (!status || a.status === status) && (!sev || a.severity === sev) && (!rule || a.ruleId === rule) && (!mode || a.mode === mode)),
    [alerts, status, sev, rule, mode],
  );

  function exportCsv() {
    const data = rows.map((a) => ({ id: a.id, fecha: a.createdAt, regla: a.ruleName, severidad: a.severity, estado: a.status, mensaje: a.message, persona: a.personCode ?? "", modo: a.mode, responsable: a.assignedTo ?? "", revisado_por: a.reviewedBy ?? "", nota: a.note ?? "", celular: a.notified ?? "", analisis: a.analysisId ?? "", sesion: a.sessionId ?? "" }));
    downloadCsv(`alertas-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data));
    recordExport("Alert", JSON.stringify({ status, sev, rule, mode }), data.length);
  }

  return (
    <div>
      <PageHeader title="Alertas" description="Cada alerta se origina en un evento de regla y requiere revisión humana. Estados: Nueva → En revisión → Cerrada (una alerta cerrada no se reabre)." actions={<Button onClick={exportCsv} disabled={!rows.length}><Download size={16} /> Exportar CSV</Button>} />
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Estado"><Select value={status} onChange={(e) => setStatus(e.target.value as AlertStatus | "")}><option value="">Todos</option>{(["NEW", "IN_REVIEW", "CLOSED"] as const).map((s) => <option key={s} value={s}>{ALERT_LABEL[s]}</option>)}</Select></Field>
          <Field label="Severidad"><Select value={sev} onChange={(e) => setSev(e.target.value as Severity | "")}><option value="">Todas</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></Select></Field>
          <Field label="Regla"><Select value={rule} onChange={(e) => setRule(e.target.value)}><option value="">Todas</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <Field label="Modo"><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Todos</option><option value="REAL">Modelo real</option><option value="SIMULATED">Simulación</option></Select></Field>
        </div>
      </Card>
      <Card>
        {!rows.length ? (
          <EmptyState icon={<BellOff size={32} />} title="Sin alertas">Las alertas aparecerán cuando una regla se cumpla (p. ej., una persona sin casco).</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.slice(0, 300).map((a) => (
              <li key={a.id}>
                <button onClick={() => setParams({ id: a.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  {a.thumbnail ? <img src={a.thumbnail} alt="" className="h-11 w-16 shrink-0 rounded object-cover" /> : <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", a.status === "NEW" ? "anim-pulse bg-red-500" : a.status === "IN_REVIEW" ? "bg-amber-500" : "bg-slate-300")} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.message}</p>
                    <p className="text-[11px] text-slate-500">{fmtDate(a.createdAt)} · {a.ruleName} · {a.sessionId ?? a.analysisId}</p>
                  </div>
                  <NotifyBadge a={a} />
                  <ModeBadge mode={a.mode} compact />
                  <SeverityBadge s={a.severity} />
                  <Badge tone={a.status === "NEW" ? "red" : a.status === "IN_REVIEW" ? "amber" : "slate"}>{ALERT_LABEL[a.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <AlertDetail alert={open} onClose={() => setParams({})} />}
    </div>
  );
}

function NotifyBadge({ a }: { a: Alert }) {
  if (!a.notified) return null;
  return (
    <span title={a.notifyDetail} className={cx("hidden items-center gap-1 text-[11px] sm:flex", a.notified === "sent" ? "text-emerald-600" : a.notified === "failed" ? "text-red-600" : "text-slate-400")}>
      <Smartphone size={12} /> {a.notified === "sent" ? "Enviada" : a.notified === "failed" ? "Falló" : "No enviada"}
    </span>
  );
}

function AlertDetail({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const user = useCurrentUser();
  const users = useDb((s) => s.users);
  const events = useDb((s) => s.events);
  const audit = useDb((s) => s.audit);
  const [note, setNote] = useState(alert.note ?? "");
  const [sending, setSending] = useState(false);
  const ev = events.find((e) => e.id === alert.eventId);
  const trail = audit.filter((x) => x.entityId === alert.id);
  const canReview = user && user.role !== "auditor";
  useEffect(() => setNote(alert.note ?? ""), [alert.id, alert.note]);

  const move = (to: AlertStatus) => {
    try {
      updateAlertStatus(alert.id, to, note);
      toast("success", `Alerta: ${ALERT_LABEL[to]}`);
    } catch (e) {
      toast("error", "No permitido", (e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Alerta ${alert.id}`} wide>
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          {alert.thumbnail ? <img src={alert.thumbnail} alt="Evidencia de la alerta" className="w-full rounded-lg" /> : <div className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-500">Sin miniatura guardada (active «Guardar miniaturas de evidencia» para conservarla).</div>}
          <div className="flex flex-wrap gap-2"><SeverityBadge s={alert.severity} /><ModeBadge mode={alert.mode} /><Badge>{ALERT_LABEL[alert.status]}</Badge></div>
          <p className="text-sm font-semibold">{alert.message}</p>
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
            <dt className="text-slate-500">Regla</dt><dd>{alert.ruleName}</dd>
            <dt className="text-slate-500">Evento</dt><dd className="font-mono">{ev ? `${ev.type} · ${ev.id}` : alert.eventId}</dd>
            <dt className="text-slate-500">Origen</dt><dd className="font-mono">{alert.sessionId ?? alert.analysisId}</dd>
            <dt className="text-slate-500">Persona</dt><dd className="font-mono">{alert.personCode ?? "—"}</dd>
            <dt className="text-slate-500">Creada</dt><dd>{fmtDate(alert.createdAt)}</dd>
            <dt className="text-slate-500">Actualizada</dt><dd>{fmtDate(alert.updatedAt)}</dd>
            <dt className="text-slate-500">Celular</dt><dd>{alert.notified ? `${alert.notified} · ${alert.notifyDetail}` : "—"}</dd>
          </dl>
          {alert.mode === "REAL" && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">La confianza es una estimación del modelo, no una certeza. Verifique la evidencia antes de tomar cualquier acción.</p>}
        </div>
        <div className="space-y-3">
          <Field label="Responsable">
            <Select value={alert.assignedTo ?? ""} onChange={(e) => assignAlert(alert.id, e.target.value)} disabled={!canReview || alert.status === "CLOSED"}>
              <option value="">Sin asignar</option>
              {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Observación de revisión">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={500} disabled={!canReview || alert.status === "CLOSED"} className="w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Ej.: verificado en campo, el trabajador se colocó el casco." />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => move("IN_REVIEW")} disabled={!canReview || !canTransitionAlert(alert.status, "IN_REVIEW")}>Marcar en revisión</Button>
            <Button variant="primary" onClick={() => move("CLOSED")} disabled={!canReview || !canTransitionAlert(alert.status, "CLOSED")}>Cerrar alerta</Button>
            <Button
              variant="ghost"
              disabled={sending || !canReview}
              onClick={async () => {
                setSending(true);
                await notifyAlert(alert, thumbnailBlob(alert.thumbnail));
                setSending(false);
                toast("info", "Reenvío solicitado", "Revise el estado de envío al celular.");
              }}
            >
              <Send size={14} /> Reenviar al celular
            </Button>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Trazabilidad</p>
            <ul className="space-y-1 text-[11px] text-slate-500">
              {trail.length === 0 && <li>Sin acciones registradas.</li>}
              {trail.map((t) => <li key={t.id}>{fmtDate(t.occurredAt)} · <b>{t.action}</b> · {users.find((u) => u.id === t.actorId)?.name ?? t.actorId} {t.detail && `· ${t.detail}`}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </Modal>
  );
}
