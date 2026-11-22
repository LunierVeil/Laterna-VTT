"""Process ownership of a file-backed SQLite installation."""

from contextlib import contextmanager
import errno
from hashlib import sha256
import os
from pathlib import Path
import stat
import sys

from .data_home import StoragePaths
from .storage_preflight import StorageError, _entry


def _lock(fd: int) -> None:
    if os.name == "nt":
        import msvcrt

        # Windows permits locking a range beyond EOF. Leave the file empty.
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _check_uvicorn_workers() -> None:
    if Path(sys.argv[0]).name not in ("uvicorn", "uvicorn.exe", "__main__.py"):
        return
    workers = os.getenv("UVICORN_WORKERS") or os.getenv("WEB_CONCURRENCY") or "1"
    for index, arg in enumerate(sys.argv[1:], 1):
        if arg.startswith("--workers="):
            workers = arg.removeprefix("--workers=")
        elif arg == "--workers" and index + 1 < len(sys.argv):
            workers = sys.argv[index + 1]
    if int(workers) > 1:
        raise StorageError("Файловая SQLite требует один worker Uvicorn (--workers 1).")


@contextmanager
def own_storage(paths: StoragePaths):
    url = paths.database_url
    if url.get_backend_name() != "sqlite" or url.database == ":memory:":
        yield
        return

    _check_uvicorn_workers()
    database = Path(url.database)
    fd = None
    try:
        # Validate the original path before resolving it. Preflight rejects
        # redirects too, but must never run before the lock is acquired.
        if _entry(database, directory=False) and database.stat().st_nlink != 1:
            raise StorageError(f"SQLite с несколькими жёсткими ссылками не поддерживается: {database}")
        canonical = database.resolve(strict=False)
        identity = sha256(os.fsencode(os.path.normcase(canonical))).hexdigest()
        lock_path = canonical.parent.parent / f".laterna-{identity}.lock"
        if not _entry(lock_path.parent, directory=True):
            raise StorageError(f"Родительский каталог хранилища отсутствует: {lock_path.parent}")
        if _entry(lock_path, directory=False) and lock_path.stat().st_nlink != 1:
            raise StorageError(f"Некорректная жёсткая ссылка файла блокировки: {lock_path}")
        if lock_path in (Path(paths.gm_key), Path(paths.uploads)):
            raise StorageError(f"Путь хранилища совпадает с файлом блокировки: {lock_path}")
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        opened = os.fstat(fd)
        named = lock_path.lstat()
        if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                or getattr(named, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
                or not os.path.samestat(opened, named)):
            raise StorageError(f"Файл блокировки был перенаправлен: {lock_path}")
        try:
            _lock(fd)
        except OSError as exc:
            if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise StorageError(f"Хранилище уже занято другим экземпляром Laterna: {database}") from exc
            raise
    except OSError as exc:
        if fd is not None:
            os.close(fd)
        raise StorageError(f"Не удалось заблокировать хранилище {database}: {exc}") from exc
    except BaseException:
        if fd is not None:
            os.close(fd)
        raise

    try:
        yield
    finally:
        # Closing the descriptor releases both flock and Windows range locks.
        # Keep the pathname so concurrent processes always lock the same file.
        os.close(fd)
