// Prueba E2E de humo (TC-01, TC-04, TC-05, TC-06, TC-09, TC-10 y notificación al celular).
// Requisitos: npm run build && npm run preview  (puerto 4173)
//             npm i -D playwright && npx playwright install chromium
// Opcional:   VIDEO=ruta/video.y4m para simular una cámara con un video real (ffmpeg -i in.mp4 -pix_fmt yuv420p out.y4m)
// Ejecutar:   node tests/e2e/smoke.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const URL = process.env.URL ?? "http://localhost:4173/";
const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
if (process.env.VIDEO) args.push(`--use-file-for-fake-video-capture=${process.env.VIDEO}`);

const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
const page = await ctx.newPage();
const errors = [];
const pushes = [];
page.on("pageerror", (e) => errors.push(e.message));
await ctx.route("https://ntfy.sh/**", async (route) => {
  pushes.push({ method: route.request().method(), url: decodeURIComponent(route.request().url()) });
  await route.fulfill({ status: 200, body: "{}", headers: { "access-control-allow-origin": "*" } });
});

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  await fn();
  console.log("ok");
};

await step("TC-01 login y dashboard", async () => {
  await page.goto(URL);
  await page.getByText("Administrador").first().click();
  await page.getByText("Resumen operativo").waitFor();
});

await step("Configurar ntfy y enviar prueba", async () => {
  await page.goto(URL + "#/admin/notifications");
  await page.getByText("ntfy (recomendado)").click();
  await page.getByRole("button", { name: "Generar" }).click();
  await page.getByRole("button", { name: /Enviar prueba/ }).click();
  await page.waitForTimeout(1000);
  assert.ok(pushes.length >= 1, "no se envió la prueba a ntfy");
});

await step("Análisis de escenario demo (combinado)", async () => {
  await page.goto(URL + "#/analysis?scenario=sc-industrial");
  await page.getByRole("button", { name: /^Analizar/ }).click();
  await page.getByText("Ver en el registro EPP").waitFor({ timeout: 30000 });
  assert.ok(await page.getByText("EPP incompleto").first().isVisible());
});

await step("TC-04/06 sesión en vivo con simulador", async () => {
  await page.goto(URL + "#/live");
  await page.locator("select").first().selectOption({ label: "🧪 Simulador de obra (video sintético)" });
  await page.locator("select").nth(1).selectOption("demo");
  await page.getByRole("button", { name: /^Iniciar/ }).click();
  await page.getByText("EN VIVO").first().waitFor();
  await page.waitForTimeout(7000);
  assert.ok((await page.getByText(/^TRK-00\d$/).count()) >= 2, "no hay tracks");
  await page.getByRole("button", { name: /Registrar ahora/ }).click();
});

await step("TC-05 finalizar y liberar recursos", async () => {
  await page.getByRole("button", { name: /Finalizar/ }).click();
  await page.getByText("Finalizada").first().waitFor();
});

await step("TC-09 alertas creadas y enviadas al celular", async () => {
  await page.goto(URL + "#/alerts");
  assert.ok((await page.getByText("Nueva").count()) >= 1);
  assert.ok(pushes.some((p) => p.method === "PUT" && p.url.includes("EPP")), "no se envió alerta EPP con imagen");
});

await step("TC-10 exportar CSV del registro EPP", async () => {
  await page.goto(URL + "#/persons");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Exportar CSV/ }).click()]);
  assert.match(dl.suggestedFilename(), /registro-epp-.*\.csv/);
});

assert.deepEqual(errors, [], `errores de página: ${errors.join(" | ")}`);
console.log(`\nTodo correcto · ${pushes.length} notificación(es) interceptadas`);
await browser.close();
