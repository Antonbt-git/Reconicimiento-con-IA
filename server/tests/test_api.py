from pathlib import Path
import io
from fastapi.testclient import TestClient
from PIL import Image
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import app  # noqa: E402

client = TestClient(app)


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_rejects_non_image():
    r = client.post("/api/v1/analyses", files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 422


def test_analyze_returns_contract():
    buf = io.BytesIO()
    Image.new("RGB", (320, 240), (200, 200, 200)).save(buf, "JPEG")
    r = client.post("/api/v1/analyses", files={"file": ("a.jpg", buf.getvalue(), "image/jpeg")}, data={"mode": "detection"})
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "REAL" and isinstance(body["detections"], list)
    for d in body["detections"]:
        b = d["box"]
        assert 0 <= b["x"] <= 1 and 0 <= b["y"] <= 1 and b["width"] > 0


def test_auth_required_when_supabase_configured(monkeypatch):
    import app as appmod
    monkeypatch.setattr(appmod, "SUPABASE_URL", "https://example.supabase.co")
    r = client.post("/api/v1/notify", json={"title": "t", "message": "m"})
    assert r.status_code == 401
