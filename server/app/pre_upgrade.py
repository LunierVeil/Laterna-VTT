"""Offline entry point for a future migrator, protected by a durable fence."""

from collections.abc import Callable, Mapping
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
from time import monotonic
from uuid import uuid4

from .cutover_platform import (
    windows_directory_permissions, windows_flush, windows_identity, windows_upgrade_allowed, windows_volume,
)
from .data_home import StoragePaths
from .instance_backup import (
    MAX_BYTES, MAX_MANIFEST, BackupError, _regular_file, _stamp, _upload_paths,
    create_backup, verify_backup,
)
from .schema_catalog import ALPHA_CATALOG_SHA256 as SOURCE_CATALOG_SHA256
from .schema_catalog import SchemaState, inspect_schema, sqlite_catalog
from .storage_lock import own_storage
from .storage_preflight import StorageError, _entry, check_storage, open_quiescent_sqlite

FENCE = ".laterna-upgrade-in-progress"
SOURCE_REVISION = "pb07-v0"
LOCAL_FILESYSTEMS = {"ext4", "xfs", "btrfs"}
UNSAFE_OPTIONS = {"nobarrier", "barrier=0"}


class UpgradeBlocked(StorageError):
    """The upgrade is unauthorized or an earlier attempt needs recovery."""


@dataclass(frozen=True)
class UpgradeSnapshot:
    attempt_id: str
    snapshot: Path
    receipt: Path
    source_revision: str
    target_revision: str
    manifest_sha256: str


def assert_no_pending_upgrade(paths: StoragePaths) -> None:
    """Called under PB-05 locks, before normal startup may write."""
    url = paths.database_url
    if url.get_backend_name() != "sqlite" or url.database == ":memory:":
        return
    # Follow the actual SQLite path even for development or per-file overrides.
    fence = Path(url.database).parent / FENCE
    try:
        fence.lstat()
    except FileNotFoundError:
        return
    raise UpgradeBlocked("Обновление уже было разрешено. Нужна проверенная процедура восстановления.")


def _mount_id(path: Path) -> int:
    if sys.platform == "win32" and windows_upgrade_allowed():
        if not _entry(path, directory=True):
            raise UpgradeBlocked("Каталог локального тома NTFS отсутствует.")
        return windows_volume(path)
    if sys.platform != "linux":
        raise UpgradeBlocked("Долговечность предобновительной публикации на этой платформе не подтверждена.")
    # Use the mount attached to the opened directory. st_dev can differ
    # from mountinfo's device number for Btrfs subvolumes.
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fdinfo = Path(f"/proc/self/fdinfo/{fd}").read_text(encoding="ascii")
        mount_id = re.search(r"^mnt_id:\s+(\d+)$", fdinfo, re.MULTILINE)
        if mount_id is None:
            raise UpgradeBlocked("Не удалось определить mount предобновительного снимка.")
        identifier = int(mount_id[1])
        for line in Path("/proc/self/mountinfo").read_text(encoding="utf-8", errors="surrogateescape").splitlines():
            left, right = line.split(" - ", 1)
            header = left.split()
            if int(header[0]) != identifier:
                continue
            filesystem, _, super_options = right.split()[:3]
            options = set(header[5].split(",")) | set(super_options.split(","))
            if filesystem in LOCAL_FILESYSTEMS and not options & (UNSAFE_OPTIONS | {"ro"}):
                return identifier
            break
    finally:
        os.close(fd)
    raise UpgradeBlocked("Файловая система или её параметры не поддерживают gate долговечности.")


def _directory_id(path: Path) -> tuple[int, int]:
    if not _entry(path, directory=True):
        raise UpgradeBlocked("Каталог предобновительного снимка отсутствует.")
    if sys.platform == "win32":
        return windows_identity(path)
    info = path.lstat()
    return info.st_dev, info.st_ino


def _require_owned_directory(path: Path, *, private: bool = False) -> None:
    if not _entry(path, directory=True):
        raise UpgradeBlocked("Каталог обновления отсутствует.")
    if sys.platform == "win32":
        windows_directory_permissions(path, private=private)
    else:
        info = path.lstat()
        if info.st_uid != os.geteuid() or info.st_mode & (0o077 if private else 0o022):
            raise UpgradeBlocked("Каталог обновления должен контролироваться владельцем.")


def _sync_file(path: Path) -> None:
    with _regular_file(path) as stream:
        if sys.platform == "win32":
            windows_flush(path)
        else:
            os.fsync(stream.fileno())


def _sync_directory(path: Path, expected: tuple[int, int]) -> None:
    if _directory_id(path) != expected:
        raise UpgradeBlocked("Каталог изменился до синхронизации.")
    if sys.platform == "win32":
        windows_flush(path)
        if _directory_id(path) != expected:
            raise UpgradeBlocked("Каталог заменён во время синхронизации.")
        return
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (info.st_dev, info.st_ino) != expected:
            raise UpgradeBlocked("Открыт другой каталог предобновительного снимка.")
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_exclusive(path: Path, contents: bytes) -> tuple:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(contents)
        output.flush()
        os.fsync(output.fileno())
        return _stamp(os.fstat(output.fileno()))


