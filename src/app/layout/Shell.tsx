import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BellRing, Boxes, Cloud, CloudOff, ChevronRight, ClipboardList, Download, FileClock, Gauge, HardHat, Images, LayoutDashboard, ListChecks, LogOut, Menu,
  Palette, ScanSearch, Settings, Shapes, ShieldCheck, Smartphone, Sparkles, Users, UserCog, Video, X,
} from "lucide-react";
import { useCurrentUser, useDb } from "../../shared/hooks/useDb";
import { audit, login, logout } from "../../core/application/services";
import { cloudEnabled, cloudSignIn, cloudSignOut, pull, syncStatus } from "../../infrastructure/persistence/cloud";
import { repo } from "../../infrastructure/persistence/LocalRepository";
import { live } from "../../modules/streaming/LiveSessionController";
import { ENGINES } from "../engines";
import type { Role } from "../../core/domain/types";
import { ModeBadge, Toaster, cx } from "../../shared/ui";
import { ROLE_LABEL } from "../../shared/constants/roles";
import { useScreenEngineMode } from "../../shared/utils/uiMode";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: Role[];
}

export const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Resumen", items: [{ to: "/", label: "Dashboard", icon: <LayoutDashboard size={16} /> }] },
  {
    section: "Análisis visual",
    items: [
      { to: "/analysis", label: "Nuevo análisis (fotos)", icon: <ScanSearch size={16} /> },
      { to: "/live", label: "Supervisión en vivo", icon: <Video size={16} /> },
      { to: "/scenarios", label: "Galería de escenarios", icon: <Images size={16} /> },
    ],
  },
  {
    section: "Visión IA",
    items: [
      { to: "/vision/detections", label: "Detecciones", icon: <Boxes size={16} /> },
      { to: "/vision/segmentation", label: "Segmentación", icon: <Shapes size={16} /> },
      { to: "/vision/patterns", label: "Patrones", icon: <Sparkles size={16} /> },
    ],
  },
  {
    section: "Operaciones",
    items: [
      { to: "/persons", label: "Registro EPP de personas", icon: <HardHat size={16} /> },
      { to: "/alerts", label: "Alertas", icon: <BellRing size={16} /> },
      { to: "/history", label: "Historial", icon: <FileClock size={16} /> },
      { to: "/exports", label: "Exportaciones", icon: <Download size={16} /> },
    ],
  },
  {
    section: "Administración",
    items: [
      { to: "/admin/notifications", label: "Alertas al celular", icon: <Smartphone size={16} />, roles: ["admin", "supervisor"] },
      { to: "/admin/rules", label: "Reglas y zonas", icon: <ListChecks size={16} />, roles: ["admin", "supervisor"] },
      { to: "/admin/classes", label: "Clases", icon: <Palette size={16} />, roles: ["admin"] },
      { to: "/admin/users", label: "Usuarios", icon: <UserCog size={16} />, roles: ["admin"] },
      { to: "/admin/settings", label: "Configuración", icon: <Settings size={16} />, roles: ["admin"] },
      { to: "/admin/audit", label: "Auditoría", icon: <ShieldCheck size={16} />, roles: ["admin", "auditor", "supervisor"] },
    ],
  },
];

const ALL = NAV.flatMap((n) => n.items.map((i) => ({ ...i, section: n.section })));

export function canAccess(path: string, role?: Role) {
  const item = ALL.find((i) => i.to === path);
  return !item?.roles || (role && item.roles.includes(role));
}

