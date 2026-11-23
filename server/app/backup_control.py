"""Filesystem control channel for the local owner of an explicit DataHome."""

import asyncio
from contextlib import suppress
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import shutil
from time import monotonic, sleep

from .data_home import StoragePaths
from .instance_backup import BackupError, OnlineBackup
from .storage_preflight import _entry

_IDENTIFIER = re.compile(r"[a-f0-9]{32}")


def control_directory(paths: StoragePaths) -> Path:
    database = paths.database_url
    if database.get_backend_name() != "sqlite" or database.database == ":memory:":
        raise BackupError("Online backup поддерживает файловую SQLite.")
    if paths.data_home is None and paths.mode != "development":
        raise BackupError("Для online backup выберите единый DataHome без отдельных overrides.")
    home = Path(paths.data_home) if paths.data_home else Path(database.database).parent
    if home == home.parent:
        raise BackupError("Нельзя выбрать корень тома как DataHome для online backup.")
    if os.name != "nt" and _entry(home, directory=True):
        info = home.stat()
        if info.st_uid != os.geteuid() or info.st_mode & 0o022:
            raise BackupError("Каталог DataHome должен принадлежать текущему пользователю без общей записи.")
    return home / ".backup-control"


def _write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(f".{secrets.token_hex(16)}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _session(root: Path) -> Path:
    if _entry(root, directory=True) and os.name != "nt":
        info = root.stat()
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise BackupError("Локальный канал должен быть доступен только владельцу.")
    pointer = root / "active"
    if not _entry(pointer, directory=False) or pointer.stat().st_size != 32:
        raise BackupError("Запустите Laterna с тем же DataHome и повторите.")
    name = pointer.read_text(encoding="ascii")
    if not _IDENTIFIER.fullmatch(name) or not _entry(root / name, directory=True):
        raise BackupError("Локальный канал резервного копирования недоступен.")
    return root / name


async def serve_backups(root: Path, backup: OnlineBackup) -> None:
    """One request at a time, scoped to this running server's random session."""
    if not _entry(root, directory=True):
        root.mkdir(mode=0o700)
    if os.name != "nt":
        info = root.stat()
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise BackupError("Локальный канал должен быть доступен только владельцу.")
    name = secrets.token_hex(16)
    session = root / name
    session.mkdir(mode=0o700)
    pointer = root / "active"
    marker = session / "owner"
    try:
        marker.write_text(name, encoding="ascii")
        marker.replace(pointer)
        while True:
            for request in session.iterdir():
                if not _IDENTIFIER.fullmatch(request.name):
                    continue
                try:
                    if not _entry(request, directory=True) or next(request.iterdir(), None) is not None:
                        continue
                    claimed = request.with_suffix(".running")
                    request.rename(claimed)
                except (OSError, RuntimeError):
                    continue
                try:
                    folder = root.parent.parent / "Laterna Backups"
                    if not _entry(folder, directory=True):
                        folder.mkdir(mode=0o700, exist_ok=True)
                    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                    destination = folder / f"laterna-{stamp}-{request.name}"
                    manifest = await backup.create(destination)
                    result = {"location": str(destination), "home": str(root.parent),
                              "files": len(manifest["files"])}
                except (OSError, RuntimeError) as exc:
                    result = {"error": str(exc)}
                _write_json(session / f"{request.name}.json", result)
                with suppress(OSError):
                    claimed.rmdir()
            await asyncio.sleep(0.25)
    finally:
        with suppress(OSError):
            pointer.unlink(missing_ok=True)
        with suppress(OSError):
            shutil.rmtree(session)


def request_backup(paths: StoragePaths) -> dict:
    root = control_directory(paths)
    session = _session(root)
    name = secrets.token_hex(16)
    request = session / name
    response = session / f"{name}.json"
    request.mkdir(mode=0o700)
    try:
        deadline = monotonic() + 135
        claim_deadline = monotonic() + 5
        while monotonic() < deadline and _session(root) == session:
            if _entry(response, directory=False):
                result = json.loads(response.read_text(encoding="utf-8"))
                if "error" in result:
                    raise BackupError(result["error"])
                return result
            if monotonic() > claim_deadline and request.exists():
                raise BackupError("Laterna не приняла запрос. Проверьте, что стол запущен и копирование не занято.")
            sleep(0.25)
        raise BackupError("Ответ Laterna не получен. Проверьте каталог резервных копий.")
    finally:
        with suppress(OSError):
            request.rmdir()
        response.unlink(missing_ok=True)
