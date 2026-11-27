"""Single-volume Linux activation of a PB-08B prepared DataHome."""

from contextlib import closing, contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from tempfile import TemporaryDirectory, mkdtemp
from time import monotonic
from uuid import uuid4

from .alpha_upgrade import _validate_equivalence, prepare_alpha_upgrade
from .cutover_platform import (
    lock_installation, windows_identity, windows_move,
    windows_require_legacy_stopped, windows_upgrade_allowed,
)
from .data_home import StoragePaths, resolve_storage
from .instance_backup import (
    MAX_BYTES, _inspect, _measure, _publish, _regular_file, _upload_paths, create_backup, verify_backup,
)
from .instance_restore import _restore_backup, lock_restore_destination, restore_backup
from .pre_upgrade import (
    FENCE, SOURCE_REVISION, UpgradeBlocked, UpgradeSnapshot, _directory_id, _mount_id,
    _require_known_schema, _require_owned_directory, _sync_directory, _sync_file,
    _write_exclusive, assert_no_pending_upgrade,
)
from .schema_catalog import SchemaState, inspect_schema
from .schema_migrations import INITIAL_REVISION
from .storage_lock import own_storage
from .storage_preflight import _SQLITE_SIDECARS, _entry, check_storage, open_quiescent_sqlite

# Config of the historical Linux tree whose data catalog PB-08B accepts.
ALPHA_CONFIG = "e45bfb4209b3a6a7898126de5205dcf90b4cdd64b1d8d60e76ae7baf6ca2edda"
ALPHA_LAUNCHER = "392b33d1db5704d0c7f9e68cfda40520f53a0e3f70a8be240ea2df9072205696"
ALPHA_WINDOWS_LAUNCHERS = {
    "laterna.bat": "c665a887ae0b6707ffaa08b11cddc70c6dbc4ab2875cae07f0010ee5646c3e7d",
    "laterna.ps1": "f8703c55a70d37de8312fd421657775b524d1c323b9daa4a6d8ae4c006b78983",
}
MAX_RECORD = 16384


def state_path(server_dir: Path) -> Path:
    install = server_dir.parent
    return install.with_name(f".{install.name}.laterna-cutover")


def _enrollment(server: Path) -> Path:
    return server / ".laterna-cutover-bound"


def _state_exists(server: Path) -> bool:
    if _present(state_path(server)):
        return True
    if _present(_enrollment(server)):
        raise UpgradeBlocked("Утрачена регистрация обновлённой установки. HOLD.")
    return False


def paths_for(home: Path, server: Path) -> StoragePaths:
    return resolve_storage({"LANTERNA_DATA_HOME": str(home)}, server_dir=server, cwd=server)


def _private(path: Path, *, create: bool = False) -> None:
    if create:
        _require_owned_directory(path.parent)
        path.mkdir(mode=0o700, exist_ok=True)
        _sync_directory(path.parent, _directory_id(path.parent))
    _require_owned_directory(path, private=True)


def _read(path: Path) -> dict:
    def pairs(items):
        result = dict(items)
        if len(result) != len(items):
            raise UpgradeBlocked("Повторяющиеся поля записи обновления.")
        return result

    if not _entry(path, directory=False):
        raise UpgradeBlocked("Нужна проверяемая запись обновления. HOLD.")
    with _regular_file(path) as file:
        raw = file.read(MAX_RECORD + 1)
    if len(raw) > MAX_RECORD:
        raise UpgradeBlocked("Превышен размер записи обновления.")
    try:
        value = json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, RecursionError) as exc:
        raise UpgradeBlocked("Повреждена запись обновления. HOLD.") from exc
    if not isinstance(value, dict):
        raise UpgradeBlocked("Повреждена запись обновления. HOLD.")
    return value


def _write(path: Path, record: dict, *, replace: bool = False) -> None:
    identity = _directory_id(path.parent)
    scratch = path.parent / f".write-{uuid4().hex}"
    payload = json.dumps(record, sort_keys=True).encode()
    if len(payload) > MAX_RECORD:
        raise UpgradeBlocked("Превышен размер записи обновления.")
    try:
        _write_exclusive(scratch, payload)
        if replace:
            if sys.platform == "win32":
                windows_move(scratch, path, replace=True)
            else:
                os.replace(scratch, path)
        else:
            _publish(scratch, path)
        _sync_directory(path.parent, identity)
    finally:
        scratch.unlink(missing_ok=True)


