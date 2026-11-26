"""Verified directory snapshots of a live, exclusively owned Laterna instance."""

import asyncio
from collections.abc import Callable
from contextlib import closing, contextmanager, nullcontext
import ctypes
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
from tempfile import TemporaryDirectory
from time import monotonic

import anyio

from .data_home import StoragePaths
from .schema_catalog import SchemaState, has_active_campaign_scene, identify_schema
from .upload_files import UPLOAD_TEMP, upload_references
from .storage_preflight import StorageError, _entry
from .storage_preflight import _file_stamp as _stamp

FORMAT = "laterna-instance"
VERSION = 1
MAX_FILES = 10_000
MAX_BYTES = 64 * 1024**3
MAX_MANIFEST = 4 * 1024**2
log = logging.getLogger("laterna.backup")


class BackupError(RuntimeError):
    pass


def _deadline_check(deadline: float) -> None:
    if monotonic() >= deadline:
        raise BackupError("Истекло время подготовки резервной копии.")


@contextmanager
def _regular_file(path: Path):
    if not _entry(path, directory=False):
        raise BackupError("Обязательный файл отсутствует.")
    before = path.lstat()
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
    with os.fdopen(fd, "rb") as source:
        opened = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or _stamp(before) != _stamp(opened):
            raise BackupError("Файл был перенаправлен или заменён.")
        yield source
        after = os.fstat(fd)
        if (_stamp(opened) != _stamp(after) or opened.st_ctime_ns != after.st_ctime_ns
                or _stamp(before) != _stamp(path.lstat())):
            raise BackupError("Файл изменился во время чтения.")


def _measure(source: Path, deadline: float, *, target: Path | None = None, limit: int = MAX_BYTES) -> dict:
    digest = hashlib.sha256()
    size = 0

    def stream(input_file, output_file=None):
        nonlocal size
        while block := input_file.read(1024**2):
            _deadline_check(deadline)
            size += len(block)
            if size > limit:
                raise BackupError("Превышен допустимый размер резервной копии.")
            digest.update(block)
            if output_file is not None:
                output_file.write(block)

    with _regular_file(source) as input_file:
        if target is None:
            stream(input_file)
        else:
            with target.open("xb") as output_file:
                stream(input_file, output_file)
                output_file.flush()
                os.fsync(output_file.fileno())
    return {"size": size, "sha256": digest.hexdigest()}


def _upload_paths(directory: Path, deadline: float, *, source: bool = False) -> list[Path]:
    if not _entry(directory, directory=True):
        raise BackupError("Каталог uploads отсутствует.")
    paths = []
    names = set()
    for count, path in enumerate(directory.iterdir(), 1):
        _deadline_check(deadline)
        if count > MAX_FILES:
            raise BackupError("Слишком много файлов в uploads.")
        if source and path.name.startswith(UPLOAD_TEMP):
            continue
        name = path.name
        if (name.startswith(UPLOAD_TEMP) or name.endswith((".", " "))
                or any(ord(char) < 32 or char in '<>:"/\\|?*' for char in name)
                or re.fullmatch(r"(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])", name.split(".", 1)[0].rstrip().lower())
                or name.casefold() in names):
            raise BackupError("Небезопасное или неоднозначное имя файла uploads.")
        names.add(name.casefold())
        paths.append(path)
    return paths


def _snapshot(source: Path, target: Path, deadline: float, *, max_bytes: int = MAX_BYTES, exclusive: bool = False) -> int:
    if not _entry(source, directory=False):
        raise BackupError("Исходная SQLite отсутствует.")
    if exclusive:
        # Reserve an empty destination without replacing an unexpected file.
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=.1)) as reader:
        with closing(sqlite3.connect(target)) as writer:
            page_size = reader.execute("PRAGMA page_size").fetchone()[0]

            if max_bytes < MAX_BYTES and page_size * reader.execute("PRAGMA page_count").fetchone()[0] > max_bytes:
                raise BackupError("SQLite превышает допустимый размер резервной копии.")

            def progress(status, remaining, total):
                _deadline_check(deadline)
                if page_size * total > max_bytes:
                    raise BackupError("SQLite превышает допустимый размер резервной копии.")

            reader.backup(writer, pages=64, sleep=.02, progress=progress)
            if writer.execute("PRAGMA journal_mode=DELETE").fetchone() != ("delete",):
                raise BackupError("Не удалось подготовить автономный SQLite snapshot.")
            return writer.execute("PRAGMA user_version").fetchone()[0]


