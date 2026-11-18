// Adaptadores de notificación al celular (puerto NotificationPort).
//  · ntfy     → app gratuita ntfy (Android / iOS). Sin cuenta: basta un "tema".
//  · telegram → bot de Telegram (token + chat_id).
//  · webhook  → URL propia (p. ej. server/ /api/v1/notify, n8n, Make, Zapier).
// Recomendación de seguridad (§11.1): en producción, los tokens viven en el
// backend; el frontend llama al relé server/ y no guarda secretos.
import type { NotificationSettings, Severity } from "../../core/domain/types";
import type { NotificationMessage, NotificationPort } from "../../core/ports";

const NTFY_PRIORITY: Record<Severity, number> = { low: 2, medium: 3, high: 4, critical: 5 };
const EMOJI: Record<Severity, string> = { low: "ℹ️", medium: "⚠️", high: "🚨", critical: "🛑" };

export class NtfyNotifier implements NotificationPort {
  readonly channel = "ntfy";
  constructor(private server: string, private topic: string) {}
  async send(msg: NotificationMessage) {
    if (!this.topic.trim()) return { ok: false, detail: "Falta el tema (topic) de ntfy." };
    const params = new URLSearchParams({
      title: msg.title,
      message: msg.message,
      priority: String(NTFY_PRIORITY[msg.severity]),
      tags: ["warning", ...msg.tags].join(","),
    });
    if (msg.clickUrl) params.set("click", msg.clickUrl);
    if (msg.image) params.set("filename", "evidencia.jpg");
    const url = `${this.server.replace(/\/$/, "")}/${encodeURIComponent(this.topic.trim())}?${params}`;
    const r = await fetch(url, { method: msg.image ? "PUT" : "POST", body: msg.image ?? msg.message });
    return r.ok ? { ok: true, detail: "Enviado a ntfy" } : { ok: false, detail: `ntfy respondió ${r.status}: ${(await r.text()).slice(0, 160)}` };
  }
}

export class TelegramNotifier implements NotificationPort {
  readonly channel = "telegram";
  constructor(private token: string, private chatId: string) {}
  async send(msg: NotificationMessage) {
    if (!this.token || !this.chatId) return { ok: false, detail: "Faltan el token del bot o el chat_id." };
    const base = `https://api.telegram.org/bot${this.token}`;
    const text = `${EMOJI[msg.severity]} *${escapeMd(msg.title)}*\n${escapeMd(msg.message)}`;
    let r: Response;
    if (msg.image) {
      const fd = new FormData();
      fd.append("chat_id", this.chatId);
      fd.append("caption", text);
      fd.append("parse_mode", "Markdown");
      fd.append("photo", msg.image, "evidencia.jpg");
      r = await fetch(`${base}/sendPhoto`, { method: "POST", body: fd });
    } else {
      r = await fetch(`${base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "Markdown" }),
      });
    }
    const body = await r.json().catch(() => ({}));
    return r.ok && body.ok ? { ok: true, detail: "Enviado a Telegram" } : { ok: false, detail: `Telegram: ${body.description ?? r.status}` };
  }
}

export class WebhookNotifier implements NotificationPort {
  readonly channel = "webhook";
  constructor(private url: string, private token?: () => Promise<string | undefined>) {}
  async send(msg: NotificationMessage) {
    if (!this.url) return { ok: false, detail: "Falta la URL del webhook." };
    const image = msg.image ? await blobToDataUrl(msg.image) : undefined;
    const auth = await this.token?.();
    const r = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify({ title: msg.title, message: msg.message, severity: msg.severity, tags: msg.tags, image }),
    });
    if (r.ok) return { ok: true, detail: "Webhook aceptado" };
    const body = await r.json().catch(() => ({}));
    return { ok: false, detail: `Webhook respondió ${r.status}${body.detail ? `: ${body.detail}` : ""}` };
  }
}

/** Notificación del sistema del dispositivo donde está abierta la app (incluido un celular). */
export async function browserNotify(msg: NotificationMessage) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    new Notification(`${EMOJI[msg.severity]} ${msg.title}`, { body: msg.message, tag: msg.tags.join("-"), icon: `${import.meta.env.BASE_URL}favicon.svg` });
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* algunos navegadores móviles solo permiten notificaciones desde un Service Worker */
  }
}

let tokenProvider: (() => Promise<string | undefined>) | undefined;
/** Token de sesión (Supabase) que el relé del backend valida. */
export function setNotifyTokenProvider(fn: () => Promise<string | undefined>) {
  tokenProvider = fn;
}

export function makeNotifier(s: NotificationSettings): NotificationPort | undefined {
  switch (s.channel) {
    case "ntfy":
      return new NtfyNotifier(s.ntfyServer || "https://ntfy.sh", s.ntfyTopic);
    case "telegram":
      return new TelegramNotifier(s.telegramToken, s.telegramChatId);
    case "webhook":
      return new WebhookNotifier(s.webhookUrl, tokenProvider);
    default:
      return undefined;
  }
}

function escapeMd(s: string) {
  return s.replace(/([_*`[])/g, "\\$1");
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(b);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
