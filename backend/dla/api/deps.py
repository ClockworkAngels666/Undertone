"""Shared FastAPI dependencies."""
from fastapi import Response

from ..db import new_session


def get_db():
    session = new_session()
    try:
        yield session
    finally:
        session.close()


def public_cache(response: Response):
    """UN data changes only when the pipeline runs, so let browsers and Vercel's CDN cache it."""
    response.headers["Cache-Control"] = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
