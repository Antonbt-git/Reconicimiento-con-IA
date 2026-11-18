"""
AURORA IX · Servicio backend (fase de integración, §11 / §16).

- POST /api/v1/analyses  → inferencia EPP real con ONNX Runtime (mismo modelo que el navegador)
- POST /api/v1/notify    → relé de notificaciones al celular (Telegram / ntfy) sin exponer secretos
- GET  /health

Ejecutar:  pip install -r requirements.txt && uvicorn app:app --host 0.0.0.0 --port 8000
Variables: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, NTFY_SERVER (def. https://ntfy.sh), NTFY_TOPIC,
           ALLOWED_ORIGINS (def. "*"), MODEL_PATH (def. ../public/models/ppe-yolov8n.onnx),
           SUPABASE_URL + SUPABASE_ANON_KEY → exige un token de sesión válido de Supabase en
           /api/v1/analyses y /api/v1/notify (evita que terceros usen el relé o el modelo).
"""
from __future__ import annotations

import base64
import io
import os
import time
import uuid
from pathlib import Path

import httpx
import numpy as np
import onnxruntime as ort
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", ROOT.parent / "public" / "models" / "ppe-yolov8n.onnx"))
MAX_BYTES = 15 * 1024 * 1024
CLASSES = [
    ("hardhat", "Casco"), ("mask", "Mascarilla"), ("no_hardhat", "Sin casco"), ("no_mask", "Sin mascarilla"),
    ("no_vest", "Sin chaleco"), ("person", "Persona"), ("cone", "Cono de seguridad"), ("vest", "Chaleco"),
    ("machinery", "Maquinaria"), ("vehicle", "Vehículo"),
]

app = FastAPI(title="AURORA IX API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_session: ort.InferenceSession | None = None
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
_token_cache: dict[str, float] = {}


async def require_user(authorization: str | None = Header(default=None)) -> None:
    """Valida el token de Supabase del usuario (si el backend está configurado con Supabase)."""
    if not SUPABASE_URL:
        return  # modo abierto (desarrollo local)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Inicie sesión en AURORA IX (falta el token)")
    token = authorization.split(" ", 1)[1]
    now = time.time()
    if _token_cache.get(token, 0) > now:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{SUPABASE_URL}/auth/v1/user", headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(401, "Sesión inválida o vencida; vuelva a ingresar")
    if len(_token_cache) > 500:
        _token_cache.clear()
    _token_cache[token] = now + 300


def session() -> ort.InferenceSession:
    global _session
    if _session is None:
        if not MODEL_PATH.exists():
            raise HTTPException(503, f"Modelo no encontrado en {MODEL_PATH}")
        _session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    return _session


def letterbox(img: Image.Image, size: int = 640):
    w, h = img.size
    scale = min(size / w, size / h)
    nw, nh = round(w * scale), round(h * scale)
    pad_x, pad_y = (size - nw) // 2, (size - nh) // 2
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(img.resize((nw, nh), Image.BILINEAR), (pad_x, pad_y))
    arr = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    return arr, scale, pad_x, pad_y


def nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float = 0.45) -> list[int]:
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area = lambda b: (b[..., 2] - b[..., 0]) * (b[..., 3] - b[..., 1])
        iou = inter / (area(boxes[i]) + area(boxes[order[1:]]) - inter + 1e-9)
        order = order[1:][iou <= iou_thr]
    return keep