@contextmanager
def _installation_lease(root: Path, *, shared: bool):
    lock_path = root.with_name(root.name + ".lock")
    _entry(lock_path, directory=False)
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if (os.fstat(fd).st_nlink != 1 or not _entry(lock_path, directory=False)
                or not os.path.samestat(os.fstat(fd), lock_path.stat())):
            raise UpgradeBlocked("Неверная блокировка установки.")
        try:
            lock_installation(fd, shared=shared)
        except OSError as exc:
            raise UpgradeBlocked("Установка занята запуском или обновлением. HOLD.") from exc
        yield
    finally:
        os.close(fd)


def runtime_lease(server: Path):
    # Shared until the backend has stopped and disposed all writers. Ordinary
    # independent DataHomes still use their own existing PB-05 locks.
    return _installation_lease(state_path(server), shared=True)


@contextmanager
def _operation(root: Path, *, create: bool = False):
    if sys.platform != "linux" and not (sys.platform == "win32" and windows_upgrade_allowed()):
        raise UpgradeBlocked("Windows Alpha upgrade закрыт до проверки долговечности публикации.")
    with _installation_lease(root, shared=False):
        _private(root, create=create)
        _mount_id(root)
        yield


def _present(path: Path) -> bool:
    # Permission and I/O failures must not be mistaken for missing state.
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    return True


