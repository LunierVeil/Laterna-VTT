"""SQLite schema identity shared by the PB-07 gate and the migration foundation."""

from enum import StrEnum
import hashlib
import json
import sqlite3

INITIAL_REVISION = "0001_alpha_baseline"
ALPHA_CATALOG_SHA256 = "9ad6459f345338d3cb76f5720090000b2f56bf2d1f439cfb53513d5979700c4b"


class SchemaState(StrEnum):
    EMPTY = "empty"
    ALPHA = "alpha"
    CURRENT = "current"
    UNKNOWN = "unknown"
    DRIFT = "drift"
    INVALID = "invalid"


def sqlite_catalog(connection: sqlite3.Connection) -> list[tuple]:
    return connection.execute(
        "SELECT type,name,tbl_name,sql FROM main.sqlite_schema "
        "WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name"
    ).fetchall()


def catalog_digest(catalog: list[tuple]) -> str:
    return hashlib.sha256(json.dumps(catalog, ensure_ascii=False).encode()).hexdigest()


_VERSION_TABLE = (
    "CREATE TABLE alembic_version ( version_num VARCHAR(32) NOT NULL, "
    "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num) )"
)


def identify_schema(connection: sqlite3.Connection) -> SchemaState:
    """Identify the exact catalog and revision; the caller checks integrity and foreign keys."""
    if (connection.execute("PRAGMA main.application_id").fetchone() != (0,)
            or connection.execute("PRAGMA main.user_version").fetchone() != (0,)):
        return SchemaState.UNKNOWN
    catalog = sqlite_catalog(connection)
    if not catalog:
        if connection.execute("SELECT 1 FROM main.sqlite_schema LIMIT 1").fetchone() is None:
            return SchemaState.EMPTY
        return SchemaState.UNKNOWN

    version = next((row for row in catalog if row[1] == "alembic_version"), None)
    if version is None:
        if catalog_digest(catalog) != ALPHA_CATALOG_SHA256:
            return SchemaState.UNKNOWN
        return SchemaState.ALPHA
    if version[:3] != ("table", "alembic_version", "alembic_version"):
        return SchemaState.DRIFT
    if " ".join((version[3] or "").split()) != _VERSION_TABLE:
        return SchemaState.DRIFT
    revisions = connection.execute("SELECT version_num FROM main.alembic_version LIMIT 2").fetchall()
    if revisions != [(INITIAL_REVISION,)]:
        return SchemaState.UNKNOWN
    if catalog_digest([row for row in catalog if row != version]) != ALPHA_CATALOG_SHA256:
        return SchemaState.DRIFT
    return SchemaState.CURRENT


def has_active_campaign_scene(connection: sqlite3.Connection) -> bool:
    return connection.execute(
        "SELECT 1 FROM campaigns JOIN scenes ON scenes.id = campaigns.active_scene_id "
        "AND scenes.campaign_id = campaigns.id LIMIT 1"
    ).fetchone() is not None


def inspect_schema(connection: sqlite3.Connection) -> SchemaState:
    """Classify schema and integrity without issuing write statements.

    SQLite may recover a hot journal while reading a read-write connection.
    The caller owns storage locks, sidecar checks and the policy for opening
    the file. This function does not establish those guarantees.
    """
    try:
        if connection.execute("PRAGMA main.integrity_check(1)").fetchall() != [("ok",)]:
            return SchemaState.INVALID
        state = identify_schema(connection)
        if state not in (SchemaState.ALPHA, SchemaState.CURRENT):
            return state
        if connection.execute("PRAGMA main.foreign_key_check").fetchone() is not None:
            return SchemaState.INVALID
        return state
    except sqlite3.DatabaseError:
        return SchemaState.INVALID
