"""Database engine and sessions (Neon Postgres in production, SQLite as the local fallback)."""
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from . import config


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    url = config.database_url()
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine
    # Neon's pooled endpoint (PgBouncer) does the real pooling, so keep a small pool per instance.
    # prepare_threshold=None: no server-side prepared statements, which transaction pooling dislikes.
    return create_engine(
        url,
        pool_size=3,
        max_overflow=2,
        pool_pre_ping=True,
        pool_recycle=300,
        connect_args={"prepare_threshold": None, "connect_timeout": 10},
    )


@lru_cache(maxsize=1)
def _session_factory():
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def new_session() -> Session:
    return _session_factory()()


def reset():
    """Forget the cached engine (tests switch databases)."""
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    _session_factory.cache_clear()
