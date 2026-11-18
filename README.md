# AURORA IX · Plataforma de análisis visual con supervisión de EPP

Implementación de los documentos **«Proyecto Visión Computacional IA – Arquitectura» (PDF)** y
**«Arquitectura, procedimientos y funciones – AURORA IX Enterprise» (DOCX)**, ampliada con:

- **Registro en vivo de EPP**: con la cámara (webcam, cámara USB o la del celular) el sistema detecta a cada
  persona y registra en tiempo real si lleva **casco**, **chaleco** (y mascarilla, opcional).
- **Registro por imágenes**: se cargan una o varias fotos y se registra a cada persona con su estado de EPP.
- **Alertas al celular**: cuando falta un EPP (o se cumple otra regla) llega una notificación push al
  celular con la **foto de evidencia** y la persona resaltada (ntfy, Telegram o webhook).

> **Modo REAL vs. SIMULACIÓN** — la app distingue siempre ambos modos (RN-06). El *modelo EPP real*
> ejecuta inferencia verdadera en el navegador; el *motor de demostración* devuelve resultados semilla
> para enseñar el flujo. Los resultados del modelo son estimaciones y **requieren revisión humana**:
> no se deben usar para sanciones automáticas.

---

## 1. Puesta en marcha (5 minutos)

Requisitos: **Node.js 20+**. (Opcional para el backend: Python 3.10+.)

```bash
npm install
npm run dev            # http://localhost:5173
```

Entre con cualquier perfil demo (Administrador, Operador, Supervisor, Auditor).

| Para… | Haga esto |
|---|---|
| Probar con fotos | **Nuevo análisis (fotos)** → *Cargar imágenes* (una o varias) → *Analizar* |
| Probar en vivo con la webcam | **Supervisión en vivo** → elija la cámara → *Iniciar* → acepte el permiso |
| Probar sin cámara | **Supervisión en vivo** → *Simulador de obra* → motor *Simulación* → *Iniciar* |
| Recibir alertas en el celular | **Alertas al celular** → ntfy → *Generar* tema → escanee el QR con la app ntfy → *Enviar prueba* |
| Ver a las personas registradas | **Registro EPP de personas** (filtros, revisión humana, nombre/área, CSV) |

### Usar la cámara del celular

La cámara del navegador solo funciona en **HTTPS** o `localhost`. Para abrir la app desde el celular en la misma red Wi-Fi:

```bash
npm run dev:https      # https://<IP-de-su-PC>:5173  (acepte el aviso del certificado local)
```

En el celular se usa la cámara trasera por defecto. Para producción publique `dist/` en un hosting con HTTPS.

### Compilar para producción

```bash
npm run build          # genera dist/ (estático: Netlify, Vercel, Nginx, GitHub Pages…)
npm run preview
```

---

## 2. Alertas al celular

| Canal | Configuración | Ventajas |
|---|---|---|
| **ntfy** (recomendado) | Instale *ntfy* (Android/iOS) → en la app «Suscribirse a un tema» → use el mismo tema que genera AURORA IX (o escanee el QR) | Gratis, sin cuenta, admite foto adjunta y prioridad |
| **Telegram** | Cree un bot con @BotFather, copie el token y el `chat_id` | Ideal para un grupo del equipo SST |
| **Webhook** | URL propia; recibe `POST {title, message, severity, tags, image}` | Integración con n8n, Make, Zapier o el backend incluido |

Política configurable: severidad mínima, máximo de envíos por minuto, adjuntar foto, y por regla
«Enviar al celular». Cada envío queda registrado (enviada / falló / omitida) y auditado; desde el
detalle de una alerta se puede **reenviar**.

> Seguridad: el tema de ntfy actúa como contraseña. Para producción, use el relé del backend
> (`/api/v1/notify`) para que los tokens vivan en variables de entorno del servidor y no en el navegador.

---

## 3. Cómo decide el sistema el estado de EPP

1. **Detección** (YOLOv8n EPP, 10 clases): `Persona, Casco, Sin casco, Chaleco, Sin chaleco, Mascarilla, Sin mascarilla, Cono, Maquinaria, Vehículo`.
2. **Asociación**: cada casco/chaleco se asigna a la persona cuya región esperada (cabeza / torso) lo contiene.
   Si el modelo ve un casco o una cabeza sin casco pero no la persona, se crea una *persona inferida*.
3. **Estado por EPP**: `Sí` (detectado), `No` (el modelo detecta explícitamente la ausencia), `Incierto`
   (confianza bajo el *umbral de revisión*), `Sin evidencia`.
4. **Cumplimiento**: `Cumple` si todos los EPP obligatorios están presentes; `EPP incompleto` si alguno
   falta con evidencia suficiente; en cualquier otro caso `Requiere revisión` (§7.2: no se afirma un
   incumplimiento por una detección incierta).
5. **En vivo**: cada persona recibe un *Track ID* temporal (TRK-001…, no es identidad). El estado de cada
   EPP se decide por **voto mayoritario** en los últimos N fotogramas; la alerta se emite si la falta
   **persiste** X segundos (configurable) y se **deduplica** por persona y regla.

