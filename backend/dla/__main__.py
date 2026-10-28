"""
Operator commands (run from backend/):

    uv run python -m dla migrate        create or upgrade the database tables
    uv run python -m dla download-un    download and verify the UN General Debate Corpus
    uv run python -m dla load-un        score the corpus and load it into the database
    uv run python -m dla seed-demo      load small FICTIONAL demo data (tests / offline development)
    uv run python -m dla status         which database is in use and what it contains
"""
import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import func, select

from . import config


def migrate():
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(config.BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(config.BACKEND_DIR / "migrations"))
    command.upgrade(cfg, "head")
    print("✅ Database schema is up to date.")


def masked_url():
    from .db import get_engine

    return get_engine().url.render_as_string(hide_password=True)


def status():
    from .db import new_session
    from .models import Dataset, Document, UNCountryYear, UNSentence
    from .un_data import latest_run

    print(f"Database: {masked_url()}")
    with new_session() as session:
        run = latest_run(session)
        if run is None:
            print("UN data: not loaded (run: python -m dla load-un)")
        else:
            print(f"UN data: {run.speeches:,} statements from {run.countries} countries, "
                  f"{run.first_year}–{run.last_year} (source: {run.source}, loaded {run.finished_at:%Y-%m-%d %H:%M})")
        for label, model in (("country-years", UNCountryYear), ("notable sentences", UNSentence),
                             ("user datasets", Dataset), ("user texts", Document)):
            print(f"  {label}: {session.scalar(select(func.count()).select_from(model)):,}")


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")     # never crash on symbols a console cannot show
    config.load_env_file()
    # Migrations and bulk loads use Neon's direct connection; the web app uses the pooled one.
    if os.environ.get("DATABASE_URL_UNPOOLED"):
        os.environ["DATABASE_URL"] = os.environ["DATABASE_URL_UNPOOLED"]
    parser = argparse.ArgumentParser(prog="python -m dla", description="Undertone operator CLI")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate", help="create or upgrade the database tables")
    sub.add_parser("download-un", help="download and verify the UN General Debate Corpus")
    load = sub.add_parser("load-un", help="score the UN corpus and load it into the database")
    load.add_argument("--file", type=Path, help="the corpus archive (default: newest data/raw/UNGDC_*)")
    load.add_argument("--workers", type=int, help="parallel scoring processes (default: CPU count − 1)")
    load.add_argument("--no-cache", action="store_true", help="re-score even if cached scores exist")
    demo = sub.add_parser("seed-demo", help="load small fictional demo data instead of the real corpus")
    demo.add_argument("--force", action="store_true", help="replace real UN data too")
    sub.add_parser("status", help="show which database is in use and what it contains")
    args = parser.parse_args(argv)

    from . import pipeline
    from .db import new_session

    try:
        if args.command == "migrate":
            print(f"Database: {masked_url()}")
            migrate()
        elif args.command == "download-un":
            pipeline.download()
        elif args.command == "load-un":
            print(f"Database: {masked_url()}")
            with new_session() as session:
                pipeline.run(session, args.file, args.workers, use_cache=not args.no_cache)
        elif args.command == "seed-demo":
            with new_session() as session:
                from .un_data import latest_run

                run = latest_run(session)
                if run is not None and run.source != "demo" and not args.force:
                    print("Real UN data is loaded; refusing to replace it with demo data (use --force).")
                    return 1
                summary = pipeline.seed_demo(session)
            print(f"✅ Demo data loaded: {summary['statements']} fictional statements.")
        elif args.command == "status":
            status()
    except pipeline.PipelineError as err:
        print(f"❌ {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
