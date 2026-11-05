"""D11 evidence using owned temporary DBs, not a source/Token DB adapter.

Only synthetic revision tables. Do not modify app.db, SQLite defaults or schemas.
"""
import asyncio
from contextlib import closing
import sqlite3

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine


async def probe(path, explicit_begin, *, rollback_writer=False):
    engine = create_async_engine(f'sqlite+aiosqlite:///{path}', future=True)
    try:
        async with engine.connect() as connection:
            assert (await connection.execute(text('PRAGMA journal_mode=WAL'))).scalar() == 'wal'
            await connection.commit()
        async with engine.begin() as connection:
            for table in ('geometry_revision', 'source_revision'):
                await connection.execute(text(f'CREATE TABLE {table} (revision INTEGER NOT NULL)'))
                await connection.execute(text(f'INSERT INTO {table} VALUES (1)'))
        async with AsyncSession(engine, expire_on_commit=False) as reader:
            if explicit_begin:
                await reader.execute(text('BEGIN'))
            geometry = (await reader.execute(text('SELECT revision FROM geometry_revision'))).scalar_one()
            connection = await reader.connection()
            raw = await connection.get_raw_connection()
            physical_transaction = raw.driver_connection.in_transaction
            assert reader.in_transaction()  # logical SQLAlchemy transaction in BOTH modes
            async with engine.begin() as writer:
                for table in ('geometry_revision', 'source_revision'):
                    await writer.execute(text(f'UPDATE {table} SET revision=2'))
                if rollback_writer:
                    await writer.rollback()
            sources = (await reader.execute(text('SELECT revision FROM source_revision'))).scalar_one()
            await reader.rollback()
        async with engine.connect() as fresh:
            current = ((await fresh.execute(text('SELECT revision FROM geometry_revision'))).scalar_one(),
                       (await fresh.execute(text('SELECT revision FROM source_revision'))).scalar_one())
        return geometry, sources, physical_transaction, current
    finally:
        await engine.dispose()


def test_default_python_legacy_and_actual_sqlalchemy_selects_can_mix_commits(tmp_path):
    with closing(sqlite3.connect(':memory:')) as native:
        assert native.autocommit == sqlite3.LEGACY_TRANSACTION_CONTROL
    geometry, sources, physical, current = asyncio.run(probe(tmp_path / 'legacy.db', False))
    assert physical is False
    assert (geometry, sources) == (1, 2)  # actual anomaly; AsyncSession alone is not a snapshot
    assert current == (2, 2)


def test_explicit_begin_retains_one_wal_read_snapshot_but_not_freshness(tmp_path):
    geometry, sources, physical, current = asyncio.run(probe(tmp_path / 'explicit.db', True))
    assert physical is True
    assert (geometry, sources) == (1, 1)
    assert current == (2, 2)  # coherent OLD capture, not an authorization lease


def test_rolled_back_writer_never_becomes_a_committed_capture(tmp_path):
    geometry, sources, physical, current = asyncio.run(probe(tmp_path / 'rollback.db', True, rollback_writer=True))
    assert physical is True
    assert (geometry, sources) == current == (1, 1)
