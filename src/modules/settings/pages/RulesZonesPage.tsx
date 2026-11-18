import { useRef, useState, type PointerEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useCurrentUser, useDb } from "../../../shared/hooks/useDb";
import { repo } from "../../../infrastructure/persistence/LocalRepository";
import { audit } from "../../../core/application/services";
import { PPE_LABEL } from "../../../core/domain/epp";
import { normalizeBox } from "../../../core/domain/geometry";
import type { PpeItem, Rule, RuleType, Severity, Zone } from "../../../core/domain/types";
import { SCENES, sceneAsset } from "../../scenarios/data/scenes";
import { uid } from "../../../shared/utils/id";
import { sanitize } from "../../../shared/utils/image";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Toggle, cx } from "../../../shared/ui";

const TYPE_LABEL: Record<RuleType, string> = { EPP_MISSING: "Falta de EPP", ENTER_ZONE: "Ingreso a zona", DWELL_TIME: "Permanencia en zona", COUNT_THRESHOLD: "Conteo / aforo" };

export default function RulesZonesPage() {
  const rules = useDb((s) => s.rules);
  const zones = useDb((s) => s.zones);
  const user = useCurrentUser();
  const isAdmin = user?.role === "admin" || user?.role === "supervisor";
  const [selZone, setSelZone] = useState(zones[0]?.id);

  const setRule = (id: string, patch: Partial<Rule>) => {
    repo.update((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    audit("RULE_UPDATED", "Rule", id, Object.entries(patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" "));
  };
  const setZone = (id: string, patch: Partial<Zone>) => {
    repo.update((s) => ({ zones: s.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }));
    audit("ZONE_UPDATED", "Zone", id, Object.keys(patch).join(","));
  };
  const addRule = () => {
    const r: Rule = { id: uid("rule"), code: "CUSTOM", name: "Nueva regla", type: "EPP_MISSING", threshold: 3000, ppeItems: ["helmet"], severity: "medium", enabled: false, notify: true, dedupWindowMs: 120000, scope: "both" };
    repo.update((s) => ({ rules: [...s.rules, r] }));
    audit("RULE_CREATED", "Rule", r.id);
  };
  const addZone = () => {
    const z: Zone = { id: uid("zone"), name: "Nueva zona", geometry: { x: 0.35, y: 0.5, width: 0.3, height: 0.45 }, enabled: true, color: "#8b5cf6" };
    repo.update((s) => ({ zones: [...s.zones, z] }));
    setSelZone(z.id);
    audit("ZONE_CREATED", "Zone", z.id);
  };

  return (
    <div>
      <PageHeader title="Reglas y zonas" description="Reglas evaluadas en análisis por imagen y en vivo. Cada cambio queda en la auditoría." actions={isAdmin && <Button onClick={addRule}><Plus size={16} /> Nueva regla</Button>} />
      {!isAdmin && <p className="mb-3 text-xs text-amber-700">Solo administrador o supervisor pueden modificar reglas y zonas.</p>}
      <fieldset disabled={!isAdmin} className="space-y-4">
        <Card title="Reglas de alerta">
          <div className="divide-y divide-slate-100">
            {rules.map((r) => (
              <div key={r.id} className="grid gap-3 p-4 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_auto] md:items-end">
                <Field label="Nombre"><Input value={r.name} onChange={(e) => setRule(r.id, { name: sanitize(e.target.value, 80) })} /></Field>
                <Field label="Tipo">
                  <Select value={r.type} onChange={(e) => setRule(r.id, { type: e.target.value as RuleType })}>
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                {r.type === "EPP_MISSING" ? (
                  <Field label="EPP vigilado">
                    <div className="flex h-9 items-center gap-2">
                      {(["helmet", "vest", "mask"] as PpeItem[]).map((k) => (
                        <label key={k} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.ppeItems?.includes(k) ?? false} onChange={(e) => setRule(r.id, { ppeItems: e.target.checked ? [...(r.ppeItems ?? []), k] : (r.ppeItems ?? []).filter((x) => x !== k) })} />{PPE_LABEL[k]}</label>
                      ))}
                    </div>
                  </Field>
                ) : r.type === "COUNT_THRESHOLD" || r.type === "ENTER_ZONE" || r.type === "DWELL_TIME" ? (
                  <Field label="Zona">
                    <Select value={r.zoneId ?? ""} onChange={(e) => setRule(r.id, { zoneId: e.target.value || undefined })}>
                      <option value="">{r.type === "COUNT_THRESHOLD" ? "Toda la escena" : "— Seleccione —"}</option>
                      {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </Select>
                  </Field>
                ) : <div />}
                <Field label={r.type === "COUNT_THRESHOLD" ? "Umbral (personas)" : r.type === "ENTER_ZONE" ? "Umbral" : "Persistencia (s)"}>
                  <Input
                    type="number"
                    min={r.type === "COUNT_THRESHOLD" ? 1 : 0}
                    disabled={r.type === "ENTER_ZONE"}
                    value={r.type === "COUNT_THRESHOLD" ? r.threshold : r.threshold / 1000}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      setRule(r.id, { threshold: r.type === "COUNT_THRESHOLD" ? Math.max(1, Math.round(v)) : v * 1000 });
                    }}
                  />
                </Field>
                <Field label="Severidad">
                  <Select value={r.severity} onChange={(e) => setRule(r.id, { severity: e.target.value as Severity })}>
                    <option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option>
                  </Select>
                </Field>
                <div className="flex items-center gap-2 pb-1">
                  <Button size="sm" variant="ghost" aria-label="Eliminar regla" onClick={() => { repo.update((s) => ({ rules: s.rules.filter((x) => x.id !== r.id) })); audit("RULE_DELETED", "Rule", r.id); }}><Trash2 size={14} /></Button>
                </div>
                <div className="flex flex-wrap items-center gap-4 md:col-span-6">
                  <Toggle checked={r.enabled} onChange={(v) => setRule(r.id, { enabled: v })} label="Habilitada" />
                  <Toggle checked={r.notify} onChange={(v) => setRule(r.id, { notify: v })} label="Enviar al celular" />
                  <label className="flex items-center gap-2 text-xs text-slate-600">Ventana anti-duplicados
                    <Input type="number" min={5} className="h-8 w-20" value={r.dedupWindowMs / 1000} onChange={(e) => setRule(r.id, { dedupWindowMs: Math.max(5, Number(e.target.value) || 5) * 1000 })} /> s
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">Aplicar en
                    <Select className="h-8 w-36" value={r.scope ?? "both"} onChange={(e) => setRule(r.id, { scope: e.target.value as Rule["scope"] })}>
                      <option value="both">Fotos y en vivo</option><option value="live">Solo en vivo</option><option value="image">Solo fotos</option>
                    </Select>
                  </label>
                  <Badge>{r.code}</Badge>
                  {(r.type === "ENTER_ZONE" || r.type === "DWELL_TIME") && !r.zoneId && <Badge tone="red">Requiere zona</Badge>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Zonas (rectángulos normalizados)" subtitle="Seleccione una zona y arrastre sobre la vista previa para redibujarla." action={isAdmin && <Button size="sm" onClick={addZone}><Plus size={14} /> Nueva zona</Button>}>
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-2">
              {zones.map((z) => (
                <div key={z.id} onClick={() => setSelZone(z.id)} className={cx("cursor-pointer rounded-lg border p-3", selZone === z.id ? "border-accent-strong bg-cyan-50/40" : "border-slate-200")}>
                  <div className="flex items-center gap-2">
                    <input type="color" value={z.color} onChange={(e) => setZone(z.id, { color: e.target.value })} className="h-7 w-7 rounded" aria-label="Color" />
                    <Input value={z.name} onChange={(e) => setZone(z.id, { name: sanitize(e.target.value, 60) })} />
                    <Button size="sm" variant="ghost" aria-label="Eliminar zona" onClick={(e) => { e.stopPropagation(); repo.update((s) => ({ zones: s.zones.filter((x) => x.id !== z.id), rules: s.rules.map((r) => (r.zoneId === z.id ? { ...r, zoneId: undefined, enabled: r.type === "COUNT_THRESHOLD" ? r.enabled : false } : r)) })); audit("ZONE_DELETED", "Zone", z.id); }}><Trash2 size={14} /></Button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <Toggle checked={z.enabled} onChange={(v) => setZone(z.id, { enabled: v })} label="Activa" />
                    <span className="font-mono text-[10px] text-slate-500">{[z.geometry.x, z.geometry.y, z.geometry.width, z.geometry.height].map((n) => n.toFixed(2)).join(", ")}</span>
                  </div>
                </div>
              ))}
            </div>
            <ZoneEditor zones={zones} selected={selZone} onDraw={(g) => selZone && setZone(selZone, { geometry: g })} disabled={!isAdmin} />
          </div>
        </Card>
      </fieldset>
    </div>
  );
}

function ZoneEditor({ zones, selected, onDraw, disabled }: { zones: Zone[]; selected?: string; onDraw: (g: Zone["geometry"]) => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  const pos = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div
      ref={ref}
      className={cx("relative aspect-[16/10] w-full touch-none select-none overflow-hidden rounded-lg", !disabled && "cursor-crosshair")}
      onPointerDown={(e) => { if (disabled || !selected) return; const p = pos(e); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
      onPointerMove={(e) => { if (!drag) return; const p = pos(e); setDrag({ ...drag, x1: p.x, y1: p.y }); }}
      onPointerUp={() => {
        if (!drag) return;
        const g = normalizeBox({ x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) });
        if (g.width > 0.03 && g.height > 0.03) onDraw(g);
        setDrag(undefined);
      }}
    >
      <img src={sceneAsset(SCENES[0], 800, 500)} alt="Vista previa de la escena" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80" draggable={false} />
      {zones.map((z) => (
        <div key={z.id} className={cx("pointer-events-none absolute border-2 border-dashed", !z.enabled && "opacity-40")} style={{ left: `${z.geometry.x * 100}%`, top: `${z.geometry.y * 100}%`, width: `${z.geometry.width * 100}%`, height: `${z.geometry.height * 100}%`, borderColor: z.color, background: `${z.color}22`, borderWidth: z.id === selected ? 3 : 2 }}>
          <span className="absolute left-1 top-1 rounded px-1 text-[10px] font-bold text-white" style={{ background: z.color }}>{z.name}</span>
        </div>
      ))}
      {drag && <div className="pointer-events-none absolute border-2 border-cyan-500 bg-cyan-400/20" style={{ left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` }} />}
      <p className="absolute bottom-1 right-2 text-[10px] font-semibold text-white drop-shadow">La zona se evalúa con el punto de apoyo (pies) de cada persona</p>
    </div>
  );
}
