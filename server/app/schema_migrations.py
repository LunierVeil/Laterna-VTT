"""Alembic foundation for a caller-owned empty database."""

from collections.abc import Callable
from pathlib import Path
import sqlite3

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import Connection

from .schema_catalog import INITIAL_REVISION, SchemaState, inspect_schema
from .storage_preflight import UPGRADE_STAGING_PREFIX, _entry


def initialize_empty_database(connection: Connection, *, seed: Callable[[Connection], None] | None = None) -> None:
    """Commit the initial revision atomically on a new, exclusively owned SQLite file."""
    _write_revision(connection, source=SchemaState.EMPTY, seed=seed)


def stamp_alpha_staging(connection: Connection) -> None:
    """Stamp a checked private Alpha copy inside the migration staging namespace."""
    _write_revision(connection, source=SchemaState.ALPHA)


def _write_revision(connection: Connection, *, source: SchemaState,
                    seed: Callable[[Connection], None] | None = None) -> None:
    if connection.dialect.name != "sqlite" or connection.dialect.driver != "pysqlite":
        raise ValueError("The migration foundation requires synchronous SQLite.")
    driver: sqlite3.Connection = connection.connection.driver_connection
    if driver.autocommit != sqlite3.LEGACY_TRANSACTION_CONTROL:
        raise ValueError("The migration foundation requires sqlite3 legacy transaction mode.")
    if connection.in_transaction() or driver.in_transaction:
        raise ValueError("The migration foundation must own its transaction.")

    databases = driver.execute("PRAGMA database_list").fetchall()
    if len(databases) != 1 or databases[0][1] != "main":
        raise ValueError("The migration foundation requires only the main schema.")
    if not databases[0][2]:
        raise ValueError("The migration foundation requires a file-backed SQLite database.")
    if source is SchemaState.ALPHA:
        from .pre_upgrade import FENCE

        staging = Path(databases[0][2]).parent
        if (not staging.parent.name.startswith(UPGRADE_STAGING_PREFIX)
                or not _entry(staging / FENCE, directory=False)):
            raise ValueError("Alpha stamp requires the fenced private migration staging directory.")
    try:
        journal = driver.execute("PRAGMA main.journal_mode").fetchone()
        synchronous = driver.execute("PRAGMA main.synchronous").fetchone()
    except sqlite3.DatabaseError as exc:
        raise ValueError("The initial revision requires a readable, empty SQLite database.") from exc
    if journal != ("delete",) or synchronous not in {(2,), (3,)}:
        raise ValueError("The migration foundation requires DELETE journal and FULL synchronous or stronger.")

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).with_name("migrations")).replace("%", "%%"))
    config.attributes.update(connection=connection, source_state=source)
    with connection.begin():
        if inspect_schema(driver) is not source:
            raise ValueError(f"The initial revision requires an {source.value} SQLite database.")
        # Python sqlite3 legacy transaction mode doesn't BEGIN for DDL.
        connection.exec_driver_sql("BEGIN IMMEDIATE")
        if source is SchemaState.EMPTY:
            command.upgrade(config, INITIAL_REVISION)
        else:
            command.stamp(config, INITIAL_REVISION)
        if seed is not None:
            seed(connection)
        if inspect_schema(driver) != SchemaState.CURRENT:
            raise ValueError("The initial SQLite revision failed validation.")