def _require_no_sidecars(database: Path) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        if _entry(database.with_name(database.name + suffix), directory=False):
            raise UpgradeBlocked("У исходной SQLite появился незавершённый журнал.")


def _require_known_schema(database: Path) -> dict[str, set[str]]:
    _require_no_sidecars(database)
    with open_quiescent_sqlite(database, require_rollback_journal=True) as current:
        if inspect_schema(current) is not SchemaState.ALPHA:
            raise UpgradeBlocked("Исходная версия или схема SQLite неизвестна этому gate.")
        return {
            name: {row[0] for row in current.execute(
                "SELECT name FROM pragma_table_xinfo(?) WHERE hidden = 0", (name,),
            )}
            for kind, name, _, _ in sqlite_catalog(current) if kind == "table"
        }


def _source_files(paths: StoragePaths) -> dict[Path, tuple]:
    uploads = Path(paths.uploads)
    database = Path(paths.database_url.database)
    _require_no_sidecars(database)
    paths_to_scan = [database, Path(paths.gm_key),
                     *_upload_paths(uploads, monotonic() + 120)]
    files = {}
    for path in paths_to_scan:
        if not _entry(path, directory=False):
            raise UpgradeBlocked("В исходном экземпляре отсутствует обязательный файл.")
        info = path.lstat()
        if info.st_nlink != 1:
            raise UpgradeBlocked("В исходном экземпляре найдена жёсткая ссылка.")
        files[path] = _stamp(info)
    return files


def _snapshot_stamps(snapshot: Path, manifest: dict) -> dict[Path, tuple]:
    return {path: _stamp(path.lstat())
            for path in [snapshot / "manifest.json", *(snapshot / entry for entry in manifest["files"])]
            if _entry(path, directory=False)}


def _sync_snapshot(snapshot: Path, manifest: dict, stamps: dict[Path, tuple]) -> str:
    manifest_path = snapshot / "manifest.json"
    for path, stamp in stamps.items():
        with _regular_file(path) as stream:
            if _stamp(os.fstat(stream.fileno())) != stamp:
                raise UpgradeBlocked("Снимок изменился во время независимой проверки.")
            if sys.platform == "win32":
                windows_flush(path)
            else:
                os.fsync(stream.fileno())
            if path == manifest_path:
                payload = stream.read(MAX_MANIFEST + 1)
                if len(payload) > MAX_MANIFEST or json.loads(payload) != manifest:
                    raise UpgradeBlocked("Manifest изменился после независимой проверки.")
    return hashlib.sha256(payload).hexdigest()


