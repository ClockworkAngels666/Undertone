"""
Test setup. By default every test run uses a fresh SQLite file. Set TEST_DATABASE_URL to run the
same tests against Postgres (CI does this with a Postgres service container).
"""
import os

os.environ["DLA_IGNORE_ENV_FILE"] = "1"     # never pick up a developer's .env.local (Neon)
os.environ.pop("VERCEL", None)
os.environ.pop("DLA_CONTEXT_MODEL", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402

from dla import db, un_data  # noqa: E402
from dla.models import Base  # noqa: E402


class FakeVader:
    """Fake VADER: a sentence containing 'bad' = −0.5, containing 'good' = +0.5, otherwise 0."""

    def polarity_scores(self, sentence):
        s = sentence.lower()
        return {"compound": -0.5 if "bad" in s else 0.5 if "good" in s else 0.0}


@pytest.fixture(scope="session")
def database(tmp_path_factory):
    sqlite_file = (tmp_path_factory.mktemp("db") / "test.sqlite3").as_posix()
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{sqlite_file}"
    os.environ["DATABASE_URL"] = url
    db.reset()
    from dla.__main__ import migrate

    migrate()
    yield url
    db.reset()


def clear_tables():
    with db.new_session() as session:
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != "alembic_version":
                session.execute(delete(table))
        session.commit()
    un_data.clear_cache()


@pytest.fixture
def client(database):
    clear_tables()
    from dla.api import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def demo_client(client):
    from dla import pipeline

    with db.new_session() as session:
        pipeline.seed_demo(session)
    return client


@pytest.fixture
def broken_database(database):
    """Point the app at an unreachable database for one test."""
    os.environ["DATABASE_URL"] = "postgresql+psycopg://nobody:secret@127.0.0.1:1/missing"
    db.reset()
    un_data.clear_cache()
    yield
    os.environ["DATABASE_URL"] = database
    db.reset()