def _inspect(database: Path, schema: dict[str, set[str]], deadline: float) -> tuple[int, set[str]]:
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)) as conn:
        conn.set_progress_handler(lambda: int(monotonic() >= deadline), 1000)
        if conn.execute("PRAGMA integrity_check(1)").fetchall() != [("ok",)]:
            raise BackupError("SQLite integrity_check не пройден.")
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        for name, expected in schema.items():
            columns = {row[0] for row in conn.execute(
                "SELECT name FROM pragma_table_xinfo(?) WHERE hidden=0", (name,),
            )}
            if name not in tables or columns != expected:
                raise BackupError(f"Несовместимая схема SQLite: {name}.")
        if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise BackupError("SQLite foreign_key_check обнаружил нарушение. Исходная БД сохранена.")

        state = identify_schema(conn)
        if state not in (SchemaState.ALPHA, SchemaState.CURRENT):
            raise BackupError(f"Несовместимая схема SQLite ({state}).")
        if not has_active_campaign_scene(conn):
            raise BackupError("SQLite не содержит кампании с активной сценой.")

        refs = set()
        for query in ("SELECT background_url FROM scenes", "SELECT image_url FROM tokens",
                      "SELECT data_json FROM characters"):
            for (value,) in conn.execute(query):
                _deadline_check(deadline)
                refs.update(upload_references(json.loads(value) if query.endswith("characters") and value else value))
                if len(refs) > MAX_FILES:
                    raise BackupError("Слишком много ссылок на изображения.")
        return conn.execute("PRAGMA user_version").fetchone()[0], refs


