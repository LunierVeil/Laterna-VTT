"""Lifecycle-owned automatic backups and retention of one DataHome series."""

import asyncio
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, fields
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import secrets
import shutil
from time import time

import anyio

from .backup_control import control_directory
from .instance_backup import (
    MAX_BYTES, MAX_FILES, MAX_MANIFEST, BackupBusy, BackupError, BackupWorkspace,
    OnlineBackup, _publish, _regular_file, _unique_keys, verify_backup,
)
from .storage_preflight import StorageError, _entry

log = logging.getLogger("laterna.backup.auto")
GIB = 1024**3
STATE_LIMIT = 1024**2
OPERATION_ID = re.compile(r"[0-9a-f]{32}")


@dataclass(frozen=True)
class BackupPolicy:
    interval: int = 86400
    startup_delay: int = 300
    retry_delay: int = 1800
    retry_max: int = 21600
    max_count: int = 7
    max_age: int = 14 * 86400
    max_bytes: int = 20 * GIB
    reserve_percent: int = 10
    reserve_min: int = 2 * GIB
    reserve_max: int = 10 * GIB

    @classmethod
    def from_env(cls, env):
        values = {}
        for field in fields(cls):
            name = "LANTERNA_AUTO_BACKUP_" + field.name.upper()
            if name in env:
                try:
                    values[field.name] = int(env[name])
                except ValueError:
                    raise BackupError(f"Некорректное значение {name}.") from None
        policy = cls(**values)
        if (min(policy.interval, policy.startup_delay, policy.retry_delay, policy.max_age,
                policy.max_bytes, policy.reserve_min) <= 0
                or not 1 <= policy.max_count <= 100 or not 1 <= policy.reserve_percent <= 100
                or policy.reserve_max < policy.reserve_min or policy.retry_max < policy.retry_delay):
            raise BackupError("Некорректные пределы автоматического копирования.")
        return policy

    def reserve(self, total: int) -> int:
        return min(self.reserve_max, max(self.reserve_min, (total * self.reserve_percent + 99) // 100))


def _identity(path: Path) -> list[int]:
    if not _entry(path, directory=True):
        raise BackupError("Каталог автоматической копии отсутствует.")
    info = path.lstat()
    if not info.st_ino:
        raise BackupError("Файловая система не предоставляет идентификатор каталога.")
    return [info.st_dev, info.st_ino]


def _valid_identity(value) -> bool:
    return (isinstance(value, list) and len(value) == 2
            and all(type(part) is int for part in value) and value[1] > 0)


def _private(path: Path) -> None:
    if os.name != "nt":
        info = path.lstat()
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise BackupError("Серия должна быть доступна только владельцу.")


def _manifest_digest(manifest: dict) -> str:
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()


@contextmanager
def _windows_directory_pin(path: Path):
    """Hold a Win32 directory handle without FILE_SHARE_DELETE."""
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    open_handle = kernel.CreateFileW
    open_handle.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                            wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    open_handle.restype = wintypes.HANDLE
    close_handle = kernel.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    # READ_ATTRIBUTES, SHARE_READ | SHARE_WRITE, OPEN_EXISTING,
    # BACKUP_SEMANTICS | OPEN_REPARSE_POINT.
    handle = open_handle(str(path), 0x80, 3, None, 3, 0x02200000, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield
    finally:
        close_handle(handle)


def _pin_directory(stack: ExitStack, path: Path, identity: list[int]) -> int | None:
    if os.name == "nt":
        stack.enter_context(_windows_directory_pin(path))
        if _identity(path) != identity:
            raise BackupError("Каталог изменился при открытии.")
        return None
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    stack.callback(os.close, fd)
    info = os.fstat(fd)
    if [info.st_dev, info.st_ino] != identity:
        raise BackupError("Каталог изменился при открытии.")
    return fd


class BackupSeries:
    """Journal and backups live in a private, per-canonical-DataHome directory."""

    def __init__(self, backup: OnlineBackup, policy: BackupPolicy):
        home = control_directory(backup.paths).parent
        canonical = os.path.normcase(home.resolve(strict=True))
        self.key = hashlib.sha256(os.fsencode(canonical)).hexdigest()
        self.root = home.parent / (".laterna-auto-" + self.key)
        self.backup = backup
        self.policy = policy
        self.root_id = None

    def _check_root(self) -> None:
        if self.root_id != _identity(self.root):
            raise BackupError("Каталог автоматической серии заменён.")
        _private(self.root)

    def _write(self, state: dict) -> None:
        self._check_root()
        temporary = self.root / (".journal-" + secrets.token_hex(16))
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                json.dump(state, stream, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            self._check_root()
            temporary.replace(self.root / "series.json")
        finally:
            self._check_root()
            temporary.unlink(missing_ok=True)

    def _open(self) -> dict:
        if self.root_id is None:
            if not _entry(self.root, directory=True):
                self.root.mkdir(mode=0o700)
            self.root_id = _identity(self.root)
        self._check_root()
        journal = self.root / "series.json"
        if not _entry(journal, directory=False):
            if next(self.root.iterdir(), None) is not None:
                raise BackupError("Журнал серии отсутствует в непустом каталоге.")
            state = {"version": 1, "series": self.key, "directory": self.root_id,
                     "copies": {}, "pending": None}
            self._write(state)
            return state
        with _regular_file(journal) as stream:
            raw = stream.read(STATE_LIMIT + 1)
        if len(raw) > STATE_LIMIT:
            raise BackupError("Журнал автоматической серии слишком велик.")
        state = json.loads(raw, object_pairs_hook=_unique_keys)
        if (not isinstance(state, dict) or state.keys() != {"version", "series", "directory", "copies", "pending"}
                or state["version"] != 1 or state["series"] != self.key or state["directory"] != self.root_id
                or not isinstance(state["copies"], dict) or len(state["copies"]) > 101):
            raise BackupError("Журнал автоматической серии недостоверен.")
        for name, receipt in state["copies"].items():
            self._validate_receipt(name, receipt)
        pending = state["pending"]
        if pending is not None:
            if (not isinstance(pending, dict) or pending.keys() != {"name", "work", "stage", "uploads", "receipt"}
                    or not isinstance(pending["name"], str) or not OPERATION_ID.fullmatch(pending["name"])
                    or pending["name"] in state["copies"]
                    or not all(_valid_identity(pending[field]) for field in ("stage", "work", "uploads"))):
                raise BackupError("Незавершённая операция серии недостоверна.")
            if pending["receipt"] is not None:
                self._validate_receipt(pending["name"], pending["receipt"])
                if pending["receipt"]["identity"] != pending["stage"]:
                    raise BackupError("Идентификатор staging не совпадает с журналом.")
        return state

    @staticmethod
    def _validate_receipt(name: str, receipt: dict) -> None:
        if (not OPERATION_ID.fullmatch(name) or not isinstance(receipt, dict)
                or receipt.keys() != {"identity", "digest", "bytes", "created"}
                or not _valid_identity(receipt["identity"])
                or not isinstance(receipt["digest"], str) or not re.fullmatch(r"[0-9a-f]{64}", receipt["digest"])
                or type(receipt["bytes"]) is not int or not 0 <= receipt["bytes"] <= MAX_BYTES + MAX_MANIFEST
                or type(receipt["created"]) is not int or receipt["created"] < 0):
            raise BackupError("Запись о копии недостоверна.")

    def _verify(self, path: Path, receipt: dict) -> dict:
        self._check_root()
        if _identity(path) != receipt["identity"]:
            raise BackupError("Каталог зарегистрированной копии заменён.")
        manifest = verify_backup(path, self.backup.schema)
        if _identity(path) != receipt["identity"] or _manifest_digest(manifest) != receipt["digest"]:
            raise BackupError("Копия не соответствует журналу серии.")
        return manifest

    def _clean_work(self, pending: dict) -> None:
        """Only remove files from the recorded staging tree; reject extra directories."""
        self._check_root()
        work = self.root / ("work-" + pending["name"])
        if not _entry(work, directory=True):
            return
        if _identity(work) != pending["work"]:
            raise BackupError("Рабочий каталог серии заменён.")
        stage = work / "snapshot"
        if _entry(stage, directory=True):
            if _identity(stage) != pending["stage"] or set(p.name for p in work.iterdir()) != {"snapshot"}:
                raise BackupError("Состав staging не соответствует журналу.")
            uploads = stage / "uploads"
            if _entry(uploads, directory=True) and _identity(uploads) != pending["uploads"]:
                raise BackupError("Каталог uploads в staging заменён.")
            files = self._staged_files(stage)
            self._unlink_files(stage, pending["stage"], self._removal_snapshot(stage, files))
        self._check_root()
        if _identity(work) != pending["work"]:
            raise BackupError("Рабочий каталог серии заменён при очистке.")
        work.rmdir()

    @staticmethod
    def _staged_files(stage: Path) -> list[Path]:
        files = []
        for path in stage.iterdir():
            if path.name == "uploads" and _entry(path, directory=True):
                for index, asset in enumerate(path.iterdir()):
                    if index >= MAX_FILES or not _entry(asset, directory=False):
                        raise BackupError("Неопознанное содержимое staging.")
                    files.append(asset)
            elif path.name in {"manifest.json", "gm_key.txt", "lanterna.db", "lanterna.db-journal",
                               "lanterna.db-wal", "lanterna.db-shm"} and _entry(path, directory=False):
                files.append(path)
            else:
                raise BackupError("Неопознанное содержимое staging.")
        return files

    @staticmethod
    def _removal_snapshot(directory: Path, files: list[Path]) -> tuple:
        uploads = directory / "uploads"
        upload_id = _identity(uploads) if _entry(uploads, directory=True) else None
        expected = []
        for path in files:
            if not _entry(path, directory=False):
                raise BackupError("Файл копии исчез перед удалением.")
            info = path.lstat()
            if info.st_nlink != 1:
                raise BackupError("Обнаружена жёсткая ссылка в копии.")
            expected.append((path.relative_to(directory), info))
        return upload_id, expected

    def _unlink_files(self, directory: Path, identity: list[int], snapshot: tuple) -> None:
        # Unlink only recorded regular files. Never recursively walk a
        # directory introduced between inventory and removal.
        upload_id, expected = snapshot
        uploads = directory / "uploads"
        parent = directory.parent
        parent_id = _identity(parent)
        with ExitStack() as parent_pins:
            _pin_directory(parent_pins, self.root, self.root_id)
            parent_fd = _pin_directory(parent_pins, parent, parent_id)
            with ExitStack() as directory_pins:
                directory_fd = _pin_directory(directory_pins, directory, identity)
                with ExitStack() as upload_pins:
                    upload_fd = _pin_directory(upload_pins, uploads, upload_id) if upload_id is not None else None
                    for relative, info in expected:
                        path = directory / relative
                        self._check_root()
                        fd = upload_fd if relative.parent != Path(".") else directory_fd
                        if fd is None:
                            if not _entry(path, directory=False):
                                raise BackupError("Файл копии отсутствует перед удалением.")
                            current = path.lstat()
                        else:
                            current = os.stat(relative.name, dir_fd=fd, follow_symlinks=False)
                        if not os.path.samestat(current, info) or current.st_nlink != 1:
                            raise BackupError("Файл копии заменён перед удалением.")
                        if fd is None:
                            path.unlink()
                        else:
                            os.unlink(relative.name, dir_fd=fd)
                if upload_id is not None:
                    if _identity(uploads) != upload_id:
                        raise BackupError("Каталог uploads заменён при удалении.")
                    if directory_fd is None:
                        uploads.rmdir()
                    else:
                        os.rmdir(uploads.name, dir_fd=directory_fd)
            self._check_root()
            if _identity(directory) != identity or _identity(parent) != parent_id:
                raise BackupError("Каталог копии заменён при удалении.")
            if parent_fd is None:
                directory.rmdir()
            else:
                os.rmdir(directory.name, dir_fd=parent_fd)

    def _recover(self, state: dict) -> None:
        pending = state["pending"]
        if pending is None:
            return
        saved = self.root / ("backup-" + pending["name"])
        if _entry(saved, directory=True):
            receipt = pending["receipt"]
            if receipt is None:
                raise BackupError("Публикация без подтверждения в журнале.")
            self._verify(saved, receipt)
            state["copies"][pending["name"]] = receipt
        self._clean_work(pending)
        state["pending"] = None
        self._write(state)

    def _inventory(self, state: dict) -> None:
        self._check_root()
        expected = {"series.json", *("backup-" + name for name in state["copies"])}
        for path in self.root.iterdir():
            if path.name not in expected:
                raise BackupError("В серии обнаружен неизвестный каталог или файл.")
            expected.remove(path.name)
        if expected:
            raise BackupError("В серии отсутствуют зарегистрированные записи.")
        for name, receipt in state["copies"].items():
            if _identity(self.root / ("backup-" + name)) != receipt["identity"]:
                raise BackupError("Каталог зарегистрированной копии заменён.")

    def load(self) -> dict:
        state = self._open()
        self._recover(state)
        self._inventory(state)
        return state

    def prune(self, state: dict, now: int) -> None:
        self._inventory(state)
        # JSON journal preserves publication order even after a wall-clock jump.
        records = list(state["copies"].items())
        total = sum(receipt["bytes"] for _, receipt in records)
        if (not records or (len(records) <= self.policy.max_count and total <= self.policy.max_bytes
                            and all(row["created"] + self.policy.max_age > now for _, row in records))):
            return

        protected = None
        for name, receipt in reversed(records):
            try:
                manifest = self._verify(self.root / ("backup-" + name), receipt)
            except BackupError:
                log.warning("Автоматическая копия не прошла повторную проверку.")
                continue
            if manifest["key_mode"] == "file":
                protected = (name, receipt)
                break
        if protected is None:
            raise BackupError("Пригодная копия с файловым ключом не подтверждена. Retention остановлен.")

        for name, receipt in records:
            if name == protected[0]:
                continue
            if (receipt["created"] + self.policy.max_age > now and len(state["copies"]) <= self.policy.max_count
                    and total <= self.policy.max_bytes):
                continue
            source = self.root / ("backup-" + name)
            manifest = self._verify(source, receipt)
            files = [source / name_in_manifest for name_in_manifest in manifest["files"]]
            removal = self._removal_snapshot(source, [*files, source / "manifest.json"])
            survivor = self.root / ("backup-" + protected[0])
            self._check_root()
            if _identity(source) != receipt["identity"]:
                raise BackupError("Кандидат для retention был заменён.")
            quarantine = self.root / ("trash-" + secrets.token_hex(16))
            _publish(source, quarantine)
            if _identity(quarantine) != receipt["identity"]:
                raise BackupError("Копия изменилась при перемещении в карантин.")
            # Only a freshly verified file-key snapshot can authorize deletion.
            self._verify(survivor, protected[1])
            self._unlink_files(quarantine, receipt["identity"], removal)
            del state["copies"][name]
            self._write(state)
            total -= receipt["bytes"]
        if total > self.policy.max_bytes:
            log.warning("Защищённая автоматическая копия превышает лимит серии: %s байт.", total)

    def reserve(self, now: int) -> tuple[Path, BackupWorkspace, dict]:
        state = self.load()
        self.prune(state, now)
        copies = state["copies"]
        if len(copies) >= self.policy.max_count and self.backup.external_key:
            raise BackupError("Внешний ключ не подтверждает пригодность новой копии для обрезки серии.")
        usage = shutil.disk_usage(self.root)
        # SQLite journals and filesystem metadata are outside the logical
        # payload cap. Admit at most half the bytes beyond reserve plus manifest.
        budget = min(MAX_BYTES, (usage.free - self.policy.reserve(usage.total) - MAX_MANIFEST) // 2)
        if budget <= 0:
            raise BackupError("Недостаточно места сверх резерва для автоматической копии.")
        name = secrets.token_hex(16)
        work = self.root / ("work-" + name)
        work.mkdir(mode=0o700)
        stage = work / "snapshot"
        stage.mkdir(mode=0o700)
        uploads = stage / "uploads"
        uploads.mkdir(mode=0o700)
        pending = {"name": name, "work": _identity(work), "stage": _identity(stage),
                   "uploads": _identity(uploads), "receipt": None}
        state["pending"] = pending
        self._write(state)

        def validate_workspace():
            self._check_root()
            if (_identity(work) != pending["work"] or _identity(stage) != pending["stage"]
                    or _identity(uploads) != pending["uploads"]):
                raise BackupError("Staging автоматической копии был заменён.")

        def before_publish(staging: Path, manifest: dict):
            validate_workspace()
            if shutil.disk_usage(self.root).free < self.policy.reserve(usage.total):
                raise BackupError("Свободное место опустилось ниже резерва до публикации.")
            size = sum(item["size"] for item in manifest["files"].values()) + (staging / "manifest.json").stat().st_size
            pending["receipt"] = {"identity": pending["stage"], "digest": _manifest_digest(manifest),
                                  "bytes": size, "created": now}
            self._write(state)

        return self.root / ("backup-" + name), BackupWorkspace(work, budget, validate_workspace, before_publish), state

    def finish(self, state: dict, now: int) -> None:
        self._recover(state)
        self.prune(state, now)


def startup_wait(policy: BackupPolicy, last: int | None, now: int) -> int:
    if last is None or last > now:
        return policy.startup_delay
    return max(policy.startup_delay, policy.interval - (now - last))


def retry_wait(policy: BackupPolicy, failures: int) -> int:
    return min(policy.retry_max, policy.retry_delay * (2 ** min(failures - 1, 32)))


async def _wait(stop: asyncio.Event, delay: int, clock, wall_deadline: int | None) -> bool:
    monotonic = asyncio.get_running_loop().time
    deadline = monotonic() + delay
    while not stop.is_set():
        remaining = deadline - monotonic()
        if wall_deadline is not None:
            remaining = min(remaining, wall_deadline - clock())
        if remaining <= 0:
            return True
        try:
            await asyncio.wait_for(stop.wait(), min(remaining, 60))
        except TimeoutError:
            continue
    return False


async def serve_automatic_backups(backup: OnlineBackup, policy: BackupPolicy, stop: asyncio.Event, *,
                                  clock=time, wait=_wait) -> None:
    def initialize():
        series = BackupSeries(backup, policy)
        state = series.load()
        latest_record = next(reversed(state["copies"].values()), None)
        latest = latest_record["created"] if latest_record else None
        return series, latest

    delay = policy.startup_delay
    failures = 0
    series = None
    wall_deadline = None
    while not stop.is_set():
        try:
            if series is None:
                series, last = await anyio.to_thread.run_sync(initialize)
                delay = startup_wait(policy, last, int(clock()))
                if delay > policy.startup_delay:
                    wall_deadline = last + policy.interval
            if not await wait(stop, delay, clock, wall_deadline) or stop.is_set():
                return
            destination, workspace, state = await anyio.to_thread.run_sync(series.reserve, int(clock()))
            try:
                if not stop.is_set():
                    await backup.create(destination, workspace=workspace)
            finally:
                await anyio.to_thread.run_sync(series.finish, state, int(clock()))
            failures = 0
            delay = policy.interval
            wall_deadline = int(clock()) + delay
        except (BackupError, StorageError, OSError, ValueError, RecursionError) as exc:
            failures += 1
            delay = retry_wait(policy, failures)
            wall_deadline = None
            if not isinstance(exc, BackupBusy):
                log.warning("Автоматическое копирование приостановлено (%s). Повтор через %s с.",
                            str(exc) if isinstance(exc, BackupError) else type(exc).__name__, delay)
            if series is None and not await wait(stop, delay, clock, None):
                return
