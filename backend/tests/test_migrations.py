"""The Alembic migrations must create exactly the tables the models describe."""
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from dla import db
from dla.models import Base


def test_models_match_migrations(database):
    with db.get_engine().connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert diff == []
