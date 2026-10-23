"""Health check and the static facts the frontend needs (metrics, dictionaries, limits)."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from ... import __version__, analysis, config, context_model, un_data
from ...config import ConfigError
from ...db import new_session
from ...events import EVENTS
from ...models import UNCountryYear
from ..schemas import Health, Meta

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=Health, responses={503: {"model": Health}})
def health():
    """Is the API up, can it reach the database, and is the UN data loaded?"""
    body = {"status": "ok", "database": "ok", "un_data": None, "version": __version__}
    try:
        with new_session() as session:
            statements = session.scalar(select(func.count()).select_from(UNCountryYear))
            run = un_data.latest_run(session)
            if run is not None:
                body["un_data"] = {"statements": statements, "countries": run.countries,
                                   "first_year": run.first_year, "last_year": run.last_year,
                                   "source": run.source, "loaded_at": run.finished_at.isoformat()}
    except ConfigError:
        body.update(status="degraded", database="not configured")
    except Exception:  # noqa: BLE001 - any failure here means the database is unreachable
        body.update(status="degraded", database="unavailable")
    return JSONResponse(status_code=200 if body["status"] == "ok" else 503, content=body)


@router.get("/meta", response_model=Meta)
def meta():
    """Metric definitions, default dictionaries and keywords, key events and upload limits."""
    return {
        "version": __version__,
        "metrics": [{"id": k, "label": v[0], "explanation": v[1], "higher_is_worse": v[2]}
                    for k, v in analysis.METRICS.items()],
        "default_dictionaries": {"hostile": analysis.HOSTILE_TERMS, "cooperative": analysis.COOPERATIVE_TERMS},
        "default_keywords": analysis.DEFAULT_KEYWORDS,
        "events": [{"year": y, "label": label} for y, label in EVENTS],
        "limits": {
            "max_text_chars": config.MAX_TEXT_CHARS,
            "max_upload_bytes": config.MAX_UPLOAD_BYTES,
            "max_batch_documents": config.MAX_BATCH_DOCUMENTS,
            "max_dataset_documents": config.MAX_DATASET_DOCUMENTS,
            "max_chart_countries": config.MAX_CHART_COUNTRIES,
            "max_terms": analysis.MAX_TERMS,
        },
        "context_model": {"available": context_model.available(),
                          "name": context_model.MODEL_NAME if context_model.available() else None},
        "citation": config.DATA_CITATION,
    }