def _prepare(paths: StoragePaths, home: Path, server_dir: Path, cwd: Path,
             env: Mapping[str, str], target_revision: str) -> UpgradeSnapshot:
    assert_no_pending_upgrade(paths)
    source_mount = _mount_id(home)
    snapshot_mount = _mount_id(home.parent)
    if env.get("LANTERNA_GM_KEY") is not None:
        raise UpgradeBlocked("Долговечная доступность внешнего ключа ГМ не подтверждена.")
    database = Path(paths.database_url.database)
    # PB-05 rejects sidecars and checks the instance before immutable
    # catalog inspection. The frozen catalog supplies the exact columns.
    if check_storage(paths, server_dir=server_dir, cwd=cwd, env=env, schema={}) != "existing":
        raise UpgradeBlocked("Gate требует существующее совместимое хранилище.")
    schema = _require_known_schema(database)
    source_uploads_id = _directory_id(Path(paths.uploads))
    source_files = _source_files(paths)
    home_id = _directory_id(home)
    parent_id = _directory_id(home.parent)
    payload = sum(stamp[3] for stamp in source_files.values())
    if payload > MAX_BYTES or shutil.disk_usage(home.parent).free < 2 * payload + MAX_MANIFEST + 2 * 1024**3:
        raise UpgradeBlocked("Недостаточно места для предобновительного снимка и резерва.")

    source_key = hashlib.sha256(os.fsencode(home.resolve(strict=True))).hexdigest()
    root = home.parent / (".laterna-pre-upgrade-" + source_key)
    root.mkdir(mode=0o700, exist_ok=True)
    root_id = _directory_id(root)
    _require_owned_directory(root, private=True)
    if _mount_id(root) != snapshot_mount:
        raise UpgradeBlocked("Каталог предобновительных снимков не приватен или находится на другом mount.")
    identifier = uuid4().hex
    attempt = root / identifier
    attempt.mkdir(mode=0o700)
    attempt_id = _directory_id(attempt)
    snapshot = attempt / "snapshot"
    created = create_backup(paths, snapshot, schema, external_key=False)
    snapshot_id = _directory_id(snapshot)
    uploads = snapshot / "uploads"
    uploads_id = _directory_id(uploads)
    stamps = _snapshot_stamps(snapshot, created)
    verified = verify_backup(snapshot, schema)
    if (len(stamps) != len(created["files"]) + 1 or verified != created
            or verified["key_mode"] != "file" or verified["sqlite_user_version"] != 0):
        raise UpgradeBlocked("Опубликованный снимок не соответствует исходной схеме или попытке.")
    manifest_sha = _sync_snapshot(snapshot, verified, stamps)

    receipt = attempt / "receipt.json"
    evidence = {
        "format": "laterna-pre-upgrade-v1", "attempt_id": identifier,
        "source_identity": source_key, "source_directory": home_id,
        "source_database": source_files[database], "source_schema_sha256": SOURCE_CATALOG_SHA256,
        "source_revision": SOURCE_REVISION, "target_revision": target_revision,
        "sqlite_user_version": 0, "manifest_sha256": manifest_sha,
        "created_utc": datetime.now(UTC).isoformat(),
    }
    encoded = json.dumps(evidence, sort_keys=True).encode()
    receipt_stamp = _write_exclusive(receipt, encoded)
    directories = [(uploads, uploads_id), (snapshot, snapshot_id), (attempt, attempt_id),
                   (root, root_id), (home.parent, parent_id)]
    for directory, identity in directories:
        _sync_directory(directory, identity)

    if (_mount_id(home) != source_mount or _directory_id(home) != home_id
            or _mount_id(root) != snapshot_mount or _directory_id(Path(paths.uploads)) != source_uploads_id
            or _source_files(paths) != source_files):
        raise UpgradeBlocked("Источник или mount изменился после создания снимка.")
    fence = home / FENCE
    fence_stamp = _write_exclusive(fence, encoded)
    _sync_directory(home, home_id)
    # The fence blocks even when a final check fails. The owner must recover
    # explicitly; a failed final check is never a grant to run the action.
    if any(_directory_id(path) != identity for path, identity in directories):
        raise UpgradeBlocked("Каталог снимка был заменён после верификации.")
    if ({path.name for path in snapshot.iterdir()} !=
            {"manifest.json", "gm_key.txt", "lanterna.db", "uploads"}
            or set(_upload_paths(uploads, monotonic() + 120)) != {path for path in stamps if path.parent == uploads}
            or _snapshot_stamps(snapshot, verified) != stamps):
        raise UpgradeBlocked("Опубликованный снимок изменился перед выдачей разрешения.")
    if (_directory_id(home) != home_id or _directory_id(Path(paths.uploads)) != source_uploads_id
            or _source_files(paths) != source_files):
        raise UpgradeBlocked("Исходные файлы изменились перед выдачей разрешения.")
    with _regular_file(receipt) as stream:
        if _stamp(os.fstat(stream.fileno())) != receipt_stamp or stream.read(len(encoded) + 1) != encoded:
            raise UpgradeBlocked("Запись подтверждения изменена.")
    with _regular_file(fence) as stream:
        if _stamp(os.fstat(stream.fileno())) != fence_stamp or stream.read(len(encoded) + 1) != encoded:
            raise UpgradeBlocked("Маркер обновления изменён.")

    return UpgradeSnapshot(identifier, snapshot, receipt, SOURCE_REVISION, target_revision, manifest_sha)


def run_pre_upgrade(paths: StoragePaths, *, server_dir: Path, cwd: Path, env: Mapping[str, str],
                    target_revision: str, apply: Callable[[UpgradeSnapshot], None]) -> UpgradeSnapshot:
    """Run a synchronous, trusted writer under locks iff this attempt passes.

    Call while the server is stopped. The durable fence remains after the
    callback returns or raises. PB-08 owns validation and recovery of writes.
    """
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", target_revision) or target_revision == SOURCE_REVISION:
        raise UpgradeBlocked("Целевая ревизия должна быть задана отдельно от исходной.")
    if paths.data_home is None or paths.database_url.get_backend_name() != "sqlite":
        raise UpgradeBlocked("Gate поддерживает только существующую SQLite в едином DataHome.")
    home = Path(paths.data_home)
    if (not home.is_absolute() or home == home.parent or not paths.database_url.database
            or Path(paths.database_url.database) != home / "lanterna.db"
            or Path(paths.uploads) != home / "uploads" or Path(paths.gm_key) != home / "gm_key.txt"):
        raise UpgradeBlocked("Пути источника должны принадлежать одному DataHome.")
    with ExitStack() as resources:
        try:
            resources.enter_context(own_storage(paths))
            if not _entry(home, directory=True):
                raise UpgradeBlocked("DataHome для обновления отсутствует.")
            if sys.platform != "win32" or windows_upgrade_allowed():
                _require_owned_directory(home)
            snapshot = _prepare(paths, home, server_dir, cwd, env, target_revision)
        except UpgradeBlocked:
            raise
        except (StorageError, BackupError, OSError, sqlite3.Error, ValueError) as exc:
            raise UpgradeBlocked(f"Предобновительный снимок отклонён: {exc}") from exc
        apply(snapshot)
        return snapshot
