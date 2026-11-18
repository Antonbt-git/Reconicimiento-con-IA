import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, BellRing, Gauge, HardHat, ScanSearch, Timer, Users, Video } from "lucide-react";
import { useDb } from "../../../shared/hooks/useDb";
import { live } from "../../streaming/LiveSessionController";
import { Badge, Button, Card, EmptyState, ModeBadge, PageHeader, Select, SeverityBadge, Stat, fmtDate, fmtMs, pct } from "../../../shared/ui";
import { ALERT_LABEL } from "../../../core/domain/sessionMachine";

const DAY = 86400000;
const localDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA");

export default function DashboardPage() {
  const analyses = useDb((s) => s.analyses);
  const sessions = useDb((s) => s.sessions);
  const alerts = useDb((s) => s.alerts);
  const persons = useDb((s) => s.persons);
  const classes = useDb((s) => s.classes);
  const [range, setRange] = useState(7);
  const [modeFilter, setModeFilter] = useState<"all" | "REAL" | "SIMULATED">("all");

  const data = useMemo(() => {
    const since = Date.now() - range * DAY;
    const inRange = (iso: string) => new Date(iso).getTime() >= since;
    const okMode = (m: string) => modeFilter === "all" || m === modeFilter;
    const an = analyses.filter((a) => inRange(a.createdAt) && okMode(a.engineMode) && a.status === "completed");
    const se = sessions.filter((s) => inRange(s.startedAt) && okMode(s.engineMode));
    const al = alerts.filter((a) => inRange(a.createdAt) && okMode(a.mode));
    const pe = persons.filter((p) => inRange(p.observedAt) && okMode(p.mode));
    const dets = an.flatMap((a) => a.detections.filter((d) => d.confidence >= a.threshold));
    const avgConf = an.length ? an.reduce((s, a) => s + a.averageConfidence, 0) / an.length : 0;
    const avgMs = an.length ? an.reduce((s, a) => s + a.durationMs, 0) / an.length : 0;
    const compliant = pe.filter((p) => p.compliance === "compliant").length;
    const nonComp = pe.filter((p) => p.compliance === "non_compliant").length;
    const review = pe.length - compliant - nonComp;

    const days = Array.from({ length: Math.min(range, 30) }, (_, i) => {
      const d = new Date(Date.now() - (Math.min(range, 30) - 1 - i) * DAY);
      const key = localDay(d);
      return {
        day: d.toLocaleDateString("es-PE", { day: "2-digit", month: "short" }),
        Análisis: an.filter((a) => localDay(a.createdAt) === key).length,
        Sesiones: se.filter((s) => localDay(s.startedAt) === key).length,
        Alertas: al.filter((a) => localDay(a.createdAt) === key).length,
      };
    });
    const byClass = new Map<string, number>();
    dets.forEach((d) => byClass.set(d.classId, (byClass.get(d.classId) ?? 0) + 1));
    const classDist = [...byClass.entries()]
      .map(([id, n]) => ({ id, name: classes.find((c) => c.id === id)?.name ?? id, n, color: classes.find((c) => c.id === id)?.color ?? "#64748b" }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
    return { an, se, al, pe, dets, avgConf, avgMs, compliant, nonComp, review, days, classDist };
  }, [analyses, sessions, alerts, persons, classes, range, modeFilter]);

  const newAlerts = data.al.filter((a) => a.status === "NEW").length;
  const empty = !analyses.length && !sessions.length;
  const liveNow = live.getSnapshot().status === "ACTIVE" || live.getSnapshot().status === "PAUSED";

  return (
    <div>
      <PageHeader
        title="Resumen operativo"
        description="Indicadores calculados desde los análisis, sesiones, personas y alertas almacenados (no son cifras decorativas)."
        actions={
          <>
            <Select value={modeFilter} onChange={(e) => setModeFilter(e.target.value as typeof modeFilter)} className="w-40">
              <option value="all">Real + simulado</option>
              <option value="REAL">Solo modelo real</option>
              <option value="SIMULATED">Solo simulación</option>
            </Select>
            <Select value={range} onChange={(e) => setRange(Number(e.target.value))} className="w-36">
              <option value={1}>Últimas 24 h</option>
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
            </Select>
          </>
        }
      />

      {empty && (
        <Card className="mb-4">
          <EmptyState icon={<HardHat size={36} />} title="Aún no hay actividad registrada">
            Ejecute un análisis de imagen o inicie una sesión en vivo; los indicadores se actualizarán automáticamente.
            <div className="mt-3 flex justify-center gap-2">
              <Link to="/analysis?scenario=sc-industrial"><Button variant="accent" size="sm">Probar escenario Seguridad industrial</Button></Link>
              <Link to="/live"><Button size="sm">Abrir supervisión en vivo</Button></Link>
            </div>
          </EmptyState>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Análisis ejecutados" value={data.an.length} sub={`${data.se.length} sesiones en vivo`} icon={<ScanSearch size={16} />} tone="cyan" />
        <Stat label="Objetos detectados" value={data.dets.length} sub="sobre el umbral de cada análisis" icon={<Activity size={16} />} />
        <Stat label="Alertas nuevas" value={newAlerts} sub={`${data.al.length} en el periodo`} icon={<BellRing size={16} />} tone={newAlerts ? "red" : "slate"} />
        <Stat label="Cumplimiento EPP" value={data.pe.length ? pct(data.compliant / data.pe.length) : "—"} sub={`${data.compliant} cumplen · ${data.nonComp} incompletos · ${data.review} revisar`} icon={<HardHat size={16} />} tone="green" />
        <Stat label="Personas registradas" value={data.pe.length} sub="imagen + en vivo" icon={<Users size={16} />} />
        <Stat label="Confianza media" value={data.an.length ? pct(data.avgConf) : "—"} sub="estimación del modelo, no certeza" icon={<Gauge size={16} />} />
        <Stat label="Tiempo medio por análisis" value={data.an.length ? fmtMs(data.avgMs) : "—"} icon={<Timer size={16} />} />
        <Stat label="Supervisión en vivo" value={liveNow ? "Activa" : "Inactiva"} sub={liveNow ? <Link className="text-cyan-700 underline" to="/live">Ver transmisión</Link> : "sin sesión activa"} icon={<Video size={16} />} tone={liveNow ? "red" : "slate"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Actividad" subtitle="Análisis, sesiones y alertas por día" className="lg:col-span-2">
          <div className="h-64 p-3">
            <ResponsiveContainer>
              <LineChart data={data.days} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Análisis" stroke="#0891b2" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="Sesiones" stroke="#1b4178" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                <Line type="monotone" dataKey="Alertas" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Estado EPP de personas" subtitle="Registro del periodo">
          <div className="h-64 p-3">
            {data.pe.length ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={[{ name: "Cumple", v: data.compliant }, { name: "EPP incompleto", v: data.nonComp }, { name: "Revisar", v: data.review }]} dataKey="v" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {["#16a34a", "#dc2626", "#d97706"].map((c) => <Cell key={c} fill={c} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Sin personas registradas" />}
          </div>
        </Card>
        <Card title="Distribución por clase" subtitle="Detecciones de análisis por imagen" className="lg:col-span-1">
          <div className="h-64 p-3">
            {data.classDist.length ? (
              <ResponsiveContainer>
                <BarChart data={data.classDist} layout="vertical" margin={{ left: 10, right: 12 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="n" name="Detecciones" radius={[0, 4, 4, 0]}>
                    {data.classDist.map((d) => <Cell key={d.id} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Sin detecciones" />}
          </div>
        </Card>
        <Card title="Alertas recientes" action={<Link to="/alerts" className="text-xs font-semibold text-cyan-700">Ver todas</Link>}>
          <ul className="divide-y divide-slate-100">
            {data.al.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link to={`/alerts?id=${a.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{a.message}</p>
                    <p className="text-[11px] text-slate-400">{fmtDate(a.createdAt)} · {ALERT_LABEL[a.status]}</p>
                  </div>
                  <SeverityBadge s={a.severity} />
                </Link>
              </li>
            ))}
            {!data.al.length && <li className="px-4 py-6 text-center text-xs text-slate-500">Sin alertas en el periodo.</li>}
          </ul>
        </Card>
        <Card title="Análisis recientes" action={<Link to="/history" className="text-xs font-semibold text-cyan-700">Historial</Link>}>
          <ul className="divide-y divide-slate-100">
            {data.an.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{a.sourceName}</p>
                  <p className="text-[11px] text-slate-400">{fmtDate(a.createdAt)} · {a.persons.length} personas · {a.alertIds.length} alertas</p>
                </div>
                <ModeBadge mode={a.engineMode} compact />
              </li>
            ))}
            {!data.an.length && <li className="px-4 py-6 text-center text-xs text-slate-500">Sin análisis en el periodo.</li>}
          </ul>
        </Card>
      </div>
      {data.al.some((a) => a.mode === "SIMULATED") && modeFilter === "all" && (
        <p className="mt-3 text-[11px] text-slate-400"><Badge tone="violet">Nota</Badge> Los indicadores incluyen datos de simulación; use el filtro para separarlos de los resultados del modelo real.</p>
      )}
    </div>
  );
}
