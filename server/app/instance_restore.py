"""Publish a verified backup as a new, isolated DataHome."""

import json
import os
from pathlib import Path
import shutil
from tempfile import mkdtemp
from time import monotonic

from .data_home import resolve_storage
from .instance_backup import BackupError, _deadline_check, _measure, _publish, verify_backup
from .storage_lock import own_storage
from .storage_preflight import StorageError, _entry, check_storage

# The current application does not set PRAGMA user_version.
SUPPORTED_SQLITE_VERSION = 0


def _same_directory(path: Path, original: os.stat_result) -> bool:
    return _entry(path, directory=True) and os.path.samestat(path.lstat(), original)


def restore_backup(backup_path: Path, destination_data_home: Path, schema: dict[str, set[str]], *,
                   external_gm_key: str | None = None) -> dict:
    """Restore into a nonexistent directory under an existing trusted parent."""
    deadline = monotonic() + 120
    if not backup_path.is_absolute() or not destination_data_home.is_absolute():
        raise BackupError("Для восстановления нужны абсолютные пути.")
    manifest = verify_backup(backup_path, schema, deadline=deadline)
    if manifest["sqlite_user_version"] != SUPPORTED_SQLITE_VERSION:
        raise BackupError("Версия схемы SQLite не поддерживается при восстановлении.")
    env = {}
    if manifest["key_mode"] == "external":
        if not external_gm_key or not external_gm_key.strip() or "\0" in external_gm_key:
            raise BackupError("Для восстановления и запуска нужен исходный LANTERNA_GM_KEY.")
        env["LANTERNA_GM_KEY"] = external_gm_key

    parent = destination_data_home.parent
    try:
        if not _entry(parent, directory=True):
            raise BackupError("Родительский каталог DataHome отсутствует.")
        canonical_target = destination_data_home.resolve(strict=False)
        canonical_backup = backup_path.resolve(strict=True)
        if canonical_target == canonical_backup or canonical_backup in canonical_target.parents:
            raise BackupError("Целевой DataHome находится внутри резервной копии.")
        parent_identity = parent.lstat()
        paths = resolve_storage({"LANTERNA_DATA_HOME": str(destination_data_home)}, server_dir=parent, cwd=parent)
        with own_storage(paths):
            if os.path.lexists(destination_data_home):
                raise BackupError("Целевой DataHome уже существует.")
            if not _same_directory(parent, parent_identity):
                raise BackupError("Родительский каталог DataHome был заменён.")
            temporary = Path(mkdtemp(prefix=".laterna-restore-", dir=parent))
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
                _deadline_check(deadline)
                check_staging()
                _publish(staging, destination_data_home)
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
