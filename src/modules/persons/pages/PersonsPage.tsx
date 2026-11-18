import { useMemo, useState } from "react";
import { Download, Pencil, UserCheck, Users } from "lucide-react";
import { useCurrentUser, useDb } from "../../../shared/hooks/useDb";
import { updatePerson, recordExport } from "../../../core/application/services";
import { complianceOf, PPE_LABEL } from "../../../core/domain/epp";
import type { Compliance, PersonRecord, PpeItem, PpeState } from "../../../core/domain/types";
import { downloadCsv, toCsv } from "../../../infrastructure/export/csv";
import { Badge, Button, Card, ComplianceBadge, EmptyState, Field, Input, Modal, ModeBadge, PageHeader, PpeChip, Select, fmtDate } from "../../../shared/ui";

const STATE_TXT: Record<PpeState, string> = { present: "SI", absent: "NO", uncertain: "INCIERTO", unknown: "SIN EVIDENCIA" };

export default function PersonsPage() {
  const persons = useDb((s) => s.persons);
  const required = useDb((s) => s.settings.requiredPpe);
  const requiredPpe = useDb((s) => s.settings.requiredPpe);
  const user = useCurrentUser();
  const [q, setQ] = useState("");
  const [comp, setComp] = useState<"" | Compliance>("");
  const [origin, setOrigin] = useState<"" | "image" | "live">("");
  const [mode, setMode] = useState<"" | "REAL" | "SIMULATED">("");
  const [from, setFrom] = useState("");
  const [edit, setEdit] = useState<PersonRecord>();
  const canEdit = user && user.role !== "auditor";

  const rows = useMemo(
    () =>
      persons.filter(
        (p) =>
          (!comp || p.compliance === comp) &&
          (!origin || p.origin === origin) &&
          (!mode || p.mode === mode) &&
          (!from || p.observedAt >= from) &&
          (!q || `${p.code} ${p.workerName ?? ""} ${p.area ?? ""} ${p.analysisId ?? ""} ${p.sessionId ?? ""}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [persons, q, comp, origin, mode, from],
  );

  function exportCsv() {
    const data = rows.map((p) => ({
      id: p.id, codigo: p.code, fecha: p.observedAt, origen: p.origin === "live" ? "en vivo" : "imagen", modo: p.mode,
      trabajador: p.workerName ?? "", area: p.area ?? "",
      casco: STATE_TXT[p.ppe.helmet], conf_casco: p.ppeConfidence.helmet,
      chaleco: STATE_TXT[p.ppe.vest], conf_chaleco: p.ppeConfidence.vest,
      mascarilla: STATE_TXT[p.ppe.mask], conf_mascarilla: p.ppeConfidence.mask,
      cumplimiento: p.compliance, faltantes: p.missing.join("|"), revision: p.reviewStatus, revisado_por: p.reviewedBy ?? "",
      analisis: p.analysisId ?? "", sesion: p.sessionId ?? "",
    }));
    downloadCsv(`registro-epp-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data));
    recordExport("PersonRecord", JSON.stringify({ q, comp, origin, mode, from }), data.length);
  }

  const total = rows.length;
  const ok = rows.filter((r) => r.compliance === "compliant").length;
  const bad = rows.filter((r) => r.compliance === "non_compliant").length;

  return (
    <div>
      <PageHeader
        title="Registro EPP de personas"
        description="Cada persona observada (por foto o en vivo) queda registrada con el estado de casco, chaleco y mascarilla. El código es temporal y no identifica biométricamente a nadie; el nombre y el área solo los ingresa el operador."
        actions={<Button onClick={exportCsv} disabled={!rows.length}><Download size={16} /> Exportar CSV</Button>}
      />
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Buscar"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, área, sesión…" /></Field>
          <Field label="Cumplimiento">
            <Select value={comp} onChange={(e) => setComp(e.target.value as Compliance | "")}>
              <option value="">Todos</option><option value="compliant">Cumple</option><option value="non_compliant">EPP incompleto</option><option value="review">Requiere revisión</option>
            </Select>
          </Field>
          <Field label="Origen">
            <Select value={origin} onChange={(e) => setOrigin(e.target.value as "" | "image" | "live")}>
              <option value="">Todos</option><option value="image">Imagen</option><option value="live">En vivo</option>
            </Select>
          </Field>
          <Field label="Modo">
            <Select value={mode} onChange={(e) => setMode(e.target.value as "" | "REAL")}>
              <option value="">Todos</option><option value="REAL">Modelo real</option><option value="SIMULATED">Simulación</option>
            </Select>
          </Field>
          <Field label="Desde"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-4 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
          <span><b className="tabular">{total}</b> registros</span>
          <span className="text-emerald-700"><b className="tabular">{ok}</b> cumplen</span>
          <span className="text-red-700"><b className="tabular">{bad}</b> con EPP incompleto</span>
          <span className="text-amber-700"><b className="tabular">{total - ok - bad}</b> por revisar</span>
        </div>
      </Card>
      <Card>
        {!rows.length ? (
          <EmptyState icon={<Users size={32} />} title="Sin personas registradas">Analice fotos o inicie una sesión en vivo; las personas detectadas aparecerán aquí.</EmptyState>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2">Persona</th><th className="px-3 py-2">Observación</th><th className="px-3 py-2">EPP</th>
                  <th className="px-3 py-2">Estado</th><th className="px-3 py-2">Trabajador / área</th><th className="px-3 py-2">Revisión</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {p.thumbnail ? <img src={p.thumbnail} alt={`Evidencia ${p.code}`} className="h-12 w-10 rounded object-cover" /> : <div className="flex h-12 w-10 items-center justify-center rounded bg-slate-100 text-slate-400"><Users size={14} /></div>}
                        <div><p className="font-mono font-semibold">{p.code}</p><ModeBadge mode={p.mode} compact /></div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <p>{fmtDate(p.observedAt)}</p>
                      <p className="text-[11px] text-slate-400">{p.origin === "live" ? `En vivo · ${p.observations ?? 0} obs.` : "Imagen"} · {p.analysisId ?? p.sessionId}</p>
                    </td>
                    <td className="px-3 py-2"><div className="flex max-w-[280px] flex-wrap gap-1">{(["helmet", "vest", "mask"] as const).map((k) => <PpeChip key={k} optional={!requiredPpe.includes(k)} label={PPE_LABEL[k]} state={p.ppe[k]} confidence={p.ppeConfidence[k]} />)}</div></td>
                    <td className="px-3 py-2"><ComplianceBadge c={p.compliance} /></td>
                    <td className="px-3 py-2"><p className="font-medium">{p.workerName || <span className="text-slate-400">—</span>}</p><p className="text-[11px] text-slate-400">{p.area}</p></td>
                    <td className="px-3 py-2">
                      <Badge tone={p.reviewStatus === "pending" ? "amber" : p.reviewStatus === "confirmed" ? "green" : "blue"}>{{ pending: "Pendiente", confirmed: "Confirmado", corrected: "Corregido" }[p.reviewStatus]}</Badge>
                      {p.reviewedBy && <p className="mt-1 text-[10px] text-slate-400">{p.reviewedBy}</p>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          {p.reviewStatus === "pending" && <Button size="sm" variant="ghost" onClick={() => updatePerson(p.id, { reviewStatus: "confirmed" })} title="Confirmar"><UserCheck size={14} /></Button>}
                          <Button size="sm" variant="ghost" onClick={() => setEdit(p)} title="Editar"><Pencil size={14} /></Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <EditPerson rec={edit} required={required} onClose={() => setEdit(undefined)} />}
    </div>
  );
}

function EditPerson({ rec, required, onClose }: { rec: PersonRecord; required: PpeItem[]; onClose: () => void }) {
  const [name, setName] = useState(rec.workerName ?? "");
  const [area, setArea] = useState(rec.area ?? "");
  const [ppe, setPpe] = useState(rec.ppe);
  const changed = JSON.stringify(ppe) !== JSON.stringify(rec.ppe);
  return (
    <Modal open onClose={onClose} title={`Revisión humana · ${rec.code}`}>
      <div className="space-y-3">
        {rec.thumbnail && <img src={rec.thumbnail} alt="" className="mx-auto max-h-48 rounded" />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre o código del trabajador (opcional)"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Field label="Área / frente de trabajo"><Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} /></Field>
        </div>
        <p className="text-xs font-semibold text-slate-600">Corregir estado de EPP (si el modelo se equivocó)</p>
        <div className="grid grid-cols-3 gap-2">
          {(["helmet", "vest", "mask"] as const).map((k) => (
            <Field key={k} label={PPE_LABEL[k]}>
              <Select value={ppe[k]} onChange={(e) => setPpe({ ...ppe, [k]: e.target.value as PpeState })}>
                <option value="present">Lo usa</option><option value="absent">No lo usa</option><option value="uncertain">Incierto</option><option value="unknown">Sin evidencia</option>
              </Select>
            </Field>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => {
              const { compliance, missing } = complianceOf({ helmet: { state: ppe.helmet }, vest: { state: ppe.vest }, mask: { state: ppe.mask } }, required);
              updatePerson(rec.id, { workerName: name, area, ppe, compliance, missing, reviewStatus: changed ? "corrected" : "confirmed" });
              onClose();
            }}
          >
            Guardar revisión
          </Button>
        </div>
      </div>
    </Modal>
  );
}