EPP obligatorio, umbrales, ventana de suavizado y fotogramas por segundo se ajustan en **Configuración**.

---

## 4. Arquitectura (puertos y adaptadores)

```
USUARIO → React (presentación) → casos de uso (core/application) → dominio (core/domain)
                                         ↓
                              puertos (core/ports): VisionEngine · NotificationPort
                                         ↓
     OnnxVisionAdapter (REAL, navegador) | DemoVisionAdapter (SIMULATED) | ApiVisionAdapter (FastAPI)
     NtfyNotifier | TelegramNotifier | WebhookNotifier        LocalRepository (localStorage)
```

```
src/
  app/                 composición, rutas con protección por rol, layout (sidebar, cabecera con modo)
  core/
    domain/            entidades, EPP, tracker, reglas + deduplicación, máquinas de estado, geometría
    application/       casos de uso: analizar imagen, alertas, notificar, registrar personas, auditoría
    ports/             VisionEngine, NotificationPort
  infrastructure/
    vision/            OnnxVisionAdapter + ort.worker (Web Worker), DemoVisionAdapter, ApiVisionAdapter, yolo.ts
    notify/            ntfy, Telegram, webhook, notificación del sistema
    persistence/       LocalRepository + datos semilla (clases, reglas, zonas, usuarios)
    export/            CSV (con protección contra inyección de fórmulas)
  modules/             dashboard, analysis, streaming (LiveSessionController), scenarios, detections,
                       persons, alerts, history, settings (reglas/zonas, notificaciones, admin)
  shared/              UI, hooks, utilidades
server/                FastAPI: /api/v1/analyses (ONNX), /api/v1/notify (relé), /health
tests/unit             20 pruebas de dominio (Vitest)
tests/e2e              prueba de humo E2E (Playwright)
public/models          ppe-yolov8n.onnx (12 MB) · person-seg-yolov8n.onnx (13 MB)
```

El video **nunca sale del navegador** con el motor real: la inferencia corre en un Web Worker
(ONNX Runtime Web, WASM). Solo se persisten metadatos; las miniaturas de evidencia son opcionales
(desactivadas por defecto, RN-13).

---

## 5. Backend opcional (FastAPI)

```bash
cd server
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
# variables opcionales: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, NTFY_TOPIC, NTFY_SERVER, ALLOWED_ORIGINS
pytest -q tests
```

- `POST /api/v1/analyses` (multipart `file`, `mode`) → mismo contrato `VisionResult` que el navegador.
  En la app elija el motor **Servicio backend (API)** y configure la URL en *Configuración*.
- `POST /api/v1/notify` → relé hacia Telegram / ntfy; en *Alertas al celular* elija **Webhook** con
  `http://<servidor>:8000/api/v1/notify`.

Los endpoints de sesiones, alertas y dashboard del documento (§10) quedan como siguiente fase
(PostgreSQL + WebSocket/SSE); el frontend ya está desacoplado mediante el repositorio y los puertos.

---

## 6. Despliegue gratuito (Vercel + Supabase + Render)

| Pieza | Archivo incluido | Qué hace |
|---|---|---|
| Supabase | `supabase/schema.sql` | Tablas, roles (admin/operator/supervisor/auditor) y políticas RLS |
| Render | `render.yaml` | Backend FastAPI gratuito (relé de alertas protegido con el token de Supabase) |
| Vercel | `vercel.json` + variables de `.env.example` | Web con HTTPS (cámara en celular) |

Con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` la app pide correo y contraseña y sincroniza
análisis, personas, alertas, eventos, auditoría y configuración con Supabase (ícono de nube en la
cabecera). Sin ellas funciona en modo demo local. La guía paso a paso está en el documento
«Guía de despliegue gratuito de AURORA IX».

## 7. Pruebas

```bash
npm test                                  # 20 pruebas unitarias de dominio
npm run build && npm run preview &        # luego:
npm i -D playwright && npx playwright install chromium
npm run test:e2e                          # login, ntfy, análisis, en vivo, alertas, CSV
VIDEO=video.y4m npm run test:e2e          # simula una cámara con un video real
```

Ver `docs/TRAZABILIDAD.md` para la correspondencia entre cada requisito/caso de prueba de los
documentos y su implementación.

---

## 8. Modelo y licencias

- Detector EPP: YOLOv8n entrenado sobre *Construction Site Safety* (Roboflow Universe, **CC BY 4.0**),
  pesos publicados en `github.com/snehilsanyal/Construction-Site-Safety-PPE-Detection`. Validación del
  autor: mAP50 ≈ 0,80 / mAP50-95 ≈ 0,50. **No ha sido validado con imágenes de su empresa.**
- Segmentación de personas: YOLOv8n-seg (COCO).
- Los modelos YOLOv8 de Ultralytics se distribuyen bajo **AGPL-3.0**; para uso comercial cerrado
  revise la licencia de Ultralytics o reentrene con otra arquitectura.
- Para producción (Fase 6 del documento): reentrene con imágenes autorizadas de sus propias obras,
  mida precisión/recall por clase y documente límites (iluminación, distancia, oclusiones).