def _home(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or path != path.resolve(strict=False):
        raise UpgradeBlocked("Укажите канонический абсолютный DataHome.")
    return path


def _request(root: Path) -> dict:
    request = _read(root / "operation.json")
    if (set(request) != {"id", "legacy", "source", "target", "cancelled", "sealed"}
            or not isinstance(request["id"], str) or not re.fullmatch(r"[0-9a-f]{32}", request["id"])
            or not all(isinstance(request[key], str) for key in ("legacy", "source", "target"))
            or not isinstance(request["cancelled"], bool)
            or not isinstance(request["sealed"], bool)):
        raise UpgradeBlocked("Некорректная регистрация обновления. HOLD.")
    for key in ("legacy", "source", "target"):
        _home(request[key])
    _same_volume(root, Path(request["legacy"]), Path(request["source"]))
    return request


def _same_volume(root: Path, *paths: Path) -> None:
    mount = _mount_id(root)
    if any(_mount_id(path) != mount for path in paths):
        raise UpgradeBlocked("Для активации требуется один проверяемый локальный mount.")


def _legacy_stopped(legacy: Path) -> None:
    if sys.platform == "win32":
        windows_require_legacy_stopped(legacy)
        return
    # The supported legacy entrypoints start from this tree or use its
    # absolute --app-dir. The operator must have stopped external writers.
    for process in Path("/proc").iterdir():
        if not process.name.isdecimal():
            continue
        try:
            if process.stat().st_uid != os.geteuid():
                continue
            with (process / "cmdline").open("rb") as stream:
                args = stream.read(65536).split(b"\0")
            imports_backend = any(b"app.main" in arg for arg in args)
            uses_launcher = any(arg.rsplit(b"/", 1)[-1] == b"laterna.sh" for arg in args)
            backend = imports_backend and any(
                arg.removeprefix(b"--app-dir=") == os.fsencode(legacy) for arg in args
            )
            if backend or os.fsencode(legacy.parent / "laterna.sh") in args:
                raise UpgradeBlocked("Исторический launcher или backend ещё запущен.")
            try:
                cwd = Path(os.readlink(process / "cwd").removesuffix(" (deleted)"))
            except PermissionError:
                if imports_backend or uses_launcher:
                    raise UpgradeBlocked("Нельзя проверить путь работающего launcher или backend.") from None
                continue
            if cwd.is_relative_to(legacy.parent):
                raise UpgradeBlocked("Завершите процессы и терминалы в каталоге исторической Alpha.")
        except (FileNotFoundError, ProcessLookupError):
            continue


def _check_code(path: Path, expected: str) -> None:
    if not _entry(path, directory=False):
        raise UpgradeBlocked("Не найдена историческая точка входа Alpha.")
    with _regular_file(path) as file:
        encoded = file.read(MAX_RECORD + 1)
    # Git archives and Windows packages apply eol=crlf to the launchers.
    # Pin the canonical text while retaining BOM and every other byte.
    if len(encoded) > MAX_RECORD or hashlib.sha256(encoded.replace(b"\r\n", b"\n")).hexdigest() != expected:
        raise UpgradeBlocked(f"Не распознана историческая точка входа Alpha: {path.name}.")


def _legacy_paths(root: Path, legacy: Path):
    launchers = ALPHA_WINDOWS_LAUNCHERS if sys.platform == "win32" else {"laterna.sh": ALPHA_LAUNCHER}
    yield legacy / "app", root / "alpha-app", True, legacy / "app" / "config.py", ALPHA_CONFIG
    for name, digest in launchers.items():
        launcher = legacy.parent / name
        yield launcher, root / f"alpha-{name}", False, launcher, digest


def _retire(root: Path, legacy: Path, *, prepare: bool = False) -> None:
    paths = tuple(_legacy_paths(root, legacy))
    if prepare:
        _legacy_stopped(legacy)
        for original, archived, _, check_path, expected in paths:
            if not _present(archived):
                _check_code(check_path, expected)
        for original, archived, _, _, _ in paths:
            if not _present(archived):
                _publish(original, archived)
        for parent in (root, legacy, legacy.parent):
            _sync_directory(parent, _directory_id(parent))
        _legacy_stopped(legacy)
    for original, archived, directory, _, expected in paths:
        if _present(original) or not _entry(archived, directory=directory):
            raise UpgradeBlocked("Исторические точки входа Alpha не выведены из запуска.")
        _check_code(archived / "config.py" if directory else archived, expected)


def _prepared(request: dict, target: Path | None = None) -> tuple[dict, Path, dict]:
    source = Path(request["source"])
    marker = _read(source / FENCE)
    attempt_id = marker.get("attempt_id")
    if not isinstance(attempt_id, str) or not re.fullmatch(r"[0-9a-f]{32}", attempt_id):
        raise UpgradeBlocked("Некорректный ID предобновительного снимка.")
    root_hash = hashlib.sha256(os.fsencode(source)).hexdigest()
    attempt = source.parent / f".laterna-pre-upgrade-{root_hash}" / attempt_id
    snapshot = attempt / "snapshot"
    if (_read(attempt / "receipt.json") != marker
            or marker.get("source_revision") != SOURCE_REVISION
            or marker.get("target_revision") != INITIAL_REVISION):
        raise UpgradeBlocked("Receipt и source fence не подтверждают попытку.")
    schema = _require_known_schema(snapshot / "lanterna.db")
    manifest = verify_backup(snapshot, schema)
    with _regular_file(snapshot / "manifest.json") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != marker.get("manifest_sha256"):
            raise UpgradeBlocked("Manifest не совпадает с предобновительным receipt.")
    if target is not None:
        expected = {"format": "laterna-prepared-upgrade-target-v1", **{
            key: marker[key] for key in ("attempt_id", "source_revision", "target_revision", "manifest_sha256")
        }}
        if _read(target / FENCE) != expected:
            raise UpgradeBlocked("Target fence не соответствует снимку.")
        _validate_equivalence(snapshot, target, schema, manifest, monotonic() + 120)
    deadline = monotonic() + 120
    if _require_known_schema(source / "lanterna.db") != schema:
        raise UpgradeBlocked("Исходная схема изменилась после снимка.")
    with (open_quiescent_sqlite(source / "lanterna.db") as original,
          open_quiescent_sqlite(snapshot / "lanterna.db") as saved):
        if _logical_digest(original, deadline) != _logical_digest(saved, deadline):
            raise UpgradeBlocked("Исходные данные изменились после снимка.")
    uploads = {source / name for name in manifest["files"] if name.startswith("uploads/")}
    if set(_upload_paths(source / "uploads", deadline)) != uploads:
        raise UpgradeBlocked("Состав исходных медиа изменился после снимка.")
    for name, expected in manifest["files"].items():
        if name != "lanterna.db" and _measure(source / name, deadline, limit=expected["size"]) != expected:
            raise UpgradeBlocked("Исходные медиа или ключ изменились после снимка.")
    return marker, snapshot, schema


def prepare(server: Path, legacy: Path, target: Path) -> UpgradeSnapshot:
    root = state_path(server)
    _state_exists(server)
    legacy, target = _home(str(legacy)), _home(str(target))
    protected = (root, server.parent, legacy)
    if (legacy == server or any(target == p or target in p.parents or p in target.parents for p in protected)
            or any(legacy == p or legacy in p.parents or p in legacy.parents for p in protected[:2])):
        raise UpgradeBlocked("Историческая установка, состояние, приложение и цель должны быть независимыми.")
    if _present(target):
        raise UpgradeBlocked("Целевой DataHome уже существует.")
    if not _entry(legacy / "lanterna.db", directory=False):
        raise UpgradeBlocked("Указанный каталог не содержит SQLite исторического сервера Alpha.")
    for _, archived, _, actual, digest in _legacy_paths(root, legacy):
        if not _present(archived):
            _check_code(actual, digest)
    if "LANTERNA_GM_KEY" in os.environ:
        raise UpgradeBlocked("Для переноса требуется файловый ключ ГМ.")
    with _operation(root, create=True):
        _same_volume(root, server, legacy, legacy.parent, target.parent)
        operation = root / "operation.json"
        previous = _request(root) if _present(operation) else None
        if not previous and (_present(_enrollment(server)) or any(
            _present(archived) for _, archived, _, _, _ in _legacy_paths(root, legacy)
        )):
            raise UpgradeBlocked("Утрачена регистрация существующей попытки. HOLD.")
        if _present(root / "activation.json") or (previous and previous["sealed"]):
            raise UpgradeBlocked("Активация могла быть выполнена. Используйте recovery. HOLD.")
        if previous and (not previous["cancelled"] or previous["legacy"] != str(legacy)
                         or previous["target"] == str(target)):
            raise UpgradeBlocked("Сначала проверьте и отмените предыдущую попытку. Для повтора нужна новая цель.")
        if not previous:
            paths = paths_for(legacy, server)
            with own_storage(paths):
                # Diagnose incompatible data before archiving either entrypoint.
                schema = _require_known_schema(legacy / "lanterna.db")
                if check_storage(paths, server_dir=server, cwd=server, env={}, schema=schema) != "existing":
                    raise UpgradeBlocked("Исходный DataHome неполон. HOLD.")
        identifier = uuid4().hex
        source = legacy
        if previous and _present(Path(previous["source"]) / FENCE):
            _retire(root, legacy, prepare=True)
            with own_storage(paths_for(Path(previous["source"]), server)):
                _, snapshot, schema = _prepared(previous)
            source = root / f"retry-{identifier}"
            restore_backup(snapshot, source, schema)
            _sync_directory(root, _directory_id(root))
        request = {"id": identifier, "legacy": str(legacy), "source": str(source), "target": str(target),
                   "cancelled": False, "sealed": False}
        _write(operation, request, replace=previous is not None)
        binding = _enrollment(server)
        if not _present(binding):
            _write(binding, {"state": root.name})
        if _read(binding) != {"state": root.name}:
            raise UpgradeBlocked("Привязка установки к регистрации повреждена. HOLD.")
        _retire(root, legacy, prepare=True)
        return prepare_alpha_upgrade(paths_for(source, server), target, server_dir=server, cwd=server,
                                     env=os.environ)


def _identity(path: Path) -> list[int]:
    if sys.platform == "win32":
        return list(windows_identity(path))
    return [os.statvfs(path).f_fsid, path.stat().st_ino]


def _activation_record(root: Path, request: dict) -> dict:
    decision = _read(root / "activation.json")
    if (request["cancelled"] or not request["sealed"]
            or set(decision) != {"id", "target", "directory", "database", "marker"}
            or decision["id"] != request["id"] or not isinstance(decision["target"], str)
            or not isinstance(decision["marker"], dict)):
        raise UpgradeBlocked("Нельзя подтвердить активный DataHome. HOLD.")
    _home(decision["target"])
    return decision


def _decision(root: Path, request: dict) -> dict:
    decision = _activation_record(root, request)
    target = Path(decision["target"])
    database = target / "lanterna.db"
    if not _entry(target, directory=True) or not _entry(database, directory=False):
        raise UpgradeBlocked("Активный DataHome отсутствует. HOLD.")
    _same_volume(root, target)
    if (_identity(target) != decision["directory"] or _identity(database) != decision["database"]
            or _read(target / FENCE) != decision["marker"]):
        raise UpgradeBlocked("Активный DataHome или его fence изменён. HOLD.")
    return decision


def activate(server: Path) -> None:
    root = state_path(server)
    with _operation(root):
        request = _request(root)
        if request["cancelled"]:
            raise UpgradeBlocked("Попытка отменена.")
        if _read(_enrollment(server)) != {"state": root.name}:
            raise UpgradeBlocked("Привязка установки к регистрации повреждена. HOLD.")
        if request["sealed"]:
            if not _present(root / "activation.json"):
                raise UpgradeBlocked("Не подтверждён исход активации. HOLD.")
            target = Path(_activation_record(root, request)["target"])
            with own_storage(paths_for(target, server)):
                _selected(root)
                _confirm(root)
            return
        source, target = Path(request["source"]), Path(request["target"])
        with own_storage(paths_for(target, server)), own_storage(paths_for(source, server)):
            _retire(root, Path(request["legacy"]), prepare=True)
            _same_volume(root, source, target)
            _prepared(request, target)
            _sync_directory(target, _directory_id(target))
            _sync_directory(target.parent, _directory_id(target.parent))
            # Negative evidence only: this barrier permanently closes abort
            # and retry, even if the only grant of activation later disappears.
            _write(root / "operation.json", {**request, "sealed": True}, replace=True)
            _write(root / "activation.json", {
                "id": request["id"], "target": str(target),
                "directory": _identity(target), "database": _identity(target / "lanterna.db"),
                "marker": _read(target / FENCE),
            })


def _confirm(root: Path) -> None:
    _sync_file(root / "activation.json")
    _sync_directory(root, _directory_id(root))


def cancel(server: Path) -> None:
    root = state_path(server)
    with _operation(root):
        request = _request(root)
        if request["sealed"] or _present(root / "activation.json"):
            raise UpgradeBlocked("Активация могла быть выполнена. Отмена запрещена. HOLD.")
        target, source = Path(request["target"]), Path(request["source"])
        with own_storage(paths_for(target, server)), own_storage(paths_for(source, server)):
            if (_present(source / FENCE)
                    or any(_present(archived) for _, archived, _, _, _ in _legacy_paths(root, Path(request["legacy"])))):
                _retire(root, Path(request["legacy"]), prepare=True)
            if _present(source / FENCE):
                _prepared(request, target if _present(target) else None)
            elif _present(target):
                raise UpgradeBlocked("Цель существует без подтверждённого source fence. HOLD.")
            _write(root / "operation.json", {**request, "cancelled": True}, replace=True)


def status(server: Path) -> str:
    if sys.platform == "win32" and not windows_upgrade_allowed():
        return "HOLD: Windows Alpha upgrade закрыт до проверки долговечности публикации."
    root = state_path(server)
    if not _state_exists(server):
        return "UNREGISTERED"
    _private(root)
    request = _request(root)
    if _present(root / "activation.json"):
        _retire(root, Path(request["legacy"]))
        _decision(root, request)
        return "HOLD" if _present(root / "recovery.json") else "ACTIVATED"
    if request["sealed"]:
        return "HOLD"
    if request["cancelled"]:
        return "CANCELLED"
    return "PENDING"


def _selected(root: Path) -> Path:
    if sys.platform == "win32" and not windows_upgrade_allowed():
        raise UpgradeBlocked("Windows Alpha upgrade закрыт до проверки долговечности публикации.")
    _private(root)
    request = _request(root)
    _retire(root, Path(request["legacy"]))
    decision = _decision(root, request)
    if _present(root / "recovery.json"):
        raise UpgradeBlocked("Требуется завершить восстановление. HOLD.")
    return Path(decision["target"])


def selected_home(server: Path) -> Path | None:
    root = state_path(server)
    if not _state_exists(server):
        return None
    with runtime_lease(server):
        target = _selected(root)
        _confirm(root)
        return target


def check_admission(paths: StoragePaths, server: Path) -> bool:
    """Called under the runtime lease and PB-05 locks, before writes."""
    root = state_path(server)
    if not _state_exists(server):
        assert_no_pending_upgrade(paths)
        return False
    target = _selected(root)
    expected = paths_for(target, server)
    if (paths.data_home != target or paths.database_url != expected.database_url
            or paths.uploads != expected.uploads or paths.gm_key != expected.gm_key
            or "LANTERNA_GM_KEY" in os.environ):
        raise UpgradeBlocked("Запуск разрешён только для активированного DataHome. HOLD.")
    _confirm(root)
    proof = root / "rebind-proof.json"
    if _present(proof):
        proof.unlink()
        _sync_directory(root, _directory_id(root))
    return True


def _digest_db(database: Path, deadline: float) -> str:
    """Replay a complete SQLite file set through SQLite and fingerprint its logical state."""
    with closing(sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=0)) as db:
        db.set_progress_handler(lambda: int(monotonic() >= deadline), 1000)
        if (inspect_schema(db) is not SchemaState.CURRENT
                or db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]
                or db.execute("PRAGMA foreign_key_check").fetchone() is not None):
            raise UpgradeBlocked("SQLite recovery не подтвердил каталог или целостность. HOLD.")
        return _logical_digest(db, deadline)


