from contextlib import closing
from pathlib import Path
import os
import sqlite3
import subprocess
import sys

from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool

from app import models  # noqa: F401
from app.db import Base
from app.schema_catalog import INITIAL_REVISION, SchemaState, inspect_schema
from app.schema_migrations import initialize_empty_database


def test_empty_database_is_created_at_initial_revision(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'empty.db'}", poolclass=NullPool)
    with engine.connect() as connection:
        initialize_empty_database(connection)
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == INITIAL_REVISION
    with closing(sqlite3.connect(tmp_path / "empty.db")) as current:
        assert inspect_schema(current) == SchemaState.CURRENT


def test_graph_has_one_initial_head():
    directory = Path(__file__).resolve().parents[1] / "app" / "migrations"
    graph = ScriptDirectory(str(directory))
    assert graph.get_heads() == graph.get_bases() == [INITIAL_REVISION]
    assert [revision.revision for revision in graph.walk_revisions()] == [INITIAL_REVISION]


def test_confirmed_alpha_is_recognized_read_only_and_never_stamped(tmp_path):
    database = tmp_path / "alpha.db"
    engine = create_engine(f"sqlite:///{database}", poolclass=NullPool)
    with engine.begin() as connection:
        Base.metadata.create_all(connection)
        connection.exec_driver_sql(
            "INSERT INTO campaigns (id, name, created_at) VALUES (?, ?, ?)",
            ("00000000-0000-4000-8000-000000000001", "Alpha", "2026-01-01"),
        )
    original = database.read_bytes()
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as current:
        assert inspect_schema(current) == SchemaState.ALPHA
    with engine.connect() as connection, pytest.raises(ValueError, match="empty SQLite"):
        initialize_empty_database(connection)
    assert database.read_bytes() == original
    assert list(tmp_path.iterdir()) == [database]


@pytest.mark.parametrize(("sql", "expected"), [
    ("UPDATE alembic_version SET version_num = '0002_unknown'", SchemaState.UNKNOWN),
    ("UPDATE alembic_version SET version_num = '0000_unknown'", SchemaState.UNKNOWN),
    ("DELETE FROM alembic_version", SchemaState.UNKNOWN),
    ("INSERT INTO alembic_version VALUES ('0002_unknown')", SchemaState.UNKNOWN),
    ("CREATE INDEX extra ON campaigns (name)", SchemaState.DRIFT),
    ("ALTER TABLE campaigns ADD COLUMN extra TEXT", SchemaState.DRIFT),
    ("ALTER TABLE alembic_version ADD COLUMN extra TEXT", SchemaState.DRIFT),
    ("PRAGMA user_version=77", SchemaState.UNKNOWN),
    ("PRAGMA application_id=2112", SchemaState.UNKNOWN),
    (
        "INSERT INTO sessions (token_hash,user_id,created_at) VALUES ('orphan','missing','2026-01-01')",
        SchemaState.INVALID,
    ),
])
def test_rejects_invalid_version_or_catalog_without_writing(tmp_path, sql, expected):
    database = tmp_path / "changed.db"
    engine = create_engine(f"sqlite:///{database}", poolclass=NullPool)
    with engine.connect() as connection:
        initialize_empty_database(connection)
        with connection.begin():
            connection.exec_driver_sql(sql)
    original = database.read_bytes()
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as current:
        assert inspect_schema(current) == expected
    with engine.connect() as connection, pytest.raises(ValueError, match="empty SQLite"):
        initialize_empty_database(connection)
    assert database.read_bytes() == original


def test_corrupt_file_remains_untouched(tmp_path):
    database = tmp_path / "invalid.db"
    database.write_bytes(b"not a SQLite database")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as current:
        assert inspect_schema(current) == SchemaState.INVALID
    with create_engine(f"sqlite:///{database}", poolclass=NullPool).connect() as connection:
        with pytest.raises(ValueError, match="readable, empty SQLite"):
            initialize_empty_database(connection)
    assert database.read_bytes() == b"not a SQLite database"


