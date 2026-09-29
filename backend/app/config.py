"""
AeroTwin-DT :: central configuration (all values come from environment variables).
"""
from __future__ import annotations
import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# --- security -------------------------------------------------------------- #
# HMAC key used to sign session tokens. MUST be set in production, otherwise a
# random key is generated per process and every restart logs everybody out.
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_urlsafe(48)
SECRET_KEY_IS_EPHEMERAL = not os.getenv("SECRET_KEY")
TOKEN_TTL_HOURS = float(os.getenv("TOKEN_TTL_HOURS", "12"))
MAX_FAILED_LOGINS = int(os.getenv("MAX_FAILED_LOGINS", "5"))
LOCKOUT_MINUTES = int(os.getenv("LOCKOUT_MINUTES", "10"))

# Bootstrap admin (created on first start if it does not exist). The admin is
# forced to change this password at first login.
ADMIN_LOGIN_ID = os.getenv("ADMIN_LOGIN_ID", "ADMIN").strip().upper()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Admin@12345")
ADMIN_NAME = os.getenv("ADMIN_NAME", "DRDO System Administrator")

# Self-registration.
#  * Operators may register themselves (they get NO drones until an admin assigns some).
#  * Admin registration is only possible with this secret invite key. Empty => admin
#    registration is DISABLED. Set it in the Render dashboard, share it only with real admins.
ADMIN_REGISTRATION_KEY = os.getenv("ADMIN_REGISTRATION_KEY", "").strip()
REGISTER_MAX_PER_HOUR = int(os.getenv("REGISTER_MAX_PER_HOUR", "10"))     # per IP

# CORS: comma separated list of allowed frontend origins ("*" for local dev).
CORS_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# Shared secret for the CAN edge-gateway ingest endpoint (empty => ingest disabled).
INGEST_KEY = os.getenv("INGEST_KEY", "")

# --- twin / persistence ----------------------------------------------------- #
MODELS_PATH = Path(os.getenv("MODELS_PATH", ROOT / "assets" / "dt_models.json"))
PERSIST_EVERY_N_FRAMES = int(os.getenv("PERSIST_EVERY_N_FRAMES", "60"))
HISTORY_RING = int(os.getenv("HISTORY_RING", "3600"))
TELEMETRY_KEEP_PER_DRONE = int(os.getenv("TELEMETRY_KEEP_PER_DRONE", "2000"))
NOTIFICATION_RETENTION_DAYS = int(os.getenv("NOTIFICATION_RETENTION_DAYS", "60"))
MAX_LIVE_TWINS = int(os.getenv("MAX_LIVE_TWINS", "12"))
DEFAULT_SPEED = float(os.getenv("DEFAULT_SPEED", "20"))

# --- seeding ---------------------------------------------------------------- #
SEED_DEMO_DRONES = _bool("SEED_DEMO_DRONES", True)
SEED_DEMO_OPERATORS = _bool("SEED_DEMO_OPERATORS", False)
DEMO_OPERATOR_PASSWORD = os.getenv("DEMO_OPERATOR_PASSWORD", "Operator@123")