def _logical_digest(db: sqlite3.Connection, deadline: float) -> str:
    digest = hashlib.sha256()
    db.set_progress_handler(lambda: int(monotonic() >= deadline), 1000)
    for row in db.iterdump():
        if monotonic() >= deadline:
            raise UpgradeBlocked("Истёк срок проверки SQLite. HOLD.")
        digest.update(row.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _capture_database(database: Path, bundle: Path, deadline: float) -> None:
    used = 0
    for suffix in ("", *_SQLITE_SIDECARS):
        source = database.with_name(database.name + suffix)
        if not _present(source):
            continue
        destination = bundle / source.name
        used += _measure(source, deadline, target=destination, limit=MAX_BYTES - used)["size"]
        _sync_file(destination)
    _sync_directory(bundle, _directory_id(bundle))


def recover(server: Path) -> Path:
    """Verify recovery on a private copy, then replay the same registered target."""
    root = state_path(server)
    pending = root / "recovery.json"
    with _operation(root):
        request = _request(root)
        target = Path(_activation_record(root, request)["target"])
        paths = paths_for(target, server)
        with own_storage(paths):
            _retire(root, Path(request["legacy"]))
            decision = _decision(root, request)
            _confirm(root)
            deadline = monotonic() + 120
            database = target / "lanterna.db"
            if _present(pending):
                checkpoint = _read(pending)
                if (set(checkpoint) != {"id", "digest", "bundle"}
                        or checkpoint["id"] != request["id"]
                        or not isinstance(checkpoint["digest"], str)
                        or not re.fullmatch(r"[0-9a-f]{64}", checkpoint["digest"])
                        or not isinstance(checkpoint["bundle"], str)
                        or not re.fullmatch(r"sqlite-[a-z0-9_]+", checkpoint["bundle"])
                        or not _entry(root / checkpoint["bundle"] / database.name, directory=False)):
                    raise UpgradeBlocked("Не подтверждена запись восстановления. HOLD.")
                if _probe_bundle(root, root / checkpoint["bundle"], database.name, deadline) != checkpoint["digest"]:
                    raise UpgradeBlocked("Сохранённый комплект SQLite изменился. HOLD.")
            else:
                bundle = Path(mkdtemp(prefix="sqlite-", dir=root))
                _same_volume(root, target, bundle)
                _capture_database(database, bundle, deadline)
                expected = _probe_bundle(root, bundle, database.name, deadline)
                _sync_directory(root, _directory_id(root))
                checkpoint = {"id": request["id"], "digest": expected, "bundle": bundle.name}
                _write(pending, checkpoint)
            # Even a visible checkpoint whose publication was interrupted must
            # be durable before the live SQLite set is opened for recovery.
            _sync_file(pending)
            _sync_directory(root, _directory_id(root))
            if _digest_db(database, deadline) != checkpoint["digest"]:
                raise UpgradeBlocked("SQLite не соответствует проверенной рабочей копии. HOLD.")
            with closing(sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=0)) as db:
                if db.execute("PRAGMA journal_mode=DELETE").fetchone() != ("delete",):
                    raise UpgradeBlocked("Не удалось штатно завершить обслуживание WAL. HOLD.")
                if _present(database.with_name(database.name + "-journal")):
                    # A journal without spilled pages can be cold. Let SQLite
                    # finish a rollback-mode write of the unchanged header value.
                    version, = db.execute("PRAGMA user_version").fetchone()
                    db.execute("BEGIN IMMEDIATE")
                    db.execute(f"PRAGMA user_version={version:d}")
                    db.commit()
            if _digest_db(database, deadline) != checkpoint["digest"]:
                raise UpgradeBlocked("Данные изменились при завершении SQLite recovery. HOLD.")
            _decision(root, request)
            with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
                schema = _schema(db)
            if check_storage(paths, server_dir=server, cwd=server, env={}, schema=schema,
                             require_supported_catalog=True) != "existing":
                raise UpgradeBlocked("Восстановленный стол неполон. HOLD.")
            _inspect(database, schema, deadline)
            backup = root / f"verified-recovery-{uuid4().hex}"
            create_backup(paths, backup, schema, external_key=False)
            manifest = verify_backup(backup, schema)
            for name in (*manifest["files"], "manifest.json"):
                _sync_file(backup / name)
            for directory in (backup / "uploads", backup, target):
                _sync_directory(directory, _directory_id(directory))
            _sync_file(database)
            _sync_directory(root, _directory_id(root))
            _write(root / "rebind-proof.json", {
                "decision": decision, "backup": backup.name,
                "manifest": _file_sha256(backup / "manifest.json"),
            }, replace=True)
            pending.unlink()
            _sync_directory(root, _directory_id(root))
            return backup


