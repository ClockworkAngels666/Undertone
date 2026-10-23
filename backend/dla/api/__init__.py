"""FastAPI application: every route lives under /api (Vercel sends /api/* to this service)."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from .. import __version__
from ..config import ConfigError, load_env_file
from .routes import analyze, datasets, meta, un

log = logging.getLogger("dla")

DB_UNAVAILABLE = "The database is unavailable right now. Please try again in a minute."


def _first_validation_message(errors):
    if not errors:
        return "Invalid request."
    err = errors[0]
    where = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path"))
    message = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
    return f"{where}: {message}" if where else message


def create_app() -> FastAPI:
    load_env_file()
    app = FastAPI(
        title="Diplomatic Language Analyzer API",
        version=__version__,
        description=(
            "Measures hostility, cooperation and tone in diplomatic texts with VADER and diplomatic "
            "dictionaries, and serves the pre-scored UN General Debate Corpus (Jankin, Baturo & Dasandi "
            "2024). Word counts ignore context; always read the sentences behind a number."
        ),
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        errors = exc.errors()
        return JSONResponse(status_code=422, content={
            "detail": _first_validation_message(errors),
            "errors": [{"loc": e.get("loc"), "msg": e.get("msg")} for e in errors[:20]],
        })

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_request: Request, exc: SQLAlchemyError):
        log.error("Database error: %s", exc)
        return JSONResponse(status_code=503, content={"detail": DB_UNAVAILABLE})

    @app.exception_handler(ConfigError)
    async def config_error(_request: Request, exc: ConfigError):
        log.error("Configuration error: %s", exc)
        return JSONResponse(status_code=503, content={"detail": DB_UNAVAILABLE})

    for module in (meta, analyze, un, datasets):
        app.include_router(module.router, prefix="/api")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   include_in_schema=False)
    async def not_found(path: str):
        return JSONResponse(status_code=404, content={"detail": f"No API endpoint at /api/{path}."})

    return app


app = create_app()
