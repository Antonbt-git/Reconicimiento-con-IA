import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { SCENES, SCENARIOS, sceneAsset } from "../data/scenes";
import { Badge, Button, Card, PageHeader } from "../../../shared/ui";
import { useDb } from "../../../shared/hooks/useDb";

export default function ScenariosPage() {
  const classes = useDb((s) => s.classes);
  return (
    <div>
      <PageHeader title="Galería de escenarios" description="Escenas de demostración con resultados semilla deterministas (misma entrada → mismo resultado). Úselas con el motor de demostración para enseñar el flujo, o con el modelo real para comparar." />
      <div className="grid gap-4 md:grid-cols-2">
        {SCENES.map((s) => {
          const sc = SCENARIOS.find((x) => x.id === s.id)!;
          const counts = new Map<string, number>();
          sc.expected.detections.forEach((d) => counts.set(d.classId, (counts.get(d.classId) ?? 0) + 1));
          return (
            <Card key={s.id}>
              <img src={sceneAsset(s, 800, 500)} alt={`Escenario ${s.name}`} className="aspect-[16/10] w-full rounded-t-xl object-cover" />
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{s.name}</h2>
                  <Badge tone="violet">Demo</Badge>
                </div>
                <p className="text-xs text-slate-500">{s.description}</p>
                <div className="flex flex-wrap gap-1">
                  {[...counts].map(([id, n]) => <Badge key={id}><span className="h-2 w-2 rounded-sm" style={{ background: classes.find((c) => c.id === id)?.color }} />{classes.find((c) => c.id === id)?.name ?? id} × {n}</Badge>)}
                </div>
                <div className="flex flex-wrap gap-1">{s.tags.map((t) => <span key={t} className="text-[11px] text-slate-400">#{t}</span>)}</div>
                <Link to={`/analysis?scenario=${s.id}`}><Button size="sm" variant="accent" className="mt-1"><Play size={14} /> Abrir en el centro de análisis</Button></Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
