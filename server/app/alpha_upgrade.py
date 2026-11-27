"""Prepare a fenced Alpha upgrade candidate. PB-08C owns cutover and recovery."""

from collections.abc import Mapping
import hashlib
from itertools import zip_longest
import json
import os
from pathlib import Path
import shutil
from time import monotonic

from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.pool import NullPool

from .data_home import StoragePaths, resolve_storage
from .instance_backup import MAX_MANIFEST, _deadline_check, _measure, _regular_file, _upload_paths, verify_backup
from .instance_restore import _restore_backup, lock_restore_destination
from .pre_upgrade import (
    FENCE, UpgradeBlocked, UpgradeSnapshot, _directory_id, _mount_id,
    _require_known_schema, _require_owned_directory, _sync_directory, _sync_file, _write_exclusive, run_pre_upgrade,
)
from .schema_catalog import INITIAL_REVISION, SchemaState, inspect_schema
from .schema_migrations import stamp_alpha_staging
from .storage_lock import own_storage
from .storage_preflight import UPGRADE_STAGING_PREFIX, _entry, open_quiescent_sqlite

_RESERVE = 2 * 1024**3


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _validate_equivalence(snapshot: Path, staging: Path, schema: dict[str, set[str]],
                          manifest: dict, deadline: float) -> None:
    with (open_quiescent_sqlite(snapshot / "lanterna.db") as source,
          open_quiescent_sqlite(staging / "lanterna.db") as target):
        for database in (source, target):
            database.set_progress_handler(lambda: monotonic() >= deadline, 1000)
        if inspect_schema(source) is not SchemaState.ALPHA or inspect_schema(target) is not SchemaState.CURRENT:
            raise UpgradeBlocked("Каталог или ревизия копии не прошли верификацию.")
        for table in sorted(schema):
            # The frozen Alpha catalog supplies table names and primary keys.
            keys = source.execute(
                "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk", (table,),
            ).fetchall()
            if not keys:
                raise UpgradeBlocked("Не удалось определить порядок строк Alpha.")
            order = ", ".join(_quote(name) for name, in keys)
            query = f"SELECT * FROM main.{_quote(table)} ORDER BY {order}"
            for before, after in zip_longest(source.execute(query), target.execute(query)):
                _deadline_check(deadline)
                if before != after or any(type(a) is not type(b) for a, b in zip(before, after)):
                    raise UpgradeBlocked(f"Содержимое таблицы {table} изменилось при stamp.")

    expected_uploads = {staging / name for name in manifest["files"] if name.startswith("uploads/")}
    if set(_upload_paths(staging / "uploads", deadline)) != expected_uploads:
        raise UpgradeBlocked("Состав uploads изменился при stamp.")
    for name, expected in manifest["files"].items():
        path = staging / name
        if name != "lanterna.db" and _measure(path, deadline, limit=expected["size"]) != expected:
            raise UpgradeBlocked("Медиа или ключ изменились при stamp.")
        _sync_file(path)


def prepare_alpha_upgrade(paths: StoragePaths, destination: Path, *, server_dir: Path,
                          cwd: Path, env: Mapping[str, str]) -> UpgradeSnapshot:
    """Publish a verified copy that remains blocked from normal startup."""
    if paths.data_home is None:
        raise UpgradeBlocked("Для переноса Alpha требуется единый исходный DataHome.")
    home = Path(paths.data_home)
    if (not home.is_absolute() or not destination.is_absolute()
            or destination != destination.resolve(strict=False)
            or home != home.resolve(strict=True)
            or not _entry(destination.parent, directory=True)):
        raise UpgradeBlocked("Используйте канонические пути и существующий родительский каталог цели.")
    if (home == destination or home in destination.parents or destination in home.parents
            or any(part.startswith(UPGRADE_STAGING_PREFIX) for part in (*home.parts, *destination.parts))):
        raise UpgradeBlocked("Цель и исходный DataHome должны быть независимыми.")
    parent = destination.parent
    mount = _mount_id(parent)
    _require_owned_directory(parent)
    if os.path.lexists(destination):
        raise UpgradeBlocked("Целевой DataHome уже существует.")
    if shutil.disk_usage(parent).free < _RESERVE + MAX_MANIFEST:
        raise UpgradeBlocked("Недостаточно свободного места на целевом томе.")
    parent_id = _directory_id(parent)

    def check_parent():
        if _mount_id(parent) != mount or _directory_id(parent) != parent_id:
            raise UpgradeBlocked("Родительский каталог или mount цели изменился.")

    def sync_publication():
        check_parent()
        _sync_directory(parent, parent_id)

    def copy_and_stamp(attempt: UpgradeSnapshot):
        check_parent()
        schema = _require_known_schema(attempt.snapshot / "lanterna.db")
        deadline = monotonic() + 120
        manifest = verify_backup(attempt.snapshot, schema, deadline=deadline)
        with _regular_file(attempt.snapshot / "manifest.json") as stream:
            encoded = stream.read(MAX_MANIFEST + 1)
        if (len(encoded) > MAX_MANIFEST or hashlib.sha256(encoded).hexdigest() != attempt.manifest_sha256
                or json.loads(encoded) != manifest):
            raise UpgradeBlocked("Manifest снимка изменился после выдачи receipt.")
        payload = sum(file["size"] for file in manifest["files"].values())
        if shutil.disk_usage(parent).free < 2 * payload + _RESERVE + MAX_MANIFEST:
            raise UpgradeBlocked("Недостаточно свободного места для проверенной целевой копии.")

        def prepare(staging: Path, verified: dict, deadline: float):
            check_parent()
            if verified != manifest or _mount_id(staging) != mount:
                raise UpgradeBlocked("Manifest или mount целевой копии изменился.")
            staged_paths = resolve_storage({"LANTERNA_DATA_HOME": str(staging)}, server_dir=server_dir, cwd=cwd)
            with own_storage(staged_paths):
                database = staging / "lanterna.db"
                if _require_known_schema(database) != schema:
                    raise UpgradeBlocked("Целевая копия не соответствует Alpha.")
                staged_id = _directory_id(staging)
                uploads_id = _directory_id(staging / "uploads")
                fence = {
                    "format": "laterna-prepared-upgrade-target-v1",
                    "attempt_id": attempt.attempt_id,
                    "source_revision": attempt.source_revision,
                    "target_revision": attempt.target_revision,
                    "manifest_sha256": attempt.manifest_sha256,
                }
                _write_exclusive(staging / FENCE, json.dumps(fence, sort_keys=True).encode())
                url = URL.create("sqlite", database=database.as_uri(), query={"uri": "true", "mode": "rw"})
                engine = create_engine(url, poolclass=NullPool)
                with engine.connect() as connection:
                    stamp_alpha_staging(connection)
                _validate_equivalence(attempt.snapshot, staging, schema, manifest, deadline)
                _sync_directory(staging / "uploads", uploads_id)
                _sync_directory(staging, staged_id)
            check_parent()

        _restore_backup(attempt.snapshot, destination, schema, manifest, parent_identity=restore_parent,
                        deadline=deadline, env={}, prepare_upgrade=prepare, sync_publication=sync_publication)

    with lock_restore_destination(destination) as restore_parent:
        check_parent()
        return run_pre_upgrade(paths, server_dir=server_dir, cwd=cwd, env=env,
                               target_revision=INITIAL_REVISION, apply=copy_and_stamp)
