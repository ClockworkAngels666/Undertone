"""Settings read from environment variables, plus the app's fixed limits."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
DATA_DIR = REPO_DIR / "data"
LOCAL_SQLITE_PATH = DATA_DIR / "local.sqlite3"

# Request limits. Vercel rejects request bodies above 4.5 MB, so uploads stay below that.
MAX_TEXT_CHARS = 200_000            # one text to analyze (~30,000 words)
MAX_UPLOAD_BYTES = 4_000_000        # one .txt/.pdf file
MAX_BATCH_DOCUMENTS = 100           # documents per upload request (the frontend sends CSVs in batches)
MAX_DATASET_DOCUMENTS = 5_000
MAX_TOTAL_DOCUMENTS = 200_000       # guard for the free database tier
MAX_CHART_COUNTRIES = 8
SHORT_TEXT_WORDS = 500          # below this, rates per 1,000 words swing too much for a fair comparison
RESCORE_BATCH = 200

DATA_CITATION = (
    "Jankin, S., Baturo, A., & Dasandi, N. (2024). Words to unite nations: The complete United Nations "
    "General Debate Corpus, 1946–present. Journal of Peace Research. https://doi.org/10.7910/DVN/0TJX8Y"
)


class ConfigError(RuntimeError):
    """The app is misconfigured (for example no database URL in production)."""


def on_vercel():
    """True in Vercel deployments (production and preview), False locally, including under `vercel dev`."""
    return bool(os.environ.get("VERCEL")) and os.environ.get("VERCEL_ENV") != "development"


def load_env_file():
    """Local development: read .env.local / .env from the repository root (written by `vercel env pull`).

    Variables already set in the environment win. Ignored on Vercel and when DLA_IGNORE_ENV_FILE=1.
    """
    if on_vercel() or os.environ.get("DLA_IGNORE_ENV_FILE") == "1":
        return
    for name in (".env.local", ".env"):
        path = REPO_DIR / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.removeprefix("export ").split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(key.strip(), value)


def database_url():
    """SQLAlchemy URL: DATABASE_URL (Neon Postgres) or, for local development only, a SQLite file."""
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        if on_vercel():
            raise ConfigError("DATABASE_URL is not set.")
        LOCAL_SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{LOCAL_SQLITE_PATH.as_posix()}"
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def context_model_enabled():
    """The optional transformer model runs only when explicitly switched on (never on Vercel)."""
    return os.environ.get("DLA_CONTEXT_MODEL", "").lower() in {"1", "true", "yes"} and not on_vercel()
