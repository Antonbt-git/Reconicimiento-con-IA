// Sincronización con Supabase (opcional). Si VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
// están definidas, la app exige inicio de sesión con correo y contraseña, descarga los
// datos compartidos y sube los cambios locales. Sin ellas, funciona en modo local (demo).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role, User } from "../../core/domain/types";
import { repo, type DbState } from "./LocalRepository";

import { CLOUD_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from "../../shared/env";

export const cloudEnabled = CLOUD_ENABLED;
export const supabase: SupabaseClient | undefined = CLOUD_ENABLED ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : undefined;

/** Colección local → tabla remota. */
const TABLES = {
  analyses: "analyses",
  sessions: "video_sessions",
  persons: "person_records",
  events: "vision_events",
  alerts: "alerts",
  audit: "audit_logs",
  exports: "export_records",
} as const;
type Coll = keyof typeof TABLES;
type Item = { id: string } & Record<string, unknown>;

const PULL_LIMIT = 500;
const MAX_THUMB = 80_000; // bytes de dataURL por miniatura subida

export type SyncStatus = "off" | "idle" | "syncing" | "pending" | "error";
// Instantánea estable (useSyncExternalStore exige la misma referencia si no cambió).
let snapshot: { status: SyncStatus; lastError: string } = { status: cloudEnabled ? "idle" : "off", lastError: "" };
const statusListeners = new Set<() => void>();
function setStatus(s: SyncStatus, err = "") {
  if (snapshot.status === s && snapshot.lastError === err) return;
  snapshot = { status: s, lastError: err };
  statusListeners.forEach((l) => l());
}
export const syncStatus = {
  get: () => snapshot,
  subscribe: (l: () => void) => {
    statusListeners.add(l);
    return () => statusListeners.delete(l);
  },
};

// Referencias del último estado sincronizado: un objeto distinto = registro modificado.
const synced = new Map<Coll, Map<string, unknown>>();
let syncedConfig = "";
let applyingRemote = false;
let timer: number | undefined;
let pollTimer: number | undefined;
let unsubscribe: (() => void) | undefined;

function modeOf(x: Item): string | null {
  const m = (x.engineMode ?? x.mode) as string | undefined;
  return m === "REAL" || m === "SIMULATED" ? m : null;
}
function createdOf(x: Item): string {
  return (x.createdAt ?? x.startedAt ?? x.observedAt ?? x.occurredAt ?? new Date().toISOString()) as string;
}
function slim(x: Item): Item {
  const t = x.thumbnail as string | undefined;
  return t && t.length > MAX_THUMB ? { ...x, thumbnail: undefined } : x;
}
function configOf(s: DbState) {
  // Los secretos de notificación (token de Telegram) nunca se suben a la nube.
  const { telegramToken: _t, ...notif } = s.settings.notifications;
  void _t;
  return { rules: s.rules, zones: s.zones, classes: s.classes, settings: { ...s.settings, notifications: notif } };
}

// ----------------------------------------------------------- autenticación ---
export async function cloudSignIn(email: string, password: string): Promise<void> {
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
  await afterSignIn();
}

export async function cloudSignOut() {
  await flushCloud().catch(() => undefined);
  stopSync();
  await supabase?.auth.signOut();
  synced.clear();
  // No dejar datos de la organización en un equipo compartido.
  repo.reset(true);
  repo.update(() => ({ currentUserId: undefined }));
}

/** Restaura la sesión guardada por Supabase al recargar la página. */
export async function restoreCloudSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    repo.update(() => ({ currentUserId: undefined }));
    return false;
  }
  await afterSignIn();
  return true;
}

export async function accessToken(): Promise<string | undefined> {
  return (await supabase?.auth.getSession())?.data.session?.access_token;
}

async function afterSignIn() {
  const { data: u } = await supabase!.auth.getUser();
  if (!u.user) throw new Error("No se pudo obtener el usuario.");
  const { data: profiles, error } = await supabase!.from("profiles").select("id,email,full_name,role");
  if (error) throw new Error(`Perfil no disponible: ${error.message}. ¿Ejecutó supabase/schema.sql?`);
  const users: User[] = (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email, email: p.email, role: p.role as Role, status: "active" }));
  if (!users.some((x) => x.id === u.user!.id)) users.push({ id: u.user.id, name: u.user.email ?? "Usuario", email: u.user.email ?? "", role: "operator", status: "active" });
  repo.update(() => ({ users, currentUserId: u.user!.id }));
  await pull(true);
  startSync();
}

