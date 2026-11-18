# Trazabilidad: documentos → implementación

Correspondencia paso a paso entre lo que piden los dos documentos y dónde está implementado.
Estado: ✅ implementado · 🟡 parcial / preparado · ⏭ fase posterior (según el propio documento).

## A. Plan de desarrollo por etapas (PDF §13)

| Etapa | Entregable | Estado | Dónde |
|---|---|---|---|
| 1. Base del proyecto | React + TS + Vite, layout, rutas, tema, navegación | ✅ | `src/app/`, `src/shared/ui` |
| 2. Dominio y datos demo | Tipos, repositorio, escenarios, reglas, datos semilla | ✅ | `src/core/domain`, `infrastructure/persistence`, `modules/scenarios/data` |
| 3. Dashboard | KPI, gráficos, actividad, alertas (derivados del repositorio) | ✅ | `modules/dashboard` |
| 4. Centro de análisis | Carga/selección, visor, progreso, overlays | ✅ | `modules/analysis` |
| 5. Segmentación y patrones | Máscaras, leyendas, reglas, paneles | ✅ | `ResultViewer`, `VisionPages`, `services.buildPatterns` |
| 6. Historial y reportes | Búsqueda, filtros, detalle, CSV | ✅ | `modules/history`, `infrastructure/export/csv.ts` |
| 7. Calidad y presentación | Responsive, accesibilidad, pruebas, animaciones | ✅ | `tests/`, `index.css` (prefers-reduced-motion) |
| 8. IA real (fase 2) | API Python, modelo | 🟡 modelo real en navegador + `server/` FastAPI | `infrastructure/vision/OnnxVisionAdapter.ts`, `server/app.py` |

## B. Fases del documento empresarial (DOCX §16)

| Fase | Estado | Notas |
|---|---|---|
| 0 Fundamentos | ✅ | Contratos (`core/ports`), estados, estructura de carpetas |
| 1 Frontend funcional + captura | ✅ | MediaDevices, selección de fuente, permisos, cleanup |
| 2 Simulación visual | ✅ | DemoVisionAdapter + simulador de video sintético; Track ID |
| 3 Reglas y alertas | ✅ | Zonas, reglas, deduplicación, alertas, historial |
| 4 Persistencia/API | 🟡 | Repositorio local; FastAPI para análisis y notificaciones |
| 5 Tiempo real | 🟡 | Notificaciones push al celular; WebSocket/SSE pendiente |
| 6 Visión real | 🟡 | Modelo real integrado; falta validación con datos de la empresa |

## C. Reglas de negocio (DOCX §8)

| Código | Implementación |
|---|---|
| RN-01 Autorización de cámara | `getUserMedia` solo al pulsar *Iniciar* (`LiveSessionController.start`) |
| RN-02 Fuente disponible | Verificación de pista `live` y `loadedmetadata` con tiempo límite |
| RN-03 UUID de sesión | `uid("ses")` |
| RN-04 Una sesión por operador | `start()` lanza conflicto si hay sesión PREPARING/ACTIVE/PAUSED |
| RN-05 Cambio de fuente | Selector deshabilitado mientras hay sesión |
| RN-06 Identificación de simulación | `EngineMode` en cada análisis, sesión, evento, alerta, persona y CSV; etiqueta en cabecera |
| RN-07 Detección asociada | Toda detección pertenece a un análisis o sesión |
| RN-08 Coordenadas válidas | `isValidBox` antes de renderizar o evaluar |
| RN-09 Track ID único | `PersonTracker` con secuencia monótona por sesión |
| RN-10 Evento trazable | `VisionEvent` con sesión/análisis, regla, fecha, `dedupKey` |
| RN-11 Alerta cerrada | `canTransitionAlert` (CLOSED es terminal) |
| RN-12 Liberación de recursos | `cleanup()` centralizado + `beforeunload` |
| RN-13 Metadatos mínimos | Miniaturas desactivadas por defecto |
| RN-14 Revisión humana | Estados de alerta, revisión de personas, avisos en UI y notificación |

## D. Casos de prueba (DOCX §13)

| ID | Cobertura |
|---|---|
| TC-01 Dashboard | E2E `smoke.mjs` |
| TC-02 Seleccionar cámara | Manual / E2E con `--use-fake-device-for-media-stream` |
| TC-03 Permiso denegado | Mensaje accionable (`cameraErrorMessage`), sesión queda FAILED sin streaming |
| TC-04 Iniciar streaming | E2E |
| TC-05 Detener streaming | E2E (estado *Finalizada*) |
| TC-06 Ejecutar simulación | E2E (simulador + motor demo) |
| TC-07 Track ID | Unit `tracker` |
| TC-08 Regla de zona | Unit `rules` |
| TC-09 Generar alerta | E2E + notificación interceptada |
| TC-10 Exportar | E2E (CSV registro EPP) |
| TC-11 Cámara desconectada | Evento `ended` de la pista → FAILED + cleanup |
| TC-12 Sesión duplicada | Unit máquina de estados + guardia en `start()` |
| TC-13 Coordenadas fuera de rango | Unit `isValidBox` |
| TC-14 Deduplicación | Unit `Deduplicator` |
| TC-15 Alerta cerrada | Unit `canTransitionAlert` |

## E. Ampliaciones solicitadas

| Requisito | Implementación |
|---|---|
| Registrar en vivo si una persona tiene EPP | `LivePage` + `LiveSessionController`: panel «Personas en escena», *Registrar ahora*, consolidación al finalizar |
| Registrar por imágenes casco, chaleco y personas | `AnalysisPage` (una o varias fotos) → `registerAnalysisPersons` |
| Registro de personas | `PersonsPage`: filtros, revisión humana, corrección, nombre/área, CSV |
| Notificación de advertencia en el celular | `infrastructure/notify` + `NotificationsPage` (ntfy con QR, Telegram, webhook) + relé `server/` |

## F. Decisiones tomadas (DOCX §20 «Decisiones que deben confirmarse»)

| Pregunta | Decisión v1 |
|---|---|
| ¿Solo frontend o con backend? | Frontend completo con repositorio local + backend FastAPI opcional |
| ¿La pausa detiene video, simulación o ambos? | Ambos (video y análisis); el tiempo en pausa se descuenta de la duración |
| ¿Sesión por operador o por instancia? | Una por instancia del navegador (equivale a operador en la demo) |
| ¿Geometría de zona? | Rectángulo normalizado, evaluado con el punto de apoyo (pies) |
| ¿Deduplicación? | Por regla + sesión/análisis + persona, con ventana configurable por regla |
| ¿Roles efectivos? | Administrador, Operador, Supervisor, Auditor (solo lectura) |
| ¿Retención? | Límites locales (p. ej. 3000 personas, 4000 eventos); borrado manual desde Configuración |
