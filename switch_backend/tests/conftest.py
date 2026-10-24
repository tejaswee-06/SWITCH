import warnings, pytest
warnings.filterwarnings("ignore")
from fastapi.testclient import TestClient
from app.main import create_app

def hdr(tok): return {"Authorization": f"Bearer {tok}"}
OWNER, MEMBER, VIEWER, OTHER = (hdr(t) for t in ("demo-owner-token", "demo-member-token", "demo-viewer-token", "other-owner-token"))

@pytest.fixture()
def client():
    return TestClient(create_app(":memory:"))