def _unique_keys(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise BackupError("Повторяющееся поле manifest.")
    return result


def verify_backup(directory: Path, schema: dict[str, set[str]], *, deadline: float | None = None) -> dict:
    """Verify bundle integrity and the supported startup schema without writes."""
    if deadline is None:
        deadline = monotonic() + 120
    try:
        if not _entry(directory, directory=True):
            raise BackupError("Каталог резервной копии отсутствует.")
        with _regular_file(directory / "manifest.json") as stream:
            raw = stream.read(MAX_MANIFEST + 1)
        if len(raw) > MAX_MANIFEST:
            raise BackupError("Manifest превышает допустимый размер.")
        manifest = json.loads(raw, object_pairs_hook=_unique_keys)
        if (not isinstance(manifest, dict) or manifest.get("format") != FORMAT
                or manifest.keys() != {"format", "version", "created_utc", "source_commit",
                                       "sqlite_user_version", "key_mode", "files", "verification", "complete"}
                or type(manifest.get("version")) is not int or manifest["version"] != VERSION
                or manifest.get("complete") is not True or manifest.get("verification") != "passed"
                or manifest.get("key_mode") not in ("file", "external")):
            raise BackupError("Неподдерживаемый или незавершённый manifest.")
        commit = manifest["source_commit"]
        if commit is not None and (not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit)):
            raise BackupError("Некорректный source commit в manifest.")
        if datetime.fromisoformat(manifest["created_utc"]).utcoffset() != UTC.utcoffset(None):
            raise BackupError("Время manifest должно быть в UTC.")
        required = {"lanterna.db", "uploads", "manifest.json"}
        if manifest["key_mode"] == "file":
            required.add("gm_key.txt")
        actual = set()
        for entry in directory.iterdir():
            if entry.name not in required:
                raise BackupError("Неожиданный файл резервной копии.")
            actual.add(entry.name)
        if actual != required:
            raise BackupError("Неожиданный или отсутствующий файл резервной копии.")
        uploads = _upload_paths(directory / "uploads", deadline)
        paths = {f"uploads/{path.name}": path for path in uploads}
        paths.update({name: directory / name for name in required - {"uploads", "manifest.json"}})
        files = manifest.get("files")
        if not isinstance(files, dict) or files.keys() != paths.keys():
            raise BackupError("Список файлов не совпадает с manifest.")
        remaining = MAX_BYTES
        for name, path in paths.items():
            item = files[name]
            if (not isinstance(item, dict) or type(item.get("size")) is not int
                    or not 0 <= item["size"] <= remaining or not isinstance(item.get("sha256"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
                raise BackupError("Некорректный размер или SHA-256 в manifest.")
            if _measure(path, deadline, limit=item["size"]) != item:
                raise BackupError("Размер или SHA-256 файла не совпадает с manifest.")
            remaining -= item["size"]
        if manifest["key_mode"] == "file":
            with _regular_file(paths["gm_key.txt"]) as stream:
                if not stream.read(4097).decode("utf-8").strip() or files["gm_key.txt"]["size"] > 4096:
                    raise BackupError("Некорректный файл ключа ГМ.")
        with _regular_file(paths["lanterna.db"]):
            version, refs = _inspect(paths["lanterna.db"], schema, deadline)
        if type(manifest.get("sqlite_user_version")) is not int or manifest["sqlite_user_version"] != version:
            raise BackupError("Версия схемы SQLite не совпадает с manifest.")
        if refs - {path.name for path in uploads}:
            raise BackupError("SQLite ссылается на отсутствующее изображение.")
        return manifest
    except (OSError, StorageError, sqlite3.Error, ValueError, KeyError, RecursionError, TypeError) as exc:
        raise BackupError("Не удалось прочитать или проверить резервную копию.") from exc


def _publish(staging: Path, destination: Path) -> None:
    if sys.platform == "win32":
        os.rename(staging, destination)  # Windows refuses an existing target.
    elif sys.platform == "linux":
        rename = getattr(ctypes.CDLL(None, use_errno=True), "renameat2", None)
        if rename is None:
            raise BackupError("Атомарная публикация без перезаписи недоступна.")
        rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
        rename.restype = ctypes.c_int
        if rename(-100, os.fsencode(staging), -100, os.fsencode(destination), 1) != 0:
            number = ctypes.get_errno()
            raise OSError(number, os.strerror(number))
    else:
        raise BackupError("Атомарная публикация поддерживается на Linux и Windows.")


@dataclass(frozen=True)
class BackupWorkspace:
    """Optional automatic-series staging, payload budget and publication receipt."""

    directory: Path
    max_bytes: int
    validate: Callable[[], None]
    before_publish: Callable[[Path, dict], None]


def create_backup(paths: StoragePaths, destination: Path, schema: dict[str, set[str]], *,
                  external_key: bool, timeout: float = 120, workspace: BackupWorkspace | None = None) -> dict:
    """Internal online API. The caller holds the instance's PB-05 locks."""
    started = monotonic()
    deadline = started + timeout
    url = paths.database_url
    log.info("instance backup started")
    try:
        if not 0 < timeout <= 120:
            raise BackupError("Допустимый срок подготовки — до 120 секунд.")
        if url.get_backend_name() != "sqlite" or url.database == ":memory:":
            raise BackupError("Резервное копирование поддерживает файловую SQLite.")
        if not destination.is_absolute() or not _entry(destination.parent, directory=True):
            raise BackupError("Нужен абсолютный путь и существующий каталог назначения.")
        if os.path.lexists(destination):
            raise BackupError("Имя резервной копии уже занято.")
        uploads = Path(paths.uploads)
        if uploads == destination or uploads in destination.parents:
            raise BackupError("Нельзя размещать резервную копию в uploads.")
        if workspace is not None and (
            workspace.directory.parent != destination.parent
            or not _entry(workspace.directory, directory=True)
            or not 0 < workspace.max_bytes <= MAX_BYTES
        ):
            raise BackupError("Некорректный staging или бюджет автоматической копии.")
        temporary_directory = (nullcontext(workspace.directory) if workspace else
                               TemporaryDirectory(prefix=".laterna-backup-", dir=destination.parent))
        budget = workspace.max_bytes if workspace else MAX_BYTES
        with temporary_directory as temporary:
            staging = Path(temporary) / "snapshot"
            if workspace:
                workspace.validate()
                if ({path.name for path in staging.iterdir()} != {"uploads"}
                        or next((staging / "uploads").iterdir(), None) is not None):
                    raise BackupError("Staging автоматической копии изменился.")
            else:
                staging.mkdir(mode=0o700)
                (staging / "uploads").mkdir(mode=0o700)
            database = staging / "lanterna.db"
            snapshot_options = {"max_bytes": budget, "exclusive": True} if workspace else {}
            version = _snapshot(Path(url.database), database, deadline, **snapshot_options)
            files = {"lanterna.db": _measure(database, deadline, limit=budget)}
            remaining = budget - files["lanterna.db"]["size"]
            if not external_key:
                files["gm_key.txt"] = _measure(Path(paths.gm_key), deadline,
                                               target=staging / "gm_key.txt", limit=min(4096, remaining))
                remaining -= files["gm_key.txt"]["size"]
            for path in _upload_paths(uploads, deadline, source=True):
                name = f"uploads/{path.name}"
                files[name] = _measure(path, deadline, target=staging / name, limit=remaining)
                remaining -= files[name]["size"]
            commit_file = Path(__file__).resolve().parents[2] / "SOURCE_COMMIT.txt"
            commit = commit_file.read_text(encoding="ascii").strip() if commit_file.is_file() else ""
            manifest = {
                "format": FORMAT, "version": VERSION, "created_utc": datetime.now(UTC).isoformat(),
                "source_commit": commit if re.fullmatch(r"[0-9a-f]{40}", commit) else None,
                "sqlite_user_version": version, "key_mode": "external" if external_key else "file",
                "files": files, "verification": "passed", "complete": True,
            }
            with (staging / "manifest.json").open("x", encoding="utf-8") as output:
                json.dump(manifest, output, ensure_ascii=False)
                output.flush()
                os.fsync(output.fileno())
            verify_backup(staging, schema, deadline=deadline)
            _deadline_check(deadline)
            if workspace:
                workspace.before_publish(staging, manifest)
            _publish(staging, destination)
        log.info("instance backup verified files=%s bytes=%s seconds=%.2f",
                 len(files), budget - remaining, monotonic() - started)
        return manifest
    except (OSError, sqlite3.Error, StorageError, ValueError) as exc:
        log.warning("instance backup failed: %s seconds=%.2f", type(exc).__name__, monotonic() - started)
        raise BackupError("Не удалось подготовить резервную копию.") from exc
    except BackupError as exc:
        log.warning("instance backup rejected: %s seconds=%.2f", exc, monotonic() - started)
        raise


class BackupBusy(BackupError):
    """The instance already has an active backup worker or is stopping."""


class OnlineBackup:
    """One in-process operation, drained before the owning lifespan releases storage."""

    def __init__(self, paths: StoragePaths, schema: dict[str, set[str]], *, external_key: bool):
        self.paths = paths
        self.schema = schema
        self.external_key = external_key
        self._task: asyncio.Task | None = None
        self._closed = False

    async def create(self, destination: Path, *, workspace: BackupWorkspace | None = None) -> dict:
        if self._closed or (self._task is not None and not self._task.done()):
            raise BackupBusy("Резервное копирование недоступно или уже выполняется.")
        self._task = asyncio.create_task(anyio.to_thread.run_sync(
            lambda: create_backup(self.paths, destination, self.schema, external_key=self.external_key, workspace=workspace),
        ))
        self._task.add_done_callback(lambda task: task.exception() if not task.cancelled() else None)
        # A cancelled requester must not release the instance owner's OS locks
        # while a worker thread can still read or publish the bundle.
        return await asyncio.shield(self._task)

    async def close(self) -> None:
        self._closed = True
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)