export default function Shell() {
  const user = useCurrentUser();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const newAlerts = useDb((s) => s.alerts.filter((a) => a.status === "NEW").length);
  const defaultEngine = useDb((s) => s.settings.defaultEngine);
  const notifChannel = useDb((s) => s.settings.notifications.channel);
  const liveSnap = useSyncExternalStore(live.subscribe, live.getSnapshot);
  const current = ALL.find((i) => (i.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(i.to)));
  const screenMode = useScreenEngineMode();
  const engineMode = liveSnap.engine && (liveSnap.status === "ACTIVE" || liveSnap.status === "PAUSED") ? liveSnap.engine.mode : screenMode ?? ENGINES[defaultEngine].mode;

  const nav = (
    <nav className="flex h-full flex-col bg-navy-900 text-slate-300">
      <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-navy-950"><HardHat size={20} /></span>
        <span>
          <span className="block text-sm font-extrabold tracking-wide text-white">AURORA IX</span>
          <span className="block text-[10px] font-medium uppercase tracking-widest text-cyan-300/80">Supervisión EPP</span>
        </span>
      </Link>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((n) => {
          const items = n.items.filter((i) => canAccess(i.to, user?.role));
          if (!items.length) return null;
          return (
            <div key={n.section} className="mt-4">
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{n.section}</p>
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => cx("mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors", isActive ? "bg-navy-700 text-white shadow-inner" : "hover:bg-navy-800 hover:text-white")}
                >
                  {i.icon}
                  <span className="flex-1">{i.label}</span>
                  {i.to === "/alerts" && newAlerts > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{newAlerts}</span>}
                  {i.to === "/live" && liveSnap.status === "ACTIVE" && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-label="En vivo" />}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
      <div className="border-t border-navy-800 p-3 text-[10px] leading-relaxed text-slate-500">
        Modelo EPP: YOLOv8n · dataset Construction Site Safety (CC BY 4.0). Resultados con revisión humana.
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="w-64">{nav}</div>
          <button className="flex-1 bg-slate-900/40" aria-label="Cerrar menú" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">{open ? <X size={18} /> : <Menu size={18} />}</button>
          <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
            <Gauge size={14} className="shrink-0" />
            <span className="hidden sm:inline">{current?.section ?? "AURORA IX"}</span>
            <ChevronRight size={12} className="hidden sm:inline" />
            <span className="truncate font-semibold text-slate-800">{current?.label ?? ""}</span>
          </nav>
          <div className="flex-1" />
          {(liveSnap.status === "ACTIVE" || liveSnap.status === "PAUSED") && (
            <Link to="/live" className="flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-[11px] font-bold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {liveSnap.status === "ACTIVE" ? "EN VIVO" : "EN PAUSA"}
            </Link>
          )}
          <CloudBadge />
          <span title="Modo del motor activo (siempre visible)"><ModeBadge mode={engineMode} /></span>
          <Link to="/admin/notifications" title={notifChannel === "none" ? "Alertas al celular desactivadas" : `Alertas al celular: ${notifChannel}`} className={cx("hidden rounded-md p-1.5 sm:block", notifChannel === "none" ? "text-slate-400" : "text-emerald-600")}>
            <Smartphone size={16} />
          </Link>
          <Link to="/alerts" className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label={`${newAlerts} alertas nuevas`}>
            <BellRing size={16} />
            {newAlerts > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{newAlerts}</span>}
          </Link>
          <div className="hidden text-right sm:block">
            <p className="text-xs font-semibold text-slate-800">{user?.name}</p>
            <p className="text-[10px] text-slate-500">{user && ROLE_LABEL[user.role]}</p>
          </div>
          <button onClick={async () => { if (live.isCameraActive) await live.stop(); logout(); if (cloudEnabled) await cloudSignOut(); }} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </header>
        <main className="scrollbar-thin flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] p-4 md:p-6">
            <Suspense fallback={<div className="p-8 text-sm text-slate-500">Cargando módulo…</div>}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

export function LoginPage() {
  const users = useDb((s) => s.users);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="flex min-h-full items-center justify-center bg-navy-950 p-4" style={{ backgroundImage: "radial-gradient(circle at 20% 10%, rgba(6,182,212,.18), transparent 40%), radial-gradient(circle at 80% 90%, rgba(27,65,120,.6), transparent 50%)" }}>
      <div className="anim-pop w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 text-accent"><HardHat size={24} /></span>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-navy-900">AURORA IX</h1>
            <p className="text-xs text-slate-500">Plataforma de análisis visual · Supervisión de EPP</p>
          </div>
        </div>
        {cloudEnabled ? (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              try {
                await cloudSignIn(email.trim(), password);
                audit("LOGIN", "User", repo.getState().currentUserId ?? "");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="text-xs font-semibold text-slate-600">Ingrese con su cuenta de la organización</p>
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
            {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
            <button type="submit" disabled={busy} className="h-10 w-full rounded-lg bg-navy-900 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60">{busy ? "Ingresando…" : "Ingresar"}</button>
            <p className="text-[11px] leading-relaxed text-slate-400">Las cuentas las crea el administrador en Supabase. Los datos se guardan en la base de datos de la organización.</p>
          </form>
        ) : (
          <>
            <p className="mb-3 text-xs font-semibold text-slate-600">Acceso demostrativo — elija un perfil</p>
            <div className="space-y-2">
              {users.map((u) => (
                <button key={u.id} onClick={() => login(u.id)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-accent hover:bg-cyan-50/50">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">{u.role === "admin" ? <UserCog size={16} /> : u.role === "auditor" ? <ShieldCheck size={16} /> : u.role === "supervisor" ? <ClipboardList size={16} /> : <Users size={16} />}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">{ROLE_LABEL[u.role]}</span>
                    <span className="block text-[11px] text-slate-500">{u.email}</span>
                  </span>
                  <ChevronRight size={16} className="text-slate-400" />
                </button>
              ))}
            </div>
            <p className="mt-5 text-[11px] leading-relaxed text-slate-400">Modo local de demostración: los datos quedan solo en este navegador. Configure Supabase para usuarios reales (ver guía de despliegue).</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Indicador de sincronización con la nube (solo si Supabase está configurado). */
function CloudBadge() {
  const st = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  if (st.status === "off") return null;
  const map = { idle: ["text-emerald-600", "Nube: sincronizado"], syncing: ["text-cyan-600", "Nube: sincronizando…"], pending: ["text-amber-600", "Nube: cambios pendientes"], error: ["text-red-600", `Nube: error — ${st.lastError}`], off: ["", ""] } as const;
  const [cls, title] = map[st.status];
  return (
    <button onClick={() => void pull(false)} title={`${title} (clic para actualizar)`} aria-label={title} className={cx("hidden rounded-md p-1.5 sm:block", cls)}>
      {st.status === "error" ? <CloudOff size={16} /> : <Cloud size={16} />}
    </button>
  );
}
