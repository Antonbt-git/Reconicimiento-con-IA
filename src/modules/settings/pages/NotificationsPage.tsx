import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BellRing, CheckCircle2, Send, Smartphone, XCircle } from "lucide-react";
import { useCurrentUser, useDb } from "../../../shared/hooks/useDb";
import { repo } from "../../../infrastructure/persistence/LocalRepository";
import { audit, sendTestNotification } from "../../../core/application/services";
import type { NotificationSettings, NotifyChannel, Severity } from "../../../core/domain/types";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Toggle, cx } from "../../../shared/ui";

function randomTopic() {
  return `auroraix-epp-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export default function NotificationsPage() {
  const ns = useDb((s) => s.settings.notifications);
  const alerts = useDb((s) => s.alerts);
  const user = useCurrentUser();
  const canEdit = user?.role === "admin" || user?.role === "supervisor";
  const [result, setResult] = useState<{ ok: boolean; detail: string }>();
  const [testing, setTesting] = useState(false);
  const [qr, setQr] = useState<string>();

  const set = (patch: Partial<NotificationSettings>) => {
    repo.update((s) => ({ settings: { ...s.settings, notifications: { ...s.settings.notifications, ...patch } } }));
    audit("NOTIFY_SETTINGS", "Settings", "notifications", Object.keys(patch).filter((k) => !/token/i.test(k)).join(","));
  };

  const ntfyUrl = ns.ntfyTopic ? `${(ns.ntfyServer || "https://ntfy.sh").replace(/\/$/, "")}/${ns.ntfyTopic}` : "";
  useEffect(() => {
    if (ns.channel === "ntfy" && ntfyUrl) QRCode.toDataURL(ntfyUrl, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(undefined));
    else setQr(undefined);
  }, [ns.channel, ntfyUrl]);

  const recent = alerts.filter((a) => a.notified).slice(0, 8);

  return (
    <div>
      <PageHeader title="Alertas al celular" description="Cuando una regla se cumple (p. ej., persona sin casco o sin chaleco), AURORA IX envía una notificación push a su celular con la foto de evidencia." />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <fieldset disabled={!canEdit} className="space-y-4">
          <Card title="1 · Canal de envío">
            <div className="grid gap-2 p-4 sm:grid-cols-4">
              {([
                ["ntfy", "ntfy (recomendado)", "App gratis Android/iOS, sin cuenta"],
                ["telegram", "Telegram", "Bot propio + chat"],
                ["webhook", "Webhook", "Servidor propio, n8n, Make…"],
                ["none", "Desactivado", "Solo avisos en pantalla"],
              ] as [NotifyChannel, string, string][]).map(([id, t, d]) => (
                <button key={id} type="button" onClick={() => set({ channel: id })} className={cx("rounded-lg border p-3 text-left", ns.channel === id ? "border-accent-strong bg-cyan-50 ring-1 ring-accent-strong" : "border-slate-200 hover:bg-slate-50")}>
                  <p className="text-sm font-semibold">{t}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{d}</p>
                </button>
              ))}
            </div>
          </Card>

          {ns.channel === "ntfy" && (
            <Card title="2 · Configurar ntfy">
              <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
                <div className="space-y-3">
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-600">
                    <li>Instale la app <b>ntfy</b> en su celular (Google Play, F-Droid o App Store).</li>
                    <li>Genere un tema privado abajo (actúa como contraseña: no lo comparta).</li>
                    <li>En la app pulse <b>+</b> → «Suscribirse a un tema» y escriba el tema, o escanee el código QR.</li>
                    <li>Pulse <b>Enviar prueba</b>: debe llegar una notificación al celular.</li>
                  </ol>
                  <Field label="Servidor"><Input value={ns.ntfyServer} onChange={(e) => set({ ntfyServer: e.target.value.trim() })} placeholder="https://ntfy.sh" /></Field>
                  <Field label="Tema (topic)" hint="Use un nombre difícil de adivinar. Para máxima privacidad puede usar su propio servidor ntfy.">
                    <div className="flex gap-2">
                      <Input value={ns.ntfyTopic} onChange={(e) => set({ ntfyTopic: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) })} placeholder="auroraix-epp-xxxx" />
                      <Button type="button" onClick={() => set({ ntfyTopic: randomTopic() })}>Generar</Button>
                    </div>
                  </Field>
                </div>
                {qr && (
                  <div className="text-center">
                    <img src={qr} alt="Código QR del tema ntfy" className="mx-auto rounded-lg border border-slate-200" />
                    <p className="mt-1 max-w-[180px] break-all text-[10px] text-slate-500">{ntfyUrl}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {ns.channel === "telegram" && (
            <Card title="2 · Configurar Telegram">
              <div className="space-y-3 p-4">
                <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-600">
                  <li>En Telegram, hable con <b>@BotFather</b> → <code>/newbot</code> y copie el <b>token</b>.</li>
                  <li>Escriba cualquier mensaje a su bot (o agréguelo a un grupo del equipo SST).</li>
                  <li>Abra <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> y copie <code>chat.id</code>.</li>
                </ol>
                <Field label="Token del bot" hint="Se guarda solo en este navegador. En producción use el relé del backend (server/) para no exponerlo.">
                  <Input type="password" value={ns.telegramToken} onChange={(e) => set({ telegramToken: e.target.value.trim() })} placeholder="123456:ABC-DEF…" autoComplete="off" />
                </Field>
                <Field label="chat_id"><Input value={ns.telegramChatId} onChange={(e) => set({ telegramChatId: e.target.value.trim() })} placeholder="-1001234567890" /></Field>
              </div>
            </Card>
          )}

          {ns.channel === "webhook" && (
            <Card title="2 · Configurar webhook">
              <div className="space-y-3 p-4">
                <p className="text-xs text-slate-600">Se enviará un <code>POST</code> JSON <code>{"{ title, message, severity, tags, image }"}</code> (imagen en data URL). El backend incluido expone <code>/api/v1/notify</code>, que reenvía a Telegram o ntfy guardando los secretos en el servidor.</p>
                <Field label="URL"><Input value={ns.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value.trim() })} placeholder="http://localhost:8000/api/v1/notify" /></Field>
              </div>
            </Card>
          )}

          <Card title="3 · Política de envío">
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Severidad mínima para enviar">
                <Select value={ns.minSeverity} onChange={(e) => set({ minSeverity: e.target.value as Severity })}>
                  <option value="low">Baja (todas)</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Solo crítica</option>
                </Select>
              </Field>
              <Field label="Máximo de envíos por minuto" hint="Evita saturar el celular si hay muchas faltas a la vez.">
                <Input type="number" min={1} max={60} value={ns.maxPerMinute} onChange={(e) => set({ maxPerMinute: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} />
              </Field>
              <Toggle checked={ns.attachEvidence} onChange={(v) => set({ attachEvidence: v })} label="Adjuntar foto de evidencia con la caja resaltada" />
              <Toggle checked={ns.browserNotifications} onChange={(v) => { set({ browserNotifications: v }); if (v && "Notification" in window) void Notification.requestPermission(); }} label="También notificación del sistema en este dispositivo" />
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Además, cada regla puede activar o desactivar «Enviar al celular» en <b>Reglas y zonas</b>. La foto se envía al servicio elegido; no se guarda en AURORA IX salvo que active las miniaturas de evidencia.</p>
          </Card>
        </fieldset>

        <div className="space-y-4">
          <Card title="Probar">
            <div className="space-y-3 p-4">
              <Button
                variant="accent"
                className="w-full"
                disabled={testing}
                onClick={async () => {
                  setTesting(true);
                  setResult(await sendTestNotification());
                  setTesting(false);
                }}
              >
                <Send size={16} /> Enviar prueba al celular
              </Button>
              {result && (
                <div className={cx("flex items-start gap-2 rounded-lg p-3 text-xs", result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>
                  {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {result.detail}
                </div>
              )}
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="mb-1 flex items-center gap-1 font-semibold"><Smartphone size={14} /> Ejemplo de notificación</p>
                <p className="font-semibold">🚨 AURORA IX · EPP incompleto (casco / chaleco)</p>
                <p>TRK-003: falta casco · Severidad: HIGH · con foto adjunta</p>
              </div>
            </div>
          </Card>
          <Card title="Últimos envíos">
            <ul className="divide-y divide-slate-100">
              {recent.length === 0 && <li className="px-4 py-6 text-center text-xs text-slate-500"><BellRing className="mx-auto mb-1 text-slate-300" />Aún no se han enviado alertas.</li>}
              {recent.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{a.message}</span>
                  <Badge tone={a.notified === "sent" ? "green" : a.notified === "failed" ? "red" : "slate"}>{a.notified === "sent" ? "Enviada" : a.notified === "failed" ? "Falló" : "Omitida"}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
