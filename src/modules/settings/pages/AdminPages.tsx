import { useState } from "react";
import { Download, FlaskConical, RotateCcw, ShieldCheck } from "lucide-react";
import { useCurrentUser, useDb } from "../../../shared/hooks/useDb";
import { repo } from "../../../infrastructure/persistence/LocalRepository";
import { analyzeImage, audit, login, recordExport, registerAnalysisPersons } from "../../../core/application/services";
import { PPE_LABEL } from "../../../core/domain/epp";
import type { PpeItem, Settings } from "../../../core/domain/types";
import { ROLE_LABEL } from "../../../shared/constants/roles";
import { cloudEnabled } from "../../../infrastructure/persistence/cloud";
import { demoEngine } from "../../../app/engines";
import { SCENES, sceneAsset } from "../../scenarios/data/scenes";
import { loadImage } from "../../../shared/utils/image";
import { downloadCsv, toCsv } from "../../../infrastructure/export/csv";
import { toast } from "../../../shared/utils/bus";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Toggle, fmtDate, pct } from "../../../shared/ui";



export function SettingsPage() {
  const settings = useDb((s) => s.settings);
  const user = useCurrentUser();
  const canEdit = user?.role === "admin";
  const [seeding, setSeeding] = useState(false);
  const set = (patch: Partial<Settings>) => {
    repo.update((s) => ({ settings: { ...s.settings, ...patch } }));
    audit("SETTINGS_UPDATED", "Settings", "global", Object.keys(patch).join(","));
  };

  async function seedDemo() {
    setSeeding(true);
    try {
      for (const s of SCENES) {
        const img = await loadImage(sceneAsset(s));
        const a = await analyzeImage({ engine: demoEngine, source: img, width: img.naturalWidth, height: img.naturalHeight, sourceName: `${s.name} (demo)`, scenarioId: s.id, mode: "combined" });
        registerAnalysisPersons(a, img, img.naturalWidth, img.naturalHeight, settings.storeEvidence);
      }
      toast("success", "Datos de demostración generados", "Todos los registros están marcados como SIMULACIÓN.");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div>
      <PageHeader title="Configuración" description="Parámetros globales del análisis, privacidad y motor." />
      {!canEdit && <p className="mb-3 text-xs text-amber-700">Solo el administrador puede modificar la configuración.</p>}
      <fieldset disabled={!canEdit} className="grid gap-4 lg:grid-cols-2">
        <Card title="Umbrales y EPP obligatorio">
          <div className="space-y-4 p-4">
            <Field label={`Umbral de confianza: ${pct(settings.confidenceThreshold)}`} hint="Detecciones por debajo se ocultan en el visor pero se conservan en el registro bruto.">
              <input type="range" min={0.1} max={0.9} step={0.05} value={settings.confidenceThreshold} onChange={(e) => set({ confidenceThreshold: Number(e.target.value) })} className="w-full accent-cyan-700" />
            </Field>
            <Field label={`Umbral de revisión: ${pct(settings.reviewThreshold)}`} hint="Evidencia de EPP con confianza menor queda como «incierta» → la persona pasa a «Requiere revisión» en lugar de «incumple».">
              <input type="range" min={0.2} max={0.95} step={0.05} value={settings.reviewThreshold} onChange={(e) => set({ reviewThreshold: Number(e.target.value) })} className="w-full accent-cyan-700" />
            </Field>
            <Field label="EPP obligatorio para «Cumple»">
              <div className="flex gap-4 pt-1">
                {(["helmet", "vest", "mask"] as PpeItem[]).map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={settings.requiredPpe.includes(k)} onChange={(e) => set({ requiredPpe: e.target.checked ? [...settings.requiredPpe, k] : settings.requiredPpe.filter((x) => x !== k) })} />{PPE_LABEL[k]}</label>
                ))}
              </div>
            </Field>
          </div>
        </Card>
        <Card title="En vivo y motor">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Análisis por segundo (en vivo)" hint="Más alto = más CPU. 3–5 es adecuado en una laptop.">
              <Input type="number" min={0.5} max={15} step={0.5} value={settings.liveInferenceFps} onChange={(e) => set({ liveInferenceFps: Math.min(15, Math.max(0.5, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="Ventana de suavizado (fotogramas)" hint="Voto mayoritario para decidir el estado de cada EPP.">
              <Input type="number" min={3} max={30} value={settings.liveSmoothingWindow} onChange={(e) => set({ liveSmoothingWindow: Math.min(30, Math.max(3, Number(e.target.value) || 3)) })} />
            </Field>
            <Field label="Motor predeterminado (imágenes)">
              <Select value={settings.defaultEngine} onChange={(e) => set({ defaultEngine: e.target.value as Settings["defaultEngine"] })}>
                <option value="onnx">Modelo EPP real (navegador)</option><option value="demo">Demostración</option><option value="api">Servicio backend</option>
              </Select>
            </Field>
            <Field label="URL del servicio backend"><Input value={settings.apiBaseUrl} onChange={(e) => set({ apiBaseUrl: e.target.value.trim() })} /></Field>
          </div>
        </Card>
        <Card title="Privacidad (RN-13)">
          <div className="space-y-3 p-4">
            <Toggle checked={settings.storeEvidence} onChange={(v) => set({ storeEvidence: v })} label="Guardar miniaturas de evidencia (personas y alertas)" />
            <p className="text-xs text-slate-500">Desactivado por defecto: solo se guardan metadatos. Si lo activa, defina consentimiento, finalidad y plazo de retención. El video nunca se graba ni sale del navegador; no se usa reconocimiento facial.</p>
          </div>
        </Card>
        <Card title="Datos">
          <div className="flex flex-wrap gap-2 p-4">
            <Button onClick={seedDemo} disabled={seeding}><FlaskConical size={16} /> {seeding ? "Generando…" : "Generar datos de demostración"}</Button>
            <Button variant="danger" onClick={() => { if (confirm("¿Borrar análisis, sesiones, personas, alertas y auditoría? La configuración se conserva.")) { repo.reset(true); audit("DATA_RESET", "Repository", "local"); toast("info", "Datos locales borrados"); } }}><RotateCcw size={16} /> Borrar historial local</Button>
          </div>
        </Card>
      </fieldset>
    </div>
  );
}

export function ClassesPage() {
  const classes = useDb((s) => s.classes);
  const user = useCurrentUser();
  const canEdit = user?.role === "admin";
  return (
    <div>
      <PageHeader title="Clases" description="Colores y visibilidad de cada clase. Las 10 primeras corresponden al modelo EPP real; el resto, a los escenarios demo." />
      <Card>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-4 py-2">Color</th><th className="px-4 py-2">Clase</th><th className="px-4 py-2">ID</th><th className="px-4 py-2">Descripción</th><th className="px-4 py-2">Habilitada</th></tr></thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2"><input type="color" value={c.color} disabled={!canEdit} onChange={(e) => { repo.update((s) => ({ classes: s.classes.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)) })); }} onBlur={() => audit("CLASS_UPDATED", "Class", c.id, "color")} className="h-7 w-9" aria-label={`Color de ${c.name}`} /></td>
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2 font-mono text-slate-500">{c.id}</td>
                <td className="px-4 py-2 text-slate-500">{c.description}</td>
                <td className="px-4 py-2"><Toggle checked={c.enabled} disabled={!canEdit} onChange={(v) => { repo.update((s) => ({ classes: s.classes.map((x) => (x.id === c.id ? { ...x, enabled: v } : x)) })); audit("CLASS_UPDATED", "Class", c.id, `enabled=${v}`); }} label="" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function UsersPage() {
  const users = useDb((s) => s.users);
  const user = useCurrentUser();
  return (
    <div>
      <PageHeader title="Usuarios y roles" description={cloudEnabled ? "Usuarios de Supabase. Se crean en Supabase → Authentication → Users; el rol se cambia con SQL (ver guía): update public.profiles set role = 'supervisor' where email = '…';" : "Acceso demostrativo por perfil. En producción la autenticación y la autorización se verifican en el backend."} />
      <Card>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-4 py-2">Usuario</th><th className="px-4 py-2">Correo</th><th className="px-4 py-2">Rol</th><th className="px-4 py-2">Permisos</th><th className="px-4 py-2" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">{u.name} {u.id === user?.id && <Badge tone="cyan">Sesión actual</Badge>}</td>
                <td className="px-4 py-2 text-slate-500">{u.email}</td>
                <td className="px-4 py-2">{ROLE_LABEL[u.role]}</td>
                <td className="px-4 py-2 text-slate-500">{{ admin: "Todo", operator: "Análisis, en vivo, alertas, personas", supervisor: "Revisión, reglas, reportes", auditor: "Solo lectura y auditoría" }[u.role]}</td>
                <td className="px-4 py-2 text-right">{!cloudEnabled && u.id !== user?.id && <Button size="sm" onClick={() => login(u.id)}>Cambiar a este perfil</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function AuditPage() {
  const audits = useDb((s) => s.audit);
  const users = useDb((s) => s.users);
  const [q, setQ] = useState("");
  const rows = audits.filter((a) => !q || `${a.action} ${a.entityType} ${a.entityId} ${a.detail ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Auditoría" description="Registro de inicio/cierre de sesiones, cambios de reglas, revisión de alertas, envíos al celular y exportaciones." actions={<Button onClick={() => { const r = rows.map((a) => ({ ...a, actor: users.find((u) => u.id === a.actorId)?.name ?? a.actorId })); downloadCsv("auditoria.csv", toCsv(r)); recordExport("AuditLog", q, r.length); }}><Download size={16} /> CSV</Button>} />
      <Card className="mb-4"><div className="p-4 sm:w-80"><Field label="Buscar"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Acción, entidad, ID…" /></Field></div></Card>
      <Card>
        {!rows.length ? <EmptyState icon={<ShieldCheck size={30} />} title="Sin registros" /> : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Acción</th><th className="px-3 py-2">Entidad</th><th className="px-3 py-2">Detalle</th><th className="px-3 py-2">correlation_id</th></tr></thead>
              <tbody>
                {rows.slice(0, 500).map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-1.5">{fmtDate(a.occurredAt)}</td>
                    <td className="px-3 py-1.5">{users.find((u) => u.id === a.actorId)?.name ?? a.actorId}</td>
                    <td className="px-3 py-1.5 font-mono font-semibold">{a.action}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{a.entityType} · {a.entityId.slice(0, 40)}</td>
                    <td className="px-3 py-1.5 text-slate-600">{a.detail}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-slate-400">{a.correlationId.slice(0, 8)}</td>
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

export function ExportsPage() {
  const exports = useDb((s) => s.exports);
  return (
    <div>
      <PageHeader title="Exportaciones" description="Registro de cada CSV generado (solo metadatos). Exporte desde Historial, Registro EPP, Alertas o Auditoría." />
      <Card>
        {!exports.length ? <EmptyState icon={<Download size={30} />} title="Sin exportaciones" /> : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Entidad</th><th className="px-4 py-2">Filas</th><th className="px-4 py-2">Solicitado por</th><th className="px-4 py-2">Filtros</th></tr></thead>
            <tbody>
              {exports.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{fmtDate(e.createdAt)}</td><td className="px-4 py-2">{e.entity}</td><td className="tabular px-4 py-2">{e.rows}</td><td className="px-4 py-2">{e.requestedBy}</td><td className="px-4 py-2 font-mono text-[10px] text-slate-500">{e.filters}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
