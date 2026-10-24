"""python -m app  -> serve on :8000 using ./data/switch.db (demo seeded on first start).

The product demo uses the "journey" seed profile (the household before the hallway correction exists). Tests and
switch_backend/scripts/demo.py use the original "regression" profile explicitly. Reset at any time from Settings or
POST /demo/reset {"profile": "journey"}.
"""
import os
os.makedirs("data", exist_ok=True)
os.environ.setdefault("SWITCH_DB", "data/switch.db")
os.environ.setdefault("SWITCH_DEMO_PROFILE", "journey")
import uvicorn
from .main import create_app
if __name__ == "__main__":
    uvicorn.run(create_app(os.environ["SWITCH_DB"]), host=os.getenv("SWITCH_HOST", "127.0.0.1"), port=int(os.getenv("SWITCH_PORT", "8000")))
