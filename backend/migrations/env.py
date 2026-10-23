"""Alembic environment: migrates whatever database DATABASE_URL points to (SQLite when unset)."""
from logging.config import fileConfig

from alembic import context

from dla.config import load_env_file
from dla.db import get_engine
from dla.models import Base

load_env_file()
if context.config.config_file_name is not None:
    fileConfig(context.config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(url=str(get_engine().url), target_metadata=target_metadata, literal_binds=True,
                      render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = context.config.attributes.get("connection")
    if connectable is not None:              # a connection passed in by dla.cli or the tests
        _run(connectable)
        return
    with get_engine().connect() as connection:
        _run(connection)


def _run(connection):
    # render_as_batch lets later migrations alter columns on SQLite too
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True,
                      compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
