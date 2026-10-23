"""Vercel entrypoint (`main:app`). Run locally with: uv run uvicorn main:app --reload"""
from dla.api import app

__all__ = ["app"]
