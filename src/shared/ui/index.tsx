import clsx from "clsx";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Info, X, XCircle, FlaskConical, Cpu } from "lucide-react";
import type { Compliance, EngineMode, PpeState, Severity } from "../../core/domain/types";
import { onToast, type Toast } from "../utils/bus";

export const cx = clsx;

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-navy-900 text-white hover:bg-navy-800",
        variant === "accent" && "bg-accent-strong text-white hover:bg-cyan-700",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
    />
  );
}

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("anim-rise rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = "slate", children, className }: { tone?: "slate" | "green" | "red" | "amber" | "cyan" | "blue" | "violet"; children: ReactNode; className?: string }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    cyan: "bg-cyan-50 text-cyan-800 ring-cyan-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
  };
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

export function ModeBadge({ mode, compact }: { mode: EngineMode; compact?: boolean }) {
  return mode === "REAL" ? (
    <Badge tone="blue" className="uppercase tracking-wide">
      <Cpu size={12} aria-hidden /> {compact ? "Real" : "Modelo real"}
    </Badge>
  ) : (
    <Badge tone="violet" className="uppercase tracking-wide">
      <FlaskConical size={12} aria-hidden /> {compact ? "Demo" : "Simulación"}
    </Badge>
  );
}

export function SeverityBadge({ s }: { s: Severity }) {
  const map = { low: ["slate", "Baja"], medium: ["amber", "Media"], high: ["red", "Alta"], critical: ["red", "Crítica"] } as const;
  return <Badge tone={map[s][0]}>{map[s][1]}</Badge>;
}

export function ComplianceBadge({ c }: { c: Compliance }) {
  if (c === "compliant") return <Badge tone="green"><CheckCircle2 size={12} aria-hidden /> Cumple</Badge>;
  if (c === "non_compliant") return <Badge tone="red"><XCircle size={12} aria-hidden /> EPP incompleto</Badge>;
  return <Badge tone="amber"><CircleHelp size={12} aria-hidden /> Revisar</Badge>;
}

export function PpeChip({ label, state, confidence, optional }: { label: string; state: PpeState; confidence?: number; optional?: boolean }) {
  const conf = confidence ? ` ${Math.round(confidence * 100)}%` : "";
  const map = {
    present: { tone: "green" as const, icon: <CheckCircle2 size={12} aria-hidden />, txt: "Sí" },
    absent: { tone: optional ? ("slate" as const) : ("red" as const), icon: <XCircle size={12} aria-hidden />, txt: "No" },
    uncertain: { tone: "amber" as const, icon: <CircleHelp size={12} aria-hidden />, txt: "Incierto" },
    unknown: { tone: "slate" as const, icon: <CircleHelp size={12} aria-hidden />, txt: "Sin evidencia" },
  }[state];
  return (
    <Badge tone={map.tone} className="font-medium">
      {map.icon}
      {label}: {map.txt}
      {state !== "unknown" && <span className="tabular opacity-70">{conf}</span>}
    </Badge>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      <span className="mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx("h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent", p.className)} />;
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx("h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900", p.className)} />;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700", disabled && "opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent-strong" : "bg-slate-300")}
      >
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-4.5" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors",
            value === t.id ? "border-accent-strong text-navy-900" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {children && <div className="max-w-md text-xs text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} className={cx("anim-pop w-full rounded-xl bg-white shadow-xl", wide ? "max-w-4xl" : "max-w-lg")}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-slate-500 hover:bg-slate-100">
            <X size={16} />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(
    () =>
      onToast((t) => {
        setItems((x) => [...x.slice(-3), t]);
        setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.kind === "error" ? 8000 : 5000);
      }),
    [],
  );
  const icon = { success: <CheckCircle2 className="text-emerald-500" size={18} />, info: <Info className="text-cyan-600" size={18} />, warning: <AlertTriangle className="text-amber-500" size={18} />, error: <XCircle className="text-red-500" size={18} /> };
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className="anim-pop pointer-events-auto flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {icon[t.kind]}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{t.title}</p>
            {t.message && <p className="mt-0.5 whitespace-pre-line text-xs text-slate-600">{t.message}</p>}
          </div>
          <button aria-label="Cerrar" className="text-slate-400 hover:text-slate-700" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = "slate" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "slate" | "red" | "green" | "cyan" | "amber" }) {
  const t = { slate: "bg-slate-100 text-slate-600", red: "bg-red-50 text-red-600", green: "bg-emerald-50 text-emerald-600", cyan: "bg-cyan-50 text-cyan-700", amber: "bg-amber-50 text-amber-700" }[tone];
  return (
    <div className="anim-rise rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {icon && <span className={cx("rounded-lg p-1.5", t)}>{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-bold tracking-tight text-navy-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>}
      <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent-strong transition-all duration-300" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "medium" });
export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
