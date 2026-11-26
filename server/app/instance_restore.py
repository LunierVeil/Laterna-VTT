"""Publish a verified backup as a new, isolated DataHome."""

from collections.abc import Callable, Mapping
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
from tempfile import mkdtemp
from time import monotonic

from .data_home import resolve_storage
from .instance_backup import BackupError, _deadline_check, _measure, _publish, verify_backup
from .storage_lock import own_storage
from .storage_preflight import UPGRADE_STAGING_PREFIX, StorageError, _entry, check_storage


def _same_directory(path: Path, original: os.stat_result) -> bool:
    return _entry(path, directory=True) and os.path.samestat(path.lstat(), original)


def restore_backup(backup_path: Path, destination_data_home: Path, schema: dict[str, set[str]], *,
                   external_gm_key: str | None = None) -> dict:
    """Restore into a nonexistent directory under an existing trusted parent."""
    if not backup_path.is_absolute() or not destination_data_home.is_absolute():
        raise BackupError("Для восстановления нужны абсолютные пути.")
    deadline = monotonic() + 120
    manifest = verify_backup(backup_path, schema, deadline=deadline)
    env = {}
    if manifest["key_mode"] == "external":
        if not external_gm_key or not external_gm_key.strip() or "\0" in external_gm_key:
            raise BackupError("Для восстановления и запуска нужен исходный LANTERNA_GM_KEY.")
        env["LANTERNA_GM_KEY"] = external_gm_key

    try:
        canonical_target = destination_data_home.resolve(strict=False)
        canonical_backup = backup_path.resolve(strict=True)
        if canonical_target == canonical_backup or canonical_backup in canonical_target.parents:
            raise BackupError("Целевой DataHome находится внутри резервной копии.")
        with lock_restore_destination(destination_data_home) as parent_identity:
            return _restore_backup(backup_path, destination_data_home, schema, manifest,
                                   parent_identity=parent_identity, deadline=deadline, env=env)
    except (OSError, StorageError, ValueError) as exc:
        raise BackupError(f"Не удалось восстановить DataHome: {exc}") from exc


@contextmanager
def lock_restore_destination(destination: Path):
    """Reserve a new DataHome through publication and retain its parent identity."""
    parent = destination.parent
    if not _entry(parent, directory=True):
        raise BackupError("Родительский каталог DataHome отсутствует.")
    parent_identity = parent.lstat()
    paths = resolve_storage({"LANTERNA_DATA_HOME": str(destination)}, server_dir=parent, cwd=parent)
    with own_storage(paths):
        _check_destination(destination, parent_identity)
        yield parent_identity


def _check_destination(destination: Path, parent_identity: os.stat_result) -> None:
    if not _same_directory(destination.parent, parent_identity):
        raise BackupError("Родительский каталог DataHome был заменён.")
    if os.path.lexists(destination):
        raise BackupError("Целевой DataHome уже существует.")


def _restore_backup(
    backup_path: Path, destination_data_home: Path, schema: dict[str, set[str]], manifest: dict, *,
    parent_identity: os.stat_result, deadline: float, env: Mapping[str, str],
    prepare_upgrade: Callable[[Path, dict, float], None] | None = None,
    sync_publication: Callable[[], None] | None = None,
) -> dict:
    """Restore with the destination locks held by the caller."""
    _check_destination(destination_data_home, parent_identity)
    parent = destination_data_home.parent
    try:
        prefix = UPGRADE_STAGING_PREFIX if prepare_upgrade else ".laterna-restore-"
        temporary = Path(mkdtemp(prefix=prefix, dir=parent))
        temporary_identity = temporary.lstat()
        try:
            staging = temporary / "data"
            staging.mkdir(mode=0o700)
            staging_identity = staging.lstat()

            def check_staging():
                if not (_same_directory(parent, parent_identity)
                        and _same_directory(temporary, temporary_identity)
                        and _same_directory(staging, staging_identity)):
                    raise BackupError("Каталог восстановления был заменён.")

            check_staging()
            (staging / "uploads").mkdir(mode=0o700)
            # verify_backup matched these names to the exact on-disk inventory
            # and checked each upload name before we use it as a path.
            for name, expected in manifest["files"].items():
                check_staging()
                measured = _measure(backup_path / name, deadline, target=staging / name,
                                    limit=expected["size"])
                if measured != expected:
                    raise BackupError("Файл резервной копии изменился после проверки.")
            check_staging()
            staged_manifest = staging / "manifest.json"
            with staged_manifest.open("x", encoding="utf-8") as output:
                json.dump(manifest, output, ensure_ascii=False)
            if verify_backup(staging, schema, deadline=deadline) != manifest:
                raise BackupError("Manifest восстановленной копии не совпадает.")
            staged_paths = resolve_storage({"LANTERNA_DATA_HOME": str(staging)}, server_dir=parent, cwd=parent)
            if check_storage(staged_paths, server_dir=parent, cwd=parent, env=env, schema=schema) != "existing":
                raise BackupError("Восстановленная копия не прошла startup preflight.")
            check_staging()
            staged_manifest.unlink()
            if prepare_upgrade is not None:
                prepare_upgrade(staging, manifest, deadline)
            _deadline_check(deadline)
            check_staging()
            _publish(staging, destination_data_home)
            if sync_publication is not None:
                sync_publication()
        finally:
            # Never clean up a path now pointing at another directory.
            try:
                owned = _same_directory(parent, parent_identity) and _same_directory(temporary, temporary_identity)
            except (OSError, StorageError):
                owned = False
            if owned:
                shutil.rmtree(temporary)
        return manifest
    except (OSError, StorageError, ValueError) as exc:
        raise BackupError(f"Не удалось восстановить DataHome: {exc}") from exc