// --------------------------------------------------------------- descarga ---
export async function pull(includeConfig = false) {
  if (!supabase) return;
  setStatus("syncing");
  try {
    const results = await Promise.all(
      (Object.keys(TABLES) as Coll[]).map(async (c) => {
        const { data, error } = await supabase!.from(TABLES[c]).select("data").order("created_at", { ascending: false }).limit(PULL_LIMIT);
        if (error) throw error;
        return [c, (data ?? []).map((r) => r.data as Item)] as const;
      }),
    );
    const cfg = includeConfig ? await supabase.from("app_config").select("data").eq("id", "default").maybeSingle() : undefined;
    applyingRemote = true;
    repo.update((s) => {
      const patch: Partial<DbState> = {};
      for (const [c, remote] of results) {
        const local = s[c] as unknown as Item[];
        const pending = dirty(c, local);
        const byId = new Map(remote.map((r) => [r.id, r]));
        for (const l of local) if (pending.has(l.id) || !byId.has(l.id)) byId.set(l.id, l);
        const merged = [...byId.values()].sort((a, b) => createdOf(b).localeCompare(createdOf(a)));
        (patch as Record<string, unknown>)[c] = merged;
        const ref = new Map<string, unknown>();
        merged.forEach((m) => {
          if (!pending.has(m.id)) ref.set(m.id, m);
        });
        synced.set(c, ref);
      }
      if (cfg?.data?.data) {
        const d = cfg.data.data as ReturnType<typeof configOf>;
        Object.assign(patch, {
          rules: d.rules ?? s.rules,
          zones: d.zones ?? s.zones,
          classes: d.classes ?? s.classes,
          settings: d.settings ? { ...s.settings, ...d.settings, notifications: { ...s.settings.notifications, ...d.settings.notifications, telegramToken: s.settings.notifications.telegramToken } } : s.settings,
        });
      }
      return patch;
    });
    syncedConfig = JSON.stringify(configOf(repo.getState()));
    applyingRemote = false;
    setStatus(hasPending() ? "pending" : "idle");
  } catch (e) {
    applyingRemote = false;
    setStatus("error", (e as Error).message);
  }
}

// ----------------------------------------------------------------- subida ---
function dirty(c: Coll, items: Item[]): Set<string> {
  const ref = synced.get(c) ?? new Map();
  return new Set(items.filter((x) => ref.get(x.id) !== x).map((x) => x.id));
}
function hasPending() {
  const s = repo.getState();
  return (Object.keys(TABLES) as Coll[]).some((c) => dirty(c, s[c] as unknown as Item[]).size > 0);
}

async function push() {
  if (!supabase) return;
  const s = repo.getState();
  const role = s.users.find((u) => u.id === s.currentUserId)?.role;
  setStatus("syncing");
  try {
    for (const c of Object.keys(TABLES) as Coll[]) {
      const items = s[c] as unknown as Item[];
      const ids = dirty(c, items);
      if (!ids.size) continue;
      if (role === "auditor" && c !== "audit") continue; // solo lectura (RLS lo rechazaría)
      const rows = items
        .filter((x) => ids.has(x.id))
        .filter((x) => !(c === "analyses" && x.status === "processing"))
        .map((x) => ({ id: x.id, created_at: createdOf(x), mode: modeOf(x), status: (x.status as string) ?? (x.compliance as string) ?? null, data: slim(x) }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from(TABLES[c]).upsert(rows.slice(i, i + 200), { onConflict: "id" });
        if (error) throw error;
      }
      const ref = synced.get(c) ?? new Map();
      items.filter((x) => ids.has(x.id) && !(c === "analyses" && x.status === "processing")).forEach((x) => ref.set(x.id, x));
      synced.set(c, ref);
    }
    const cfg = JSON.stringify(configOf(s));
    if (cfg !== syncedConfig && (role === "admin" || role === "supervisor")) {
      const { error } = await supabase.from("app_config").upsert({ id: "default", data: JSON.parse(cfg), updated_at: new Date().toISOString() });
      if (error) throw error;
      syncedConfig = cfg;
    }
    setStatus(hasPending() ? "pending" : "idle");
  } catch (e) {
    setStatus("error", (e as Error).message);
  }
}

function schedule() {
  if (applyingRemote) return;
  clearTimeout(timer);
  setStatus("pending");
  timer = window.setTimeout(() => void push(), 1500);
}

function startSync() {
  stopSync();
  unsubscribe = repo.subscribe(schedule);
  // Trae lo que registran otros usuarios (alertas, personas) cada 60 s con la pestaña visible.
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void pull(false);
  }, 60_000);
  window.addEventListener("online", onOnline);
}
function onOnline() {
  void push();
}
function stopSync() {
  unsubscribe?.();
  unsubscribe = undefined;
  clearInterval(pollTimer);
  clearTimeout(timer);
  window.removeEventListener("online", onOnline);
}

/** Envía de inmediato lo pendiente (p. ej., antes de cerrar sesión). */
export async function flushCloud() {
  clearTimeout(timer);
  await push();
}
