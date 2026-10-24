"""Environment-based configuration. No secrets are hardcoded; see .env.example."""
from __future__ import annotations
import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = Path(os.getenv("SWITCH_ML_ARTIFACT_DIR", PACKAGE_DIR / "artifacts"))
PROJECT_DIR = PACKAGE_DIR.parent

MODEL_FILE = "casas_activity_context_random_forest.joblib"
VECTORIZER_FILE = "casas_feature_vectorizer.joblib"
METRICS_FILE = "casas_activity_context_metrics.json"
METADATA_FILE = "casas_training_metadata.json"

WINDOW_EVENTS = int(os.getenv("SWITCH_ML_WINDOW_EVENTS", "30"))
RANDOM_SEED = 42

# Optional LLM provider (OpenAI-compatible chat-completions endpoint). Unset => deterministic fallback only.
LLM_BASE_URL = os.getenv("SWITCH_LLM_BASE_URL", "")
LLM_API_KEY = os.getenv("SWITCH_LLM_API_KEY", "")
LLM_MODEL = os.getenv("SWITCH_LLM_MODEL", "")
LLM_TIMEOUT_S = float(os.getenv("SWITCH_LLM_TIMEOUT_S", "8"))

# Person 2 core API (proposed routes in the master spec; unverified until P2 publishes them)
CORE_API_URL = os.getenv("SWITCH_CORE_API_URL", "")
CORE_API_TOKEN = os.getenv("SWITCH_CORE_API_TOKEN", "")
CORE_API_TIMEOUT_S = float(os.getenv("SWITCH_CORE_API_TIMEOUT_S", "5"))

# Alexa+ adapter
MCP_BEARER_TOKEN = os.getenv("SWITCH_MCP_BEARER_TOKEN", "")  # simple local guard; NOT the OAuth 2.1 flow Alexa+ requires
HOUSEHOLD_ID = os.getenv("SWITCH_DEMO_HOUSEHOLD_ID", "hh_demo")