def detect(img: Image.Image, min_score: float = 0.2) -> list[dict]:
    w, h = img.size
    x, scale, px, py = letterbox(img)
    sess = session()
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]  # (14, 8400)
    scores_all = out[4:]
    cls = scores_all.argmax(0)
    scores = scores_all.max(0)
    m = scores > min_score
    if not m.any():
        return []
    cx, cy, bw, bh = out[0][m], out[1][m], out[2][m], out[3][m]
    xyxy = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], 1)
    cls, scores = cls[m], scores[m]
    dets: list[dict] = []
    for c in np.unique(cls):
        idx = np.where(cls == c)[0]
        for k in nms(xyxy[idx], scores[idx]):
            i = idx[k]
            x1 = max(0.0, (xyxy[i, 0] - px) / scale)
            y1 = max(0.0, (xyxy[i, 1] - py) / scale)
            x2 = min(w, (xyxy[i, 2] - px) / scale)
            y2 = min(h, (xyxy[i, 3] - py) / scale)
            if x2 - x1 < 2 or y2 - y1 < 2:
                continue
            cid, label = CLASSES[int(c)]
            dets.append({
                "id": f"DET-{uuid.uuid4().hex[:8]}", "classId": cid, "label": label,
                "confidence": round(float(scores[i]), 3),
                "box": {"x": round(float(x1 / w), 4), "y": round(float(y1 / h), 4), "width": round(float((x2 - x1) / w), 4), "height": round(float((y2 - y1) / h), 4)},
            })
    return sorted(dets, key=lambda d: -d["confidence"])


@app.get("/health")
async def health(deep: bool = False):
    """deep=1 además consulta Supabase: un ping periódico mantiene despiertos Render y Supabase."""
    out = {"status": "ok", "model": MODEL_PATH.name, "model_loaded": _session is not None, "mode": "REAL"}
    if deep and SUPABASE_URL:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{SUPABASE_URL}/rest/v1/heartbeat?select=id&limit=1", headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"})
            out["supabase"] = "ok" if r.status_code == 200 else f"http {r.status_code}"
        except Exception as e:  # noqa: BLE001
            out["supabase"] = f"error: {e}"
    return out


@app.post("/api/v1/analyses", dependencies=[Depends(require_user)])
async def analyze(file: UploadFile = File(...), mode: str = Form("combined")):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "La imagen supera 15 MB")
    # Validación por contenido, no por nombre (§12)
    if not (data[:2] == b"\xff\xd8" or data[:4] == b"\x89PNG" or data[8:12] == b"WEBP"):
        raise HTTPException(422, "El archivo no es una imagen JPG/PNG/WEBP válida")
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Imagen ilegible: {e}") from e
    t0 = time.perf_counter()
    dets = detect(img)
    return {
        "mode": "REAL",
        "engine": "Servicio de visión (FastAPI + ONNX Runtime)",
        "detections": dets,
        "masks": [],
        "durationMs": round((time.perf_counter() - t0) * 1000),
    }


class NotifyIn(BaseModel):
    title: str = Field(max_length=200)
    message: str = Field(max_length=2000)
    severity: str = "medium"
    tags: list[str] = []
    image: str | None = None  # data URL JPEG opcional


PRIORITY = {"low": "2", "medium": "3", "high": "4", "critical": "5"}


@app.post("/api/v1/notify", dependencies=[Depends(require_user)])
async def notify(body: NotifyIn):
    """Relé seguro: los tokens viven en variables de entorno del servidor."""
    img = base64.b64decode(body.image.split(",", 1)[1]) if body.image and "," in body.image else None
    sent: list[str] = []
    async with httpx.AsyncClient(timeout=15) as client:
        token, chat = os.getenv("TELEGRAM_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
        if token and chat:
            caption = f"{body.title}\n{body.message}"[:1000]
            if img:
                r = await client.post(f"https://api.telegram.org/bot{token}/sendPhoto", data={"chat_id": chat, "caption": caption}, files={"photo": ("evidencia.jpg", img, "image/jpeg")})
            else:
                r = await client.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat, "text": caption})
            if r.is_success:
                sent.append("telegram")
        topic = os.getenv("NTFY_TOPIC")
        if topic:
            server = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
            params = {"title": body.title, "message": body.message, "priority": PRIORITY.get(body.severity, "3"), "tags": ",".join(["warning", *body.tags])}
            if img:
                params["filename"] = "evidencia.jpg"
                r = await client.put(f"{server}/{topic}", params=params, content=img)
            else:
                r = await client.post(f"{server}/{topic}", params=params, content=body.message.encode())
            if r.is_success:
                sent.append("ntfy")
    if not sent:
        raise HTTPException(502, "Ningún canal configurado respondió (configure TELEGRAM_* o NTFY_TOPIC)")
    return {"ok": True, "channels": sent}