def _probe_bundle(root: Path, bundle: Path, name: str, deadline: float) -> str:
    with TemporaryDirectory(prefix="replay-", dir=root) as temporary:
        scratch = Path(temporary)
        _capture_database(bundle / name, scratch, deadline)
        return _digest_db(scratch / name, deadline)



def _file_sha256(path: Path) -> str:
    with _regular_file(path) as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def rebind(server: Path, destination: Path) -> None:
    """Use an exact offline recovery snapshot when no later writer was admitted."""
    root = state_path(server)
    destination = _home(str(destination))
    with _operation(root):
        request = _request(root)
        old = _activation_record(root, request)
        _retire(root, Path(request["legacy"]))
        target = Path(old["target"])
        protected = (target, Path(request["source"]), Path(request["legacy"]), root, server.parent)
        if any(destination == p or destination in p.parents or p in destination.parents for p in protected):
            raise UpgradeBlocked("Назначение восстановления должно быть независимым. HOLD.")
        if _present(target) or _present(root / "recovery.json"):
            raise UpgradeBlocked("Для перепривязки требуется утраченная цель и завершённый recovery. HOLD.")
        _same_volume(root, destination.parent)
        proof = _read(root / "rebind-proof.json")
        if (set(proof) != {"decision", "backup", "manifest"} or proof["decision"] != old
                or not isinstance(proof["backup"], str)
                or not re.fullmatch(r"verified-recovery-[0-9a-f]{32}", proof["backup"])):
            raise UpgradeBlocked("Нет доказательства полноты последней копии Beta. HOLD.")
        backup = root / proof["backup"]
        if _file_sha256(backup / "manifest.json") != proof["manifest"]:
            raise UpgradeBlocked("Резервная копия изменилась. HOLD.")
        with open_quiescent_sqlite(backup / "lanterna.db") as db:
            if inspect_schema(db) is not SchemaState.CURRENT:
                raise UpgradeBlocked("Резервная копия имеет несовместимую ревизию. HOLD.")
            schema = _schema(db)
        deadline = monotonic() + 120
        manifest = verify_backup(backup, schema, deadline=deadline)

        def fence_copy(staging: Path, verified: dict, _: float) -> None:
            _write(staging / FENCE, old["marker"])
            for name in verified["files"]:
                _sync_file(staging / name)
            for directory in (staging / "uploads", staging):
                _sync_directory(directory, _directory_id(directory))

        with lock_restore_destination(destination) as parent:
            _restore_backup(backup, destination, schema, manifest, parent_identity=parent,
                            deadline=deadline, env={}, prepare_upgrade=fence_copy,
                            sync_publication=lambda: _sync_directory(
                                destination.parent, _directory_id(destination.parent)))
            _write(root / "activation.json", {
                **old, "target": str(destination), "directory": _identity(destination),
                "database": _identity(destination / "lanterna.db"),
            }, replace=True)


def _schema(db: sqlite3.Connection) -> dict[str, set[str]]:
    return {row[0]: {col[1] for col in db.execute("SELECT * FROM pragma_table_info(?)", (row[0],))}
            for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