def test_partial_ddl_rolls_back_and_empty_initialization_can_retry(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fault.db'}", poolclass=NullPool)

    @event.listens_for(engine, "before_cursor_execute")
    def interrupt(connection, cursor, statement, *args):
        if statement.startswith("CREATE TABLE scenes"):
            raise OSError("simulated failure after earlier DDL")

    with engine.connect() as connection:
        with pytest.raises(OSError, match="simulated failure"):
            initialize_empty_database(connection)
        assert inspect_schema(connection.connection.driver_connection) == SchemaState.EMPTY
    event.remove(engine, "before_cursor_execute", interrupt)
    with engine.connect() as connection:
        initialize_empty_database(connection)
        assert inspect_schema(connection.connection.driver_connection) == SchemaState.CURRENT


def test_process_crash_rolls_back_initial_revision(tmp_path):
    database = tmp_path / "crash.db"
    code = """
from pathlib import Path
import os
import sys
from sqlalchemy import create_engine, event
from app.schema_migrations import initialize_empty_database

engine = create_engine(f"sqlite:///{Path(sys.argv[1])}")
@event.listens_for(engine, 'before_cursor_execute')
def interrupt(connection, cursor, statement, *args):
    if statement.startswith('CREATE TABLE scenes'):
        os._exit(37)
with engine.connect() as connection:
    initialize_empty_database(connection)
"""
    server = str(Path(__file__).resolve().parents[1])
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(filter(None, [server, os.environ.get("PYTHONPATH")])))
    result = subprocess.run([sys.executable, "-c", code, str(database)], env=env, timeout=20)
    assert result.returncode == 37
    # Recover the synthetic rollback journal using SQLite before inspecting.
    with closing(sqlite3.connect(database)) as current:
        assert inspect_schema(current) == SchemaState.EMPTY
    with create_engine(f"sqlite:///{database}", poolclass=NullPool).connect() as connection:
        initialize_empty_database(connection)
        assert inspect_schema(connection.connection.driver_connection) == SchemaState.CURRENT


def test_temp_version_cannot_mask_unknown_main_revision(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'main.db'}")
    with engine.connect() as connection:
        initialize_empty_database(connection)
        with connection.begin():
            connection.exec_driver_sql("UPDATE main.alembic_version SET version_num = '0002_unknown'")
            connection.exec_driver_sql("CREATE TEMP TABLE alembic_version (version_num TEXT)")
            connection.exec_driver_sql("INSERT INTO temp.alembic_version VALUES (?)", (INITIAL_REVISION,))
        assert inspect_schema(connection.connection.driver_connection) == SchemaState.UNKNOWN


def test_autocommit_connection_is_rejected_before_ddl(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'main.db'}", connect_args={"autocommit": True})
    with engine.connect() as connection:
        with pytest.raises(ValueError, match="transaction mode"):
            initialize_empty_database(connection)
        driver = connection.connection.driver_connection
        assert not driver.in_transaction
        assert inspect_schema(driver) == SchemaState.EMPTY


def test_attached_or_temporary_schemas_are_rejected(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'main.db'}", poolclass=NullPool)
    for sql in ("ATTACH ':memory:' AS auxiliary", "CREATE TEMP TABLE shadow (value TEXT)"):
        with engine.connect() as connection:
            connection.exec_driver_sql(sql)
            connection.commit()
            with pytest.raises(ValueError, match="main schema"):
                initialize_empty_database(connection)
            assert inspect_schema(connection.connection.driver_connection) == SchemaState.EMPTY


@pytest.mark.parametrize("pragma", [
    "PRAGMA main.journal_mode=OFF",
    "PRAGMA main.journal_mode=MEMORY",
    "PRAGMA main.journal_mode=WAL",
    "PRAGMA main.synchronous=OFF",
])
def test_unsafe_durability_settings_refuse_before_ddl(tmp_path, pragma):
    engine = create_engine(f"sqlite:///{tmp_path / 'main.db'}", poolclass=NullPool)
    with engine.connect() as connection:
        connection.exec_driver_sql(pragma)
        connection.commit()
        with pytest.raises(ValueError, match="DELETE journal and FULL synchronous"):
            initialize_empty_database(connection)
        assert inspect_schema(connection.connection.driver_connection) == SchemaState.EMPTY


def test_memory_database_is_not_the_file_initialization_path():
    with create_engine("sqlite://").connect() as connection:
        with pytest.raises(ValueError, match="file-backed"):
            initialize_empty_database(connection)
