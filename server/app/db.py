from __future__ import annotations

from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import DATABASE_URL


class Base(DeclarativeBase):
    pass


_engine_url = DATABASE_URL
if DATABASE_URL.get_backend_name() == "sqlite" and DATABASE_URL.database != ":memory:":
    # Only prepare_storage may create the file, with exclusive ownership.
    _engine_url = DATABASE_URL.set(database=Path(DATABASE_URL.database).as_uri()).update_query_dict(
        {"uri": "true", "mode": "rw"},
    )
engine = create_async_engine(_engine_url, echo=False, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db() -> None:
    # Миграций пока нет. Когда схема устаканится - alembic.
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # SQLite startup reaches this only for a newly reserved database (or
        # an in-memory fixture). Existing SQLite is validated before opening it.
        if engine.dialect.name != "sqlite":
            await conn.run_sync(_check_columns)


def _check_columns(conn) -> None:
    # create_all не добавляет колонки в существующие таблицы. Без этой
    # проверки старая база падает на первом запросе с "no such column".
    # Новую колонку, которая может быть NULL, добавляем сами - это безопасно
    # и не стоит пересоздания базы. Остальное - только пересоздать.
    insp = inspect(conn)
    for table in Base.metadata.sorted_tables:
        have = {c["name"] for c in insp.get_columns(table.name)}
        missing = [c for c in table.columns if c.name not in have]
        if table.name == "scenes" and "folder_id" not in have:
            # Additive upgrade: nullable FK, no table recreation or data rewrite.
            conn.exec_driver_sql('ALTER TABLE "scenes" ADD COLUMN "folder_id" VARCHAR(36) REFERENCES "scene_folders" ("id") ON DELETE SET NULL')
            missing = [c for c in missing if c.name != "folder_id"]
        for col in [c for c in missing if c.nullable and c.server_default is None and not c.foreign_keys]:
            ddl = col.type.compile(dialect=conn.dialect)
            conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}')
            missing.remove(col)
        missing = [c.name for c in missing]
        if missing:
            raise RuntimeError(
                f"в таблице {table.name} нет колонок {missing}: схема новее базы. "
                "Миграций пока нет - пересоздай базу (./dev.sh reset)."
            )


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
