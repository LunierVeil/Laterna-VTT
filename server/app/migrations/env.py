"""Alembic requires the explicit, transaction-bound connection from the foundation."""

from alembic import context

from app.schema_catalog import SchemaState, inspect_schema

connection = context.config.attributes.get("connection")
if context.is_offline_mode() or connection is None or not connection.in_transaction():
    raise RuntimeError("Laterna migrations require a caller-owned SQLite transaction.")
if connection.dialect.name != "sqlite" or connection.dialect.driver != "pysqlite":
    raise RuntimeError("Laterna migrations require synchronous SQLite.")
source = context.config.attributes.get("source_state")
driver = connection.connection.driver_connection
if (not driver.in_transaction or source not in (SchemaState.EMPTY, SchemaState.ALPHA)
        or inspect_schema(driver) is not source):
    raise RuntimeError("The locked SQLite source does not match the selected migration path.")

context.configure(connection=connection, transactional_ddl=True, version_table_schema="main")
context.run_migrations()